/**
 * WHAT:  Tests for the notification center — each state, the read-state
 *        transitions (tap marks ONE read and routes; mark-all clears; opening
 *        never auto-clears), the needs-attention treatment, and the
 *        unroutable-payload row that marks read but goes nowhere.
 * WHY:   The read-state rules are the feature's contract: unread is the
 *        user's to clear. Auto-mark-on-open sneaking in would be invisible
 *        in review and permanent in habit. The routing assertion pins that a
 *        row and its push land in the same place — the single-source rule's
 *        client half.
 * LINKS: ./NotificationCenterScreen.tsx; ../hooks/useNotificationCenter.ts;
 *        ../api/notificationsApi.ts.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { NotificationCenterScreen } from './NotificationCenterScreen';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  useFocusEffect: () => {},
}));

const mockSetBadge = jest.fn();
jest.mock('@/shared/ui', () => {
  const actual = jest.requireActual('@/shared/ui');
  return {
    ...actual,
    useTabBadges: () => ({ badges: {}, setBadge: mockSetBadge }),
  };
});

const mockFetch = jest.fn();
const mockMarkRead = jest.fn();
const mockMarkAll = jest.fn();
jest.mock('../api/notificationsApi', () => ({
  fetchNotifications: (...args: unknown[]) => mockFetch(...(args as [])),
  markNotificationRead: (...args: unknown[]) => mockMarkRead(...args),
  markAllNotificationsRead: (...args: unknown[]) => mockMarkAll(...(args as [])),
}));

const POST_ID = '11111111-2222-3333-4444-555555555555';

const rowFixture = (overrides: Record<string, unknown> = {}) => ({
  id: 'n-1',
  kind: 'alert' as const,
  title: 'A blue BMW was reported stolen near Camden',
  body: 'Keep an eye out — never approach.',
  payload: { type: 'alert' as const, postId: POST_ID },
  readAt: null,
  createdAt: new Date().toISOString(),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockResolvedValue([rowFixture()]);
  mockMarkAll.mockResolvedValue(1);
});

describe('states', () => {
  it('shows the empty state when nothing has ever landed', async () => {
    mockFetch.mockResolvedValue([]);
    const { getByText } = await act(async () => render(<NotificationCenterScreen />));
    expect(getByText('Nothing yet')).toBeTruthy();
    expect(getByText(/alerts, sightings and payout updates/i)).toBeTruthy();
  });

  it('renders rows under day headers, unread dot showing', async () => {
    const { getByText, getByTestId } = await act(async () => render(<NotificationCenterScreen />));
    expect(getByText('Today')).toBeTruthy();
    expect(getByTestId('unread-n-1')).toBeTruthy();
  });

  it('keeps the attention bar on unread needs-attention kinds only', async () => {
    mockFetch.mockResolvedValue([
      rowFixture({ id: 'n-credited', kind: 'credited', payload: { type: 'credited', postId: POST_ID } }),
      rowFixture({
        id: 'n-read-credited',
        kind: 'credited',
        payload: { type: 'credited', postId: POST_ID },
        readAt: new Date().toISOString(),
      }),
      rowFixture({ id: 'n-alert' }),
    ]);
    const { getByTestId, queryByTestId } = await act(async () =>
      render(<NotificationCenterScreen />),
    );
    expect(getByTestId('attention-n-credited')).toBeTruthy();
    // Read = resolved as far as the treatment is concerned; and ordinary
    // kinds never get the bar at all.
    expect(queryByTestId('attention-n-read-credited')).toBeNull();
    expect(queryByTestId('attention-n-alert')).toBeNull();
  });
});

describe('read-state transitions', () => {
  it('opening the segment does NOT auto-mark anything read', async () => {
    await act(async () => render(<NotificationCenterScreen />));
    expect(mockMarkRead).not.toHaveBeenCalled();
    expect(mockMarkAll).not.toHaveBeenCalled();
  });

  it('tap marks THAT row read and routes where its push would have', async () => {
    const { getByTestId, queryByTestId } = await act(async () =>
      render(<NotificationCenterScreen />),
    );
    await act(async () => {
      fireEvent.press(getByTestId('notification-n-1'));
    });
    expect(mockMarkRead).toHaveBeenCalledWith('n-1');
    expect(mockPush).toHaveBeenCalledWith(`/post/${POST_ID}`);
    // Optimistic: the dot is gone without waiting for the server.
    expect(queryByTestId('unread-n-1')).toBeNull();
  });

  it('an unroutable payload still marks read but goes NOWHERE', async () => {
    // An old row after a schema change: better no navigation than a wrong one.
    mockFetch.mockResolvedValue([rowFixture({ payload: null })]);
    const { getByTestId } = await act(async () => render(<NotificationCenterScreen />));
    await act(async () => {
      fireEvent.press(getByTestId('notification-n-1'));
    });
    expect(mockMarkRead).toHaveBeenCalledWith('n-1');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('mark-all clears every dot and then hides itself', async () => {
    mockFetch.mockResolvedValue([rowFixture(), rowFixture({ id: 'n-2' })]);
    const { getByTestId, queryByTestId } = await act(async () =>
      render(<NotificationCenterScreen />),
    );
    await act(async () => {
      fireEvent.press(getByTestId('mark-all-read'));
    });
    expect(mockMarkAll).toHaveBeenCalled();
    expect(queryByTestId('unread-n-1')).toBeNull();
    expect(queryByTestId('unread-n-2')).toBeNull();
    // Nothing left for it to do — the affordance goes away, not disabled.
    expect(queryByTestId('mark-all-read')).toBeNull();
  });
});
