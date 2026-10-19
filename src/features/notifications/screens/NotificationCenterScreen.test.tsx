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

  // ⚠️ FLIPPED TWICE: day headers until 2026-09-04, flat until 2026-10-19,
  // grouped again now (owner's pick — the feed read as one undifferentiated
  // stack). Messages stays flat; see the screen's note.
  it('renders rows under a Today heading, unread dot showing', async () => {
    const { getByTestId } = await act(async () => render(<NotificationCenterScreen />));
    expect(getByTestId('day-header-Today')).toHaveTextContent('Today');
    expect(getByTestId('unread-n-1')).toBeTruthy();
  });

  it('groups older rows under Yesterday and Earlier, in that order', async () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    mockFetch.mockResolvedValue([
      rowFixture({ id: 'n-today' }),
      rowFixture({ id: 'n-yday', createdAt: new Date(Date.now() - DAY_MS).toISOString() }),
      rowFixture({ id: 'n-old', createdAt: new Date(Date.now() - 9 * DAY_MS).toISOString() }),
    ]);
    const { getAllByText, queryAllByTestId } = await act(async () =>
      render(<NotificationCenterScreen />),
    );

    // Headers are the screen-reader headings; "Yesterday" is also the row's
    // own stamp, so read the headings, not the text.
    const headings = getAllByText(/^(Today|Yesterday|Earlier)$/)
      .filter((node) => node.props.accessibilityRole === 'header')
      .map((node) => node.props.children);
    expect(headings).toEqual(['Today', 'Yesterday', 'Earlier']);
    // One row per group: every row starts its group, so no divider at all.
    expect(queryAllByTestId('inbox-row-divider')).toHaveLength(0);
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

  // ⚠️ TWO since 2026-10-19 (was one from 2026-09-24): the body is often the
  // safety advice itself, and one line cut it mid-sentence.
  it('gives an ordinary row’s body two lines', async () => {
    const { getByText } = await act(async () => render(<NotificationCenterScreen />));

    expect(getByText('Keep an eye out — never approach.').props.numberOfLines).toBe(2);
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

// 2026-10-19: the same inset hairline the Messages face draws, between rows only.
describe('dividers', () => {
  it('draws one fewer divider than there are rows', async () => {
    mockFetch.mockResolvedValue([rowFixture(), rowFixture({ id: 'n-2' }), rowFixture({ id: 'n-3' })]);
    const { getAllByTestId } = await act(async () => render(<NotificationCenterScreen />));

    expect(getAllByTestId('inbox-row-divider')).toHaveLength(2);
  });

  it('draws none under a single row', async () => {
    const { queryAllByTestId } = await act(async () => render(<NotificationCenterScreen />));

    expect(queryAllByTestId('inbox-row-divider')).toHaveLength(0);
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
    // ⚠️ BUT ITS STRIP STAYS (2026-10-19), so the list doesn't jump up 52pt
    // the moment the last unread clears.
    expect(getByTestId('mark-all-strip')).toBeTruthy();
  });

  it('keeps the strip with nothing unread at all — no jump on the next visit', async () => {
    mockFetch.mockResolvedValue([rowFixture({ readAt: new Date().toISOString() })]);
    const { getByTestId, queryByTestId } = await act(async () =>
      render(<NotificationCenterScreen />),
    );

    expect(getByTestId('mark-all-strip')).toBeTruthy();
    expect(queryByTestId('mark-all-read')).toBeNull();
  });
});
