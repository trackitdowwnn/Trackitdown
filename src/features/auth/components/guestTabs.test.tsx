/**
 * WHAT:  Tests for the guest states of the Inbox tab and the My Cars page
 *        (now a Profile push, not a tab) — a guest gets a friendly invitation
 *        whose "Log in" goes through the auth gate with the screen's context;
 *        a signed-in user gets the content; the sheet is never auto-fired by
 *        merely rendering the screen.
 * WHY:   "Tabs get invitations, actions get the sheet" holds for Inbox, and
 *        My Cars keeps its invitation now that it's pushed from Profile. The
 *        PROFILE tab is the one deliberate exception (recorded in
 *        features/auth/README.md): its tap opens the sheet directly via the
 *        tab-press gate — that behaviour is pinned in
 *        src/features/profile/hooks/useProfileTab.test.tsx, while THIS file
 *        pins that the other screens keep their invitation states.
 * LINKS: src/app/(tabs)/inbox.tsx; src/app/my-cars.tsx;
 *        src/features/auth (useRequireAuth);
 *        src/features/profile/hooks/useProfileTab.test.tsx; docs/TESTING.md.
 *
 * NOTE: This file lives here, NOT next to the route files — anything under
 * src/app/ becomes an Expo Router route, and a test there gets bundled into
 * the app (pulling @testing-library into the runtime bundle).
 */

import { fireEvent, render } from '@testing-library/react-native';

import { ToastProvider } from '@/shared/ui';

import InboxScreen from '../../../app/(tabs)/inbox';
// The screen file, not the route/barrel: the garage index also exports the add
// flow, whose import chain reaches the real supabase client.
import { MyCarsScreen } from '../../../features/garage/screens/MyCarsScreen';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

// MyCarsScreen now has a real data layer (the garage), so its module graph
// reaches the supabase client, which throws without env config. This test only
// cares about the SIGNED-OUT branch — it never loads a vehicle — so stub the
// client and the garage hook rather than configure a real one.
jest.mock('@/shared/api', () => ({ supabase: { rpc: jest.fn(), auth: {} } }));

// The garage screen carries an overflow sheet + a remove confirm, both gorhom
// sheets, which need a modal provider the app root supplies at runtime.
jest.mock('@gorhom/bottom-sheet', () => jest.requireActual('@gorhom/bottom-sheet/mock'));

// ToastProvider (which the garage screen needs) calls useReducedMotion, absent
// from reanimated's stock mock — the same shim PostDetailScreen.test uses.
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated/mock');
  return { __esModule: true, ...actual, default: actual.default, useReducedMotion: () => true };
});
jest.mock('../../../features/garage/hooks/useMyVehicles', () => ({
  useMyVehicles: () => ({
    status: 'ready',
    vehicles: [],
    refreshing: false,
    refresh: jest.fn(),
    retry: jest.fn(),
  }),
}));

jest.mock('expo-router', () => ({
  useNavigation: () => ({ setOptions: jest.fn() }),
  // MyCarsScreen's back button (pushed page) needs a router.
  useRouter: () => ({ back: jest.fn() }),
  // The inbox route's hidden-half badge sync runs on focus; a noop keeps
  // these tests about GATING, not freshness.
  useFocusEffect: () => {},
}));

// The route sets the tab badge through the provider; these tests render the
// route bare, so the hook is stubbed (badge behaviour has its own suites).
jest.mock('@/shared/ui', () => {
  const actual = jest.requireActual('@/shared/ui');
  return {
    ...actual,
    useTabBadges: () => ({ badges: {}, setBadge: jest.fn() }),
  };
});

const mockRequireAuth = jest.fn();
let mockSession: { status: string; userId: string | null } = {
  status: 'signedOut',
  userId: null,
};
jest.mock('@/features/auth', () => ({
  useRequireAuth: () => mockRequireAuth,
  useSession: () => mockSession,
}));


// The inbox route mounts the real chat inbox when signed in; this file tests
// the GATING, so the chat feature is stubbed to a marker.
jest.mock('@/features/chat', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { Text } = require('react-native');
  return { ChatInboxScreen: () => <Text>chat-inbox-content</Text> };
});

// The route's segment memory reaches AsyncStorage (native module, null in
// jest) — the house jest mock stands in.
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// The center screen mounts only on the Notifications segment; this file tests
// the route's gating, so it is stubbed like the chat screen above.
jest.mock('@/features/notifications/screens/NotificationCenterScreen', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { Text } = require('react-native');
  return { NotificationCenterScreen: () => <Text>center-content</Text> };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSession = { status: 'signedOut', userId: null };
});

describe('My Cars tab (guest)', () => {
  // The garage screen toasts (e.g. the vehicle cap), so it needs the provider.
  const renderGarage = () =>
    render(
      <ToastProvider>
        <MyCarsScreen />
      </ToastProvider>,
    );

  it('renders the invitation — and does NOT auto-fire the auth sheet', async () => {
    const { getByText } = await renderGarage();
    expect(getByText('Your cars live here')).toBeTruthy();
    expect(mockRequireAuth).not.toHaveBeenCalled(); // rendering never gates
  });

  it('"Log in" goes through the gate with the tab context', async () => {
    const { getByText } = await renderGarage();
    fireEvent.press(getByText('Log in'));
    expect(mockRequireAuth).toHaveBeenCalledWith({ context: 'tab_my_cars' });
  });

  it('signed in with an empty garage: one CTA, nothing competing with it', async () => {
    mockSession = { status: 'signedIn', userId: 'u1' };
    const { getByText, queryByText } = await renderGarage();
    // The empty garage has to SELL the reason to fill it — the whole feature is
    // a bet someone makes before anything has gone wrong...
    expect(getByText('No cars saved yet')).toBeTruthy();
    expect(getByText('Add your car')).toBeTruthy();
    expect(queryByText('Log in')).toBeNull();
    // ...so it gets exactly ONE action. The My-posts link and the secondary add
    // row appear only once there is a car to manage.
    expect(queryByText('My posts')).toBeNull();
    expect(queryByText('Add a car')).toBeNull();
  });
});

describe('Inbox tab (guest)', () => {
  it('renders the invitation — and does NOT auto-fire the auth sheet', async () => {
    const { getByText } = await render(<InboxScreen />);
    expect(getByText('Your messages and updates live here')).toBeTruthy();
    expect(mockRequireAuth).not.toHaveBeenCalled();
  });

  it('"Log in" goes through the gate with the tab context', async () => {
    const { getByText } = await render(<InboxScreen />);
    fireEvent.press(getByText('Log in'));
    expect(mockRequireAuth).toHaveBeenCalledWith({ context: 'tab_inbox' });
  });

  it('signed in: shows the chat inbox, no invitation', async () => {
    mockSession = { status: 'signedIn', userId: 'u1' };
    const { getByText, queryByText } = await render(<InboxScreen />);
    expect(getByText('chat-inbox-content')).toBeTruthy();
    expect(queryByText('Log in')).toBeNull();
  });
});
