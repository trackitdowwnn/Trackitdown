/**
 * WHAT:  Wiring tests for SpotterStoryScreen — the four states (skeleton
 *        while loading, error retry, signed-out invitation through the gate,
 *        ready → the full ReputationCard), plus the on-screen back control.
 * WHY:   This pushed page is where the narrative reputation card moved in
 *        the redesign (composition B); if it silently rendered blank or
 *        trapped users without a back affordance, the "Your spotter story"
 *        row would lead nowhere.
 * LINKS: src/features/profile/screens/SpotterStoryScreen.tsx; docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';

import type { MyProfileState } from '../hooks/useMyProfile';
import { SpotterStoryScreen } from './SpotterStoryScreen';

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

// The @/shared/ui barrel pulls BottomSheet → @gorhom/bottom-sheet, whose real
// module needs reanimated internals the mock above doesn't provide.
jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@gorhom/bottom-sheet/mock'),
);

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
}));

const mockRequireAuth = jest.fn();
jest.mock('@/features/auth', () => ({
  useRequireAuth: () => mockRequireAuth,
}));

let mockProfileState: MyProfileState & { refresh: () => void };
jest.mock('../hooks/useMyProfile', () => ({
  get useMyProfile() {
    return () => mockProfileState;
  },
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
});

describe('SpotterStoryScreen', () => {
  it('ready: renders the full narrative card with the goal bar', async () => {
    const { getByTestId, getByText } = await render(<SpotterStoryScreen />);
    expect(getByText('Your spotter story')).toBeTruthy();
    expect(getByTestId('reputation-card')).toBeTruthy();
    expect(getByTestId('next-badge')).toBeTruthy(); // own view keeps the goal
  });

  it('loading: shows the skeleton, never a blank page', async () => {
    mockProfileState = { status: 'loading', refresh: jest.fn() };
    const { getByTestId, queryByTestId } = await render(<SpotterStoryScreen />);
    expect(getByTestId('story-skeleton')).toBeTruthy();
    expect(queryByTestId('reputation-card')).toBeNull();
  });

  it('signed out (deep link): invitation through the auth gate', async () => {
    mockProfileState = { status: 'signedOut', refresh: jest.fn() };
    const { getByText } = await render(<SpotterStoryScreen />);
    fireEvent.press(getByText('Log in'));
    expect(mockRequireAuth).toHaveBeenCalledWith({ context: 'tab_profile' });
  });

  it('error: retry goes through refresh', async () => {
    const refresh = jest.fn();
    mockProfileState = { status: 'error', refresh };
    const { getByText } = await render(<SpotterStoryScreen />);
    fireEvent.press(getByText('Try again'));
    expect(refresh).toHaveBeenCalled();
  });

  it('the back control pops the page', async () => {
    const { getByTestId } = await render(<SpotterStoryScreen />);
    fireEvent.press(getByTestId('story-back'));
    expect(mockBack).toHaveBeenCalled();
  });
});
