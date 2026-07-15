/**
 * WHAT:  Tests for the guest states of the My Cars and Inbox tabs — a guest
 *        gets a friendly invitation whose "Log in" goes through the auth gate
 *        with the tab's context; a signed-in user gets the tab content; the
 *        sheet is never auto-fired by merely rendering the tab.
 * WHY:   "Tabs get invitations, actions get the sheet" is a hard rule of the
 *        deferred-auth pattern — a tab that walls or auto-fires the sheet
 *        reintroduces the auth wall.
 * LINKS: src/app/(tabs)/{my-cars,inbox}.tsx; src/features/auth (useRequireAuth);
 *        docs/TESTING.md.
 *
 * NOTE: This file lives here, NOT next to the route files — anything under
 * src/app/ becomes an Expo Router route, and a test there gets bundled into
 * the app (pulling @testing-library into the runtime bundle).
 */

import { fireEvent, render } from '@testing-library/react-native';

import InboxScreen from '../../../app/(tabs)/inbox';
import MyCarsScreen from '../../../app/(tabs)/my-cars';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('expo-router', () => ({
  useNavigation: () => ({ setOptions: jest.fn() }),
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
