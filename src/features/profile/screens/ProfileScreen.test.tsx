/**
 * WHAT:  Wiring tests for ProfileScreen — signed-out state with the dev
 *        preview, the hero card (stats inside, degrade-by-omission, trust
 *        badge), the spotter-story push row, log-out flow through the
 *        confirm, delete-account blocked vs allowed vs function-unavailable
 *        paths, dev-section gating, version caption, and the settings links.
 * WHY:   This screen holds the two account-destroying actions in the app; a
 *        confirm that fires on dismiss, or a deletion that skips the
 *        blocked-by-escrow check, is a Tier 1 failure. Hook and api are
 *        mocked at the module boundary so each state is exact.
 * LINKS: src/features/profile/screens/ProfileScreen.tsx; docs/TESTING.md.
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import type { MyProfileState } from '../hooks/useMyProfile';
import { ProfileScreen } from './ProfileScreen';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { View, Text } = require('react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { useRef } = require('react');
  return {
    __esModule: true,
    default: { View, Text, createAnimatedComponent: (c: unknown) => c },
    Easing: { out: (fn: unknown) => fn, cubic: () => 0 },
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => true,
    useSharedValue: (initial: unknown) => useRef({ value: initial }).current,
    withTiming: (value: unknown) => value,
  };
});

jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');
  class VisibilityAwareBottomSheetModal extends React.Component {
    state = { visible: false };
    present = () => this.setState({ visible: true });
    dismiss = () => {
      if (!this.state.visible) return;
      this.setState({ visible: false });
      this.props.onDismiss?.();
    };
    render() {
      return this.state.visible ? this.props.children : null;
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

// The garage barrel reaches the supabase client through garageApi. This screen
// only needs the hook's ANSWER (it drives the My cars hint), so mock at the
// feature boundary; `mockSavedCar` lets a test drive all three states.
let mockSavedCar: 'unknown' | 'none' | 'some' = 'some';
jest.mock('@/features/garage', () => ({
  useHasSavedCar: () => mockSavedCar,
}));

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
  useFocusEffect: () => {}, // focus-refresh behaviour not simulated here
}));

const mockShowToast = jest.fn();
jest.mock('@/shared/ui', () => {
  const actual = jest.requireActual('@/shared/ui');
  return {
    ...actual,
    get useToast() {
      return () => ({ show: mockShowToast });
    },
    useTabBadges: () => ({ badges: {}, setBadge: jest.fn() }),
  };
});

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.2.3' } },
}));

let mockProfileState: MyProfileState & { refresh: () => void };
jest.mock('../hooks/useMyProfile', () => ({
  get useMyProfile() {
    return () => mockProfileState;
  },
}));

const mockSignOut = jest.fn();
const mockCountBlocking = jest.fn();
const mockRequestDeletion = jest.fn();
jest.mock('../api/profileApi', () => ({
  get signOut() {
    return mockSignOut;
  },
  get countDeletionBlockingPosts() {
    return mockCountBlocking;
  },
  get requestAccountDeletion() {
    return mockRequestDeletion;
  },
}));

const mockRequireAuth = jest.fn();
jest.mock('@/features/auth', () => ({
  useRequireAuth: () => mockRequireAuth,
}));

// Mocked at the feature boundary (docs/TESTING.md): the real barrel reaches
// the Supabase client, which throws at import without env vars.
let mockAlertsState: unknown = { status: 'ready', alerts: [], refresh: jest.fn() };
jest.mock('@/features/notifications', () => ({
  useMyAlerts: () => mockAlertsState,
  unregisterCurrentPushToken: jest.fn(),
}));

const profile = {
  id: 'user-1',
  firstName: 'Ollie',
  displayName: 'Ollie B',
  avatarUrl: null,
  createdAt: '2026-05-14T09:00:00Z',
  counters: { sightingsReported: 7, sightingsHelpful: 4, recoveriesCredited: 1 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockProfileState = { status: 'ready', profile, refresh: jest.fn() };
  mockAlertsState = { status: 'ready', alerts: [], refresh: jest.fn() };
  mockSignOut.mockResolvedValue(undefined);
  mockCountBlocking.mockResolvedValue(0);
  mockRequestDeletion.mockResolvedValue(undefined);
});

describe('signed out', () => {
  beforeEach(() => {
    mockProfileState = { status: 'signedOut', refresh: jest.fn() };
  });

  it('shows the log-in invitation and routes through the auth gate', async () => {
    const { getByText } = await render(<ProfileScreen />);
    fireEvent.press(getByText('Log in'));
    expect(mockRequireAuth).toHaveBeenCalledWith({ context: 'tab_profile' });
    expect(mockPush).not.toHaveBeenCalled(); // no auth route exists anymore
  });

  it('dev preview renders the full profile with sample data', async () => {
    const { getByText, getByTestId } = await render(<ProfileScreen />);
    await act(async () => {
      fireEvent.press(getByText('Preview with sample data (dev)'));
    });
    expect(getByTestId('profile-header')).toBeTruthy(); // the hero card
    expect(getByText('Member since May 2026')).toBeTruthy();
  });
});

// The quiet, undismissable garage nudge. It is the permanent safety net behind
// the two pushy nudges — which is why it must be right in every state, and must
// stay SILENT when we don't actually know the answer.
describe('the My cars hint', () => {
  afterEach(() => {
    mockSavedCar = 'some';
  });

  it('invites someone with no saved car to add one', async () => {
    mockSavedCar = 'none';
    const { getByText } = await render(<ProfileScreen />);

    expect(getByText('Save your car — reporting it stolen later takes seconds')).toBeTruthy();
  });

  it('says nothing once a car is saved', async () => {
    mockSavedCar = 'some';
    const { queryByText, getByTestId } = await render(<ProfileScreen />);

    expect(queryByText(/Save your car/)).toBeNull();
    expect(getByTestId('row-my-cars')).toBeTruthy(); // the row itself stays
  });

  // 'unknown' covers a guest, a failed fetch and a request in flight. Guessing
  // would either nag someone who has a car or flash a hint that then vanishes.
  it('says nothing while the answer is unknown', async () => {
    mockSavedCar = 'unknown';
    const { queryByText } = await render(<ProfileScreen />);

    expect(queryByText(/Save your car/)).toBeNull();
  });
});

describe('signed in', () => {
  it('renders the hero card (identity only), story row, and the dev section', async () => {
    const { getByText, getByTestId, queryByTestId } = await render(<ProfileScreen />);
    expect(getByText('Ollie')).toBeTruthy();
    expect(getByText('Member since May 2026')).toBeTruthy();
    // The counters moved to the spotter-story page — never on the root hero.
    expect(queryByTestId('stat-sightingsReported')).toBeNull();
    // The stats + narrative live behind the push row.
    expect(getByTestId('row-spotter-story')).toBeTruthy();
    expect(getByTestId('dev-section')).toBeTruthy();
    expect(getByTestId('row-copy-logs')).toBeTruthy();
  });

  it('trusted spotters get the avatar badge and the spoken label', async () => {
    mockProfileState = {
      status: 'ready',
      profile: {
        ...profile,
        counters: { sightingsReported: 9, sightingsHelpful: 5, recoveriesCredited: 1 },
      },
      refresh: jest.fn(),
    };
    const { getByTestId } = await render(<ProfileScreen />);
    expect(getByTestId('avatar-badge-trusted')).toBeTruthy();
    // The card is ONE a11y element — its label must speak everything a
    // sighted user reads inside: name, trust, and member-since.
    expect(getByTestId('profile-header').props.accessibilityLabel).toBe(
      'Ollie, trusted spotter, Member since May 2026. Edit profile',
    );
  });

  it('no trust badge below thresholds', async () => {
    const { queryByTestId } = await render(<ProfileScreen />); // 7/4/1 — helpful short
    expect(queryByTestId('avatar-badge-trusted')).toBeNull();
  });

  it('hero card tap opens edit profile', async () => {
    const { getByTestId } = await render(<ProfileScreen />);
    fireEvent.press(getByTestId('profile-header'));
    expect(mockPush).toHaveBeenCalledWith('/edit-profile');
  });

  it('the spotter-story row pushes /spotter-story', async () => {
    const { getByTestId } = await render(<ProfileScreen />);
    fireEvent.press(getByTestId('row-spotter-story'));
    expect(mockPush).toHaveBeenCalledWith('/spotter-story');
  });

  it('shows the app version caption in the account cluster', async () => {
    const { getByText } = await render(<ProfileScreen />);
    expect(getByText('Version 1.2.3')).toBeTruthy();
  });

  it('How Trackitdown works re-opens onboarding in revisit mode', async () => {
    const { getByTestId } = await render(<ProfileScreen />);
    fireEvent.press(getByTestId('row-how-it-works'));
    expect(mockPush).toHaveBeenCalledWith('/onboarding?revisit=1');
  });

  // The two Settings rows were inert "Coming soon" placeholders until the
  // notifications feature shipped.
  it('both alert rows open alert settings and no longer say Coming soon', async () => {
    const { getByTestId, queryByText } = await render(<ProfileScreen />);

    expect(queryByText('Coming soon')).toBeNull();

    // Presses are wrapped in act: an unwrapped one leaves a pending update
    // that surfaces as an unrelated failure in the NEXT test, not this one.
    await act(async () => {
      fireEvent.press(getByTestId('row-alert-radius'));
    });
    expect(mockPush).toHaveBeenCalledWith('/alerts');

    mockPush.mockClear();
    await act(async () => {
      fireEvent.press(getByTestId('row-notifications'));
    });
    expect(mockPush).toHaveBeenCalledWith('/alerts');
  });

  it('summarises no alerts as Not set', async () => {
    const { getAllByText } = await render(<ProfileScreen />);
    expect(getAllByText('Not set').length).toBeGreaterThan(0);
  });

  it('counts the ACTIVE alerts, singular and plural', async () => {
    mockAlertsState = {
      status: 'ready',
      alerts: [{ enabled: true }],
      refresh: jest.fn(),
    };
    const single = await render(<ProfileScreen />);
    expect(single.getAllByText('1 alert').length).toBeGreaterThan(0);
  });

  it('excludes paused alerts from the count', async () => {
    // Three saved, one live — saying "3 alerts" would imply three are firing.
    mockAlertsState = {
      status: 'ready',
      alerts: [{ enabled: true }, { enabled: false }, { enabled: true }],
      refresh: jest.fn(),
    };
    const { getAllByText } = await render(<ProfileScreen />);
    expect(getAllByText('2 alerts').length).toBeGreaterThan(0);
  });

  it('says All paused when every alert is muted', async () => {
    // A different answer from "no alerts" AND from a count — the row must not
    // imply notifications are arriving when none can.
    mockAlertsState = {
      status: 'ready',
      alerts: [{ enabled: false }, { enabled: false }],
      refresh: jest.fn(),
    };
    const { getAllByText, queryByText } = await render(<ProfileScreen />);
    expect(getAllByText('All paused').length).toBeGreaterThan(0);
    expect(queryByText('2 alerts')).toBeNull();
    expect(queryByText('Not set')).toBeNull();
  });

  it('log out: confirming signs out and stays put (guest mode, no auth wall)', async () => {
    const { getByTestId, getAllByText } = await render(<ProfileScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('row-sign-out'));
    });
    await act(async () => {
      // The row label and the dialog button share the wording — press the
      // dialog's (rendered last).
      fireEvent.press(getAllByText('Log out').at(-1) as never);
    });
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    expect(mockReplace).not.toHaveBeenCalled(); // the session flip re-renders in place
  });

  it('log out: cancelling does nothing', async () => {
    const { getByTestId, getByText } = await render(<ProfileScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('row-sign-out'));
    });
    await act(async () => {
      fireEvent.press(getByText('Cancel'));
    });
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('delete: blocked by a post with escrowed money — no deletion offered', async () => {
    mockCountBlocking.mockResolvedValue(1);
    const { getByTestId, getByText, queryByText } = await render(<ProfileScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('row-delete-account'));
    });
    expect(getByText(/bounty still held/)).toBeTruthy();
    expect(queryByText("Delete your account?")).toBeNull();
    expect(mockRequestDeletion).not.toHaveBeenCalled();
  });

  it('delete: clear account confirms with honest copy, then requests deletion', async () => {
    const { getByTestId, getByText, getAllByText } = await render(<ProfileScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('row-delete-account'));
    });
    expect(getByText(/deleted as described in our privacy policy/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(getAllByText('Delete account').at(-1) as never);
    });
    await waitFor(() => expect(mockRequestDeletion).toHaveBeenCalled());
    expect(mockReplace).not.toHaveBeenCalled(); // guest mode in place, no auth wall
  });

  it('delete: missing Edge Function degrades to a calm error toast', async () => {
    mockRequestDeletion.mockRejectedValue(new Error('Function not found'));
    const { getByTestId, getAllByText } = await render(<ProfileScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('row-delete-account'));
    });
    await act(async () => {
      fireEvent.press(getAllByText('Delete account').at(-1) as never);
    });
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        'Account deletion is not available in this build yet.',
        'error',
      ),
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('copy recent logs writes to the clipboard and confirms', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- accessing the mock
    const Clipboard = require('expo-clipboard');
    const { getByTestId } = await render(<ProfileScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('row-copy-logs'));
    });
    expect(Clipboard.setStringAsync).toHaveBeenCalled();
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Recent logs copied'));
  });
});
