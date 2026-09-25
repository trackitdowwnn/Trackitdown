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
  // Null by default: the server withholds the photo whenever the caller has no
  // standing on that post, which makes pictureless the ordinary row.
  imageUrl: null,
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

  // ⚠️ WAS 'renders rows under day headers'. The list went flat on 2026-09-04
  // alongside the Messages face — each row's own stamp carries the day now, so
  // there is no "Today" heading to find. Both faces dropped grouping together,
  // which is how "one tab, one vocabulary" survives the change.
  it('renders rows with no day heading, unread dot showing', async () => {
    const { queryByText, getByTestId } = await act(async () => render(<NotificationCenterScreen />));
    expect(queryByText('Today')).toBeNull();
    expect(getByTestId('unread-n-1')).toBeTruthy();
  });

  it('shows the errand on unread needs-attention kinds only', async () => {
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

  it('⚠️ says WHAT needs doing, in the preview’s place', async () => {
    // The minimal pass (2026-09-24) took the amber bar and ring, but the words
    // stay: a spotter who never adds bank details never gets paid. The row
    // keeps to two lines by putting the errand where the preview goes.
    mockFetch.mockResolvedValue([
      rowFixture({ id: 'n-credited', kind: 'credited', payload: { type: 'credited', postId: POST_ID } }),
    ]);
    const { getByText, queryByText } = await act(async () => render(<NotificationCenterScreen />));

    expect(getByText('Add your bank details')).toBeTruthy();
    expect(queryByText('Keep an eye out — never approach.')).toBeNull();
  });

  it('drops the errand once payouts are set up — the chip no longer nags a spotter who has done it', async () => {
    // It used to show to every spotter with an unread credit, including ones
    // whose details were already in and ones already paid.
    mockFetch.mockResolvedValue([
      rowFixture({ id: 'n-credited', kind: 'credited', payload: { type: 'credited', postId: POST_ID } }),
      rowFixture({
        id: 'n-still',
        kind: 'still_missing',
        payload: { type: 'still_missing', postId: POST_ID },
      }),
    ]);
    const { queryByText, queryByTestId, getByTestId } = await act(async () =>
      render(<NotificationCenterScreen payoutsSetUp />),
    );

    expect(queryByText('Add your bank details')).toBeNull();
    expect(queryByTestId('attention-n-credited')).toBeNull();
    // Only the credited errand is settled by payouts — other asks stay loud.
    expect(getByTestId('attention-n-still')).toBeTruthy();
  });

  it('gives the preview back once the row is read', async () => {
    mockFetch.mockResolvedValue([
      rowFixture({
        id: 'n-read-credited',
        kind: 'credited',
        payload: { type: 'credited', postId: POST_ID },
        readAt: new Date().toISOString(),
      }),
    ]);
    const { getByText, queryByText } = await act(async () => render(<NotificationCenterScreen />));

    expect(queryByText('Add your bank details')).toBeNull();
    expect(getByText('Keep an eye out — never approach.')).toBeTruthy();
  });

  it('keeps an ordinary row to a one-line preview', async () => {
    const { getByText } = await act(async () => render(<NotificationCenterScreen />));

    expect(getByText('Keep an eye out — never approach.').props.numberOfLines).toBe(1);
  });

  it('leads with the car’s photo when the server sent one', async () => {
    mockFetch.mockResolvedValue([
      rowFixture({ id: 'n-photo', imageUrl: 'https://example.test/car.jpg' }),
    ]);
    const { getByTestId } = await act(async () => render(<NotificationCenterScreen />));

    expect(getByTestId('notification-photo-n-photo')).toBeTruthy();
  });

  it('⚠️ falls back to the icon when there is no photo — the COMMON case', async () => {
    // image_url is null whenever the caller has no standing on that post, and
    // for every kind that is about money rather than a car. A pictureless row
    // must look deliberate, not broken.
    mockFetch.mockResolvedValue([rowFixture({ id: 'n-plain', imageUrl: null })]);
    const { queryByTestId, getByTestId } = await act(async () =>
      render(<NotificationCenterScreen />),
    );

    expect(queryByTestId('notification-photo-n-plain')).toBeNull();
    expect(getByTestId('notification-n-plain')).toBeTruthy();
  });

  it('⚠️ speaks the same words it shows', async () => {
    // The label used to append " Needs your attention." — a sentence no sighted
    // user ever saw, describing a stripe rather than the errand.
    mockFetch.mockResolvedValue([
      rowFixture({ id: 'n-credited', kind: 'credited', payload: { type: 'credited', postId: POST_ID } }),
    ]);
    const { getByTestId } = await act(async () => render(<NotificationCenterScreen />));

    expect(getByTestId('notification-n-credited').props.accessibilityLabel).toContain(
      'Add your bank details.',
    );
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
