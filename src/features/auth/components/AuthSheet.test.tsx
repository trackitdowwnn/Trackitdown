/**
 * WHAT:  Tests for AuthSheet — the deferred-auth resolution contract: opens on
 *        a stored intent with the context's title, walks email → OTP →
 *        (new users) profile, resolves the intent ONLY once standing is
 *        'member' (profile row confirmed BEFORE the continuation), and treats
 *        dismissal as a clean cancel that drops the intent.
 * WHY:   These orderings are the whole pattern: a continuation firing before
 *        the profile row exists breaks actions that need it; a dropped intent
 *        running later would be an action the user cancelled.
 * LINKS: src/features/auth/components/AuthSheet.tsx; gate/gateIntent.ts;
 *        docs/TESTING.md.
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import type { AuthStanding } from '../hooks/useAuthStanding';
import { clearPendingIntent, consumePendingIntent, setPendingIntent } from '../gate/gateIntent';
import { AuthSheet } from './AuthSheet';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

// The latest mounted modal instance, so tests can drive a user dismissal
// (swipe / scrim tap) through the SAME code path the library uses: dismiss()
// hides the content and fires onDismiss.
const mockModalHandle: { current: { dismiss: () => void } | null } = { current: null };

jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');
  class VisibilityAwareBottomSheetModal extends React.Component {
    state = { visible: false };
    componentDidMount() {
      mockModalHandle.current = this as unknown as { dismiss: () => void };
    }
    present = () => this.setState({ visible: true });
    dismiss = () => {
      this.setState({ visible: false });
      (this.props as { onDismiss?: () => void }).onDismiss?.();
    };
    render() {
      return this.state.visible ? (this.props as { children?: unknown }).children : null;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const ReactNative = require('react-native');
  return {
    ...mock,
    BottomSheetModal: VisibilityAwareBottomSheetModal,
    BottomSheetScrollView: (props: object) => React.createElement(ReactNative.ScrollView, props),
  };
});

// Presentational pieces with native/browser deps — not what this test exercises.
jest.mock('./SocialSignInButtons', () => ({ SocialSignInButtons: () => null }));
jest.mock('./AuthLegalNotice', () => ({ AuthLegalNotice: () => null }));

// A controllable standing store so tests can flip guest → incomplete → member
// and have the component re-render, exactly like the real hook would.
let mockStanding: AuthStanding = 'guest';
const mockStandingListeners = new Set<() => void>();
function setMockStanding(next: AuthStanding): void {
  mockStanding = next;
  mockStandingListeners.forEach((cb) => cb());
}
const mockInvalidateProfileCheck = jest.fn();

jest.mock('../hooks/useAuthStanding', () => ({
  useAuthStanding: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
    const { useSyncExternalStore } = require('react');
    return useSyncExternalStore(
      (cb: () => void) => {
        mockStandingListeners.add(cb);
        return () => mockStandingListeners.delete(cb);
      },
      () => mockStanding,
    );
  },
  invalidateProfileCheck: () => mockInvalidateProfileCheck(),
}));

const mockRequestEmailOtp = jest.fn();
const mockVerifyEmailOtp = jest.fn();
const mockCreateProfile = jest.fn();

jest.mock('../api/authApi', () => ({
  AuthActionError: class AuthActionError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
  requestEmailOtp: (...a: unknown[]) => mockRequestEmailOtp(...a),
  verifyEmailOtp: (...a: unknown[]) => mockVerifyEmailOtp(...a),
  createProfile: (...a: unknown[]) => mockCreateProfile(...a),
  signInWithApple: jest.fn(),
  signInWithGoogle: jest.fn(),
}));

const mockSession = { status: 'signedIn', userId: 'u1' };
jest.mock('../hooks/useSession', () => ({ useSession: () => mockSession }));

async function enterEmailAndCode(screen: Awaited<ReturnType<typeof render>>) {
  await act(async () => {
    fireEvent.changeText(screen.getByLabelText('Email'), 'sam@example.com');
  });
  await act(async () => {
    fireEvent.press(screen.getByText('Continue'));
  });
  await waitFor(() => expect(screen.getByText(/Enter the code we emailed/)).toBeTruthy());
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('otp-hidden-input'), '12345678');
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  clearPendingIntent();
  mockStanding = 'guest';
  mockRequestEmailOtp.mockResolvedValue(undefined);
  mockVerifyEmailOtp.mockResolvedValue('u1');
  mockCreateProfile.mockResolvedValue(undefined);
});

describe('AuthSheet', () => {
  it('opens on a stored intent with the contextual title (an invitation, not a wall)', async () => {
    const screen = await render(<AuthSheet />);
    expect(screen.queryByText('Log in to report a sighting')).toBeNull();

    await act(async () => {
      setPendingIntent({ context: 'report_sighting', run: jest.fn() });
    });

    await waitFor(() => expect(screen.getByText('Log in to report a sighting')).toBeTruthy());
    expect(screen.getByLabelText('Email')).toBeTruthy(); // email step first
  });

  it('resolves an EXISTING user straight after the OTP: continuation runs, no profile step', async () => {
    const run = jest.fn();
    const screen = await render(<AuthSheet />);
    await act(async () => {
      setPendingIntent({ context: 'post_car', run });
    });
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());

    await enterEmailAndCode(screen);
    expect(mockVerifyEmailOtp).toHaveBeenCalledWith('sam@example.com', '12345678');

    // The session flips; the profile check finds a row → member.
    await act(async () => {
      setMockStanding('member');
    });

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('What should we call you?')).toBeNull();
    expect(consumePendingIntent()).toBeNull(); // consumed, not still pending
  });

  it('a NEW user completes the profile BEFORE the continuation runs', async () => {
    const run = jest.fn();
    const screen = await render(<AuthSheet />);
    await act(async () => {
      setPendingIntent({ context: 'report_sighting', run });
    });
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());

    await enterEmailAndCode(screen);
    // The session flips but there is no profiles row yet.
    await act(async () => {
      setMockStanding('incomplete');
    });

    await waitFor(() => expect(screen.getByText('What should we call you?')).toBeTruthy());
    expect(run).not.toHaveBeenCalled(); // the ordering under test

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('First name'), 'Sam');
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Get started'));
    });
    await waitFor(() => expect(mockCreateProfile).toHaveBeenCalledWith('u1', { firstName: 'Sam' }));
    expect(mockInvalidateProfileCheck).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled(); // still not until standing confirms

    await act(async () => {
      setMockStanding('member'); // the re-check found the new row
    });
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  });

  it('an orphaned session (incomplete on open) starts directly at the profile step', async () => {
    mockStanding = 'incomplete';
    const screen = await render(<AuthSheet />);
    await act(async () => {
      setPendingIntent({ context: 'edit_profile', run: jest.fn() });
    });
    await waitFor(() => expect(screen.getByText('What should we call you?')).toBeTruthy());
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('dismissal (swipe/scrim) drops the intent — the cancelled action can never run', async () => {
    const run = jest.fn();
    const screen = await render(<AuthSheet />);
    await act(async () => {
      setPendingIntent({ context: 'post_car', run });
    });
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());

    // A user dismissal reaches AuthSheet.handleDismiss via the modal's
    // onDismiss — the same path a swipe or scrim tap takes.
    await act(async () => {
      mockModalHandle.current?.dismiss();
    });

    expect(run).not.toHaveBeenCalled();
    expect(consumePendingIntent()).toBeNull();

    // And a later sign-in does NOT resurrect it.
    await act(async () => {
      setMockStanding('member');
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('"Use a different email" slides back to the email step', async () => {
    const screen = await render(<AuthSheet />);
    await act(async () => {
      setPendingIntent({ context: 'tab_profile' });
    });
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());
    await enterEmailAndCode(screen);

    await act(async () => {
      fireEvent.press(screen.getByText('Use a different email'));
    });
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());
  });
});
