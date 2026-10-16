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
import { Keyboard, Platform } from 'react-native';

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
// The Google button as a plain pressable, so a test can sign in with it.
jest.mock('./SocialSignInButtons', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { Text } = require('react-native');
  return {
    SocialSignInButtons: ({
      onGoogle,
      onApple,
      showGoogle,
      showAppleWeb,
    }: {
      onGoogle: () => void;
      onApple: () => void;
      showGoogle?: boolean;
      showAppleWeb?: boolean;
    }) => (
      <>
        {showAppleWeb ? <Text onPress={onApple}>Continue with Apple</Text> : null}
        {showGoogle ? <Text onPress={onGoogle}>Continue with Google</Text> : null}
      </>
    ),
  };
});
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
  signInWithApple: () => mockSignInWithApple(),
  signInWithAppleWeb: () => mockSignInWithAppleWeb(),
  signInWithGoogle: () => mockSignInWithGoogle(),
  isGoogleSignInConfigured: () => mockGoogleConfigured(),
  isAppleWebSignInConfigured: () => mockAppleWebConfigured(),
}));
const mockSignInWithGoogle = jest.fn();
const mockGoogleConfigured = jest.fn(() => true);
const mockSignInWithApple = jest.fn();
const mockSignInWithAppleWeb = jest.fn();
const mockAppleWebConfigured = jest.fn(() => true);

const mockSession = { status: 'signedIn', userId: 'u1' };
jest.mock('../hooks/useSession', () => ({ useSession: () => mockSession }));

// The resend countdown, finished: no test here waits a minute. (Its own
// timing is useResendCountdown.test's.)
jest.mock('../hooks/useResendCountdown', () => ({
  useResendCountdown: () => ({ secondsLeft: 0, canResend: true, restart: jest.fn() }),
}));

async function enterEmailAndCode(screen: Awaited<ReturnType<typeof render>>) {
  await act(async () => {
    fireEvent.changeText(screen.getByLabelText('Email'), 'sam@example.com');
  });
  await act(async () => {
    fireEvent.press(screen.getByText('Continue'));
  });
  await waitFor(() => expect(screen.getByText(/Enter the code we emailed/)).toBeTruthy());
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('otp-hidden-input'), '123456');
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
    expect(mockVerifyEmailOtp).toHaveBeenCalledWith('sam@example.com', '123456');

    // The session flips; the profile check finds a row → member.
    await act(async () => {
      setMockStanding('member');
    });

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('What should we call you?')).toBeNull();
    expect(consumePendingIntent()).toBeNull(); // consumed, not still pending
  });

  // 2026-10-07: the continuation is usually a navigation (the report form
  // sliding up); starting it alongside the sheet's close and the keyboard's
  // drop put three animations on screen at once. It now waits for the close.
  it('runs the continuation after the sheet closes — once, even if the close never reports back', async () => {
    const run = jest.fn();
    const keyboardDismiss = jest.spyOn(Keyboard, 'dismiss');
    const screen = await render(<AuthSheet />);
    await act(async () => {
      setPendingIntent({ context: 'post_car', run });
    });
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());
    await enterEmailAndCode(screen);

    try {
      // A close that never calls back: the fallback must still run it.
      const handle = mockModalHandle.current as { dismiss: () => void };
      handle.dismiss = () => {};
      await act(async () => {
        setMockStanding('member');
      });

      expect(keyboardDismiss).toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled(); // not alongside the close
      await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    } finally {
      keyboardDismiss.mockRestore();
    }
  });

  it('a close that DOES report back runs it once — the fallback never runs it again', async () => {
    const run = jest.fn();
    const screen = await render(<AuthSheet />);
    await act(async () => {
      setPendingIntent({ context: 'post_car', run });
    });
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());
    await enterEmailAndCode(screen);

    await act(async () => {
      setMockStanding('member'); // the test double's close calls onDismiss
    });
    expect(run).toHaveBeenCalledTimes(1);

    // Past the fallback window: still exactly once.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    expect(run).toHaveBeenCalledTimes(1);
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

describe('Continue with Google (2026-10-15)', () => {
  async function openSheet() {
    const screen = await render(<AuthSheet />);
    await act(async () => {
      setPendingIntent({ context: 'post_car', run: jest.fn() });
    });
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());
    return screen;
  }

  it('a NEW user from Google: "What should we call you?" starts with their first name', async () => {
    mockSignInWithGoogle.mockResolvedValue({ cancelled: false, userId: 'u1', firstName: 'Sam' });
    const screen = await openSheet();
    await act(async () => {
      fireEvent.press(screen.getByText('Continue with Google'));
    });
    // Signed in, no profiles row yet: the name step — already filled in.
    await act(async () => {
      setMockStanding('incomplete');
    });
    await waitFor(() => expect(screen.getByText('What should we call you?')).toBeTruthy());
    expect(screen.getByLabelText('First name').props.value).toBe('Sam');

    // Still theirs to confirm: one tap.
    await act(async () => {
      fireEvent.press(screen.getByText('Get started'));
    });
    await waitFor(() => expect(mockCreateProfile).toHaveBeenCalledWith('u1', { firstName: 'Sam' }));
  });

  it('a cancel from Google: no error, still on the email step', async () => {
    mockSignInWithGoogle.mockResolvedValue({ cancelled: true });
    const screen = await openSheet();
    await act(async () => {
      fireEvent.press(screen.getByText('Continue with Google'));
    });
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.queryByText(/couldn’t|didn’t|failed/i)).toBeNull();
  });

  it('⚠️ Google not set up in this bundle: no button that can only fail', async () => {
    mockGoogleConfigured.mockReturnValue(false);
    const screen = await openSheet();
    expect(screen.queryByText('Continue with Google')).toBeNull();
    mockGoogleConfigured.mockReturnValue(true);
  });
});

describe('Sign in with Apple — Android takes the web flow (2026-10-15)', () => {
  async function openSheet() {
    const screen = await render(<AuthSheet />);
    await act(async () => {
      setPendingIntent({ context: 'post_car', run: jest.fn() });
    });
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());
    return screen;
  }

  afterEach(() => {
    jest.restoreAllMocks();
    mockAppleWebConfigured.mockReturnValue(true);
  });

  it('Android: "Continue with Apple" signs in through Apple’s web page, never the iOS sheet', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockSignInWithAppleWeb.mockResolvedValue({ cancelled: false, userId: 'u1', firstName: 'Sam' });
    const screen = await openSheet();
    await act(async () => {
      fireEvent.press(screen.getByText('Continue with Apple'));
    });
    expect(mockSignInWithAppleWeb).toHaveBeenCalledTimes(1);
    expect(mockSignInWithApple).not.toHaveBeenCalled();

    // A new user lands on the name step with Apple's first name in it.
    await act(async () => {
      setMockStanding('incomplete');
    });
    await waitFor(() => expect(screen.getByText('What should we call you?')).toBeTruthy());
    expect(screen.getByLabelText('First name').props.value).toBe('Sam');
  });

  it('⚠️ Android, not set up yet: the button says "coming soon" — and signs nobody in', async () => {
    // Owner, 2026-10-15: show it now, with a sheet saying it's on its way.
    jest.replaceProperty(Platform, 'OS', 'android');
    mockAppleWebConfigured.mockReturnValue(false);
    const screen = await openSheet();
    expect(screen.queryByTestId('apple-coming-soon')).toBeNull(); // not mounted until asked

    await act(async () => {
      fireEvent.press(screen.getByText('Continue with Apple'));
    });
    expect(screen.getByTestId('apple-coming-soon')).toBeTruthy();
    expect(screen.getByText('Coming soon')).toBeTruthy();
    expect(mockSignInWithAppleWeb).not.toHaveBeenCalled();

    // "Got it" closes it, and the sign-in sheet is still there to use.
    await act(async () => {
      fireEvent.press(screen.getByText('Got it'));
    });
    await waitFor(() => expect(screen.queryByTestId('apple-coming-soon')).toBeNull());
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(consumePendingIntent()).not.toBeNull(); // the gate was not cancelled
  });

  it('iOS: never the web button — the native one is Apple’s own', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const screen = await openSheet();
    expect(screen.queryByText('Continue with Apple')).toBeNull();
  });
});

describe('sign-in best-practice pass (2026-10-15)', () => {
  async function openSheet() {
    const screen = await render(<AuthSheet />);
    await act(async () => {
      setPendingIntent({ context: 'post_car', run: jest.fn() });
    });
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());
    return screen;
  }

  async function toCodeStep(screen: Awaited<ReturnType<typeof render>>) {
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Email'), 'sam@example.com');
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Continue'));
    });
    await waitFor(() => expect(screen.getByText(/Enter the code we emailed/)).toBeTruthy());
  }

  it('the no-typing ways come first: Google above the email field', async () => {
    const screen = await openSheet();
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf('"Email"')).toBeGreaterThan(-1);
    expect(tree.indexOf('Continue with Google')).toBeLessThan(tree.indexOf('"Email"'));
  });

  it('the email step is just the ways in — no explainer lines (owner, 2026-10-16)', async () => {
    const screen = await openSheet();
    expect(screen.queryByText(/No password needed/)).toBeNull();
    expect(screen.queryByText(/digit code/)).toBeNull();
  });

  it('⚠️ a malformed address SAYS so (GOV.UK) — never just a greyed-out button', async () => {
    const screen = await openSheet();
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Email'), 'sam@');
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Continue'));
    });
    expect(screen.getByText('Enter an email address like name@example.com')).toBeTruthy();
    expect(mockRequestEmailOtp).not.toHaveBeenCalled();

    // …and the message goes as soon as they fix it.
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Email, error: Enter an email address like name@example.com'), 'sam@example.com');
    });
    expect(screen.queryByText('Enter an email address like name@example.com')).toBeNull();
  });

  it('shows where the code went — and no "we’ll check it" line (owner, 2026-10-16)', async () => {
    const screen = await openSheet();
    await toCodeStep(screen);
    expect(screen.getByText('sam@example.com')).toBeTruthy();
    expect(screen.queryByText(/as soon as it’s in/)).toBeNull();
    expect(screen.queryByText(/spam folder|take a minute to arrive/)).toBeNull();
  });

  it('Verify never sends a part-code; the sixth digit sends it, once', async () => {
    const screen = await openSheet();
    await toCodeStep(screen);
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('otp-hidden-input'), '12345');
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Verify'));
    });
    expect(mockVerifyEmailOtp).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('otp-hidden-input'), '123456');
    });
    expect(mockVerifyEmailOtp).toHaveBeenCalledTimes(1);
    expect(mockVerifyEmailOtp).toHaveBeenCalledWith('sam@example.com', '123456');
  });

  it('a wrong code’s message goes as soon as they start again', async () => {
    mockVerifyEmailOtp.mockRejectedValueOnce(
      Object.assign(new Error('That code didn’t match — check the latest email.'), {
        code: 'INVALID_OTP',
      }),
    );
    const screen = await openSheet();
    await toCodeStep(screen);
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('otp-hidden-input'), '123456');
    });
    await waitFor(() => expect(screen.getByText(/Something went wrong|didn’t match/)).toBeTruthy());

    await act(async () => {
      fireEvent.changeText(screen.getByTestId('otp-hidden-input'), '1');
    });
    expect(screen.queryByText(/Something went wrong|didn’t match/)).toBeNull();
  });

  it('a resend says so: "New code sent to …"', async () => {
    const screen = await openSheet();
    await toCodeStep(screen);
    mockRequestEmailOtp.mockClear();
    await act(async () => {
      fireEvent.press(screen.getByText('Resend code'));
    });
    expect(mockRequestEmailOtp).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('otp-resent')).toBeTruthy();
    expect(screen.getByText('New code sent to sam@example.com.')).toBeTruthy();
  });

  it('once signed in, the sheet says "Welcome to Trackitdown" — not "Log in to …"', async () => {
    const screen = await openSheet();
    await toCodeStep(screen);
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('otp-hidden-input'), '123456');
    });
    await act(async () => {
      setMockStanding('incomplete');
    });
    await waitFor(() => expect(screen.getByText('What should we call you?')).toBeTruthy());
    expect(screen.getByText('Welcome to Trackitdown')).toBeTruthy();
    expect(screen.queryByText('Log in to post your car')).toBeNull();
  });
});
