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

import InboxScreen from '../../../app/(tabs)/inbox';
// The screen file, not the route/barrel: the vehicles index also exports
// PostDetailScreen, whose import chain reaches the real supabase client.
import { MyCarsScreen } from '../../../features/vehicles/screens/MyCarsScreen';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('expo-router', () => ({
  useNavigation: () => ({ setOptions: jest.fn() }),
  // MyCarsScreen's back button (pushed page) needs a router.
  useRouter: () => ({ back: jest.fn() }),
}));

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

beforeEach(() => {
  jest.clearAllMocks();
  mockSession = { status: 'signedOut', userId: null };
});

describe('My Cars tab (guest)', () => {
  it('renders the invitation — and does NOT auto-fire the auth sheet', async () => {
    const { getByText } = await render(<MyCarsScreen />);
    expect(getByText('Your cars live here')).toBeTruthy();
    expect(mockRequireAuth).not.toHaveBeenCalled(); // rendering never gates
  });

  it('"Log in" goes through the gate with the tab context', async () => {
    const { getByText } = await render(<MyCarsScreen />);
    fireEvent.press(getByText('Log in'));
    expect(mockRequireAuth).toHaveBeenCalledWith({ context: 'tab_my_cars' });
  });

  it('signed in: shows the tab content, no invitation', async () => {
    mockSession = { status: 'signedIn', userId: 'u1' };
    const { getByText, queryByText } = await render(<MyCarsScreen />);
    expect(getByText('Your posts and their status land here.')).toBeTruthy();
    expect(queryByText('Log in')).toBeNull();
  });
});

describe('Inbox tab (guest)', () => {
  it('renders the invitation — and does NOT auto-fire the auth sheet', async () => {
    const { getByText } = await render(<InboxScreen />);
    expect(getByText('Your messages live here')).toBeTruthy();
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
