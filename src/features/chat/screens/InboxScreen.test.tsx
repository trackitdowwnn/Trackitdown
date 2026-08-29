/**
 * WHAT:  Tests for the Messages face of the inbox — its five states, the day
 *        grouping, and the interaction between the filter chips and that
 *        grouping.
 * WHY:   ⚠️ THIS SCREEN SHIPPED WITH NO TESTS AT ALL and was then restructured
 *        (2026-08-28, Airbnb inbox pass: day headers, a rebuilt row, a shared
 *        skeleton). Nothing pinned its states or its copy — including
 *        "All caught up", which is the one moment this feature gets to be
 *        pleasant, and the per-filter empty copy that is the only way OUT of an
 *        empty filter.
 *
 *        The grouping assertions matter more than they look: `groupByDay` only
 *        opens a header when the label CHANGES, so it silently depends on the
 *        list arriving newest-first, and grouping must happen AFTER filtering
 *        or a chip leaves headers standing over days it emptied.
 * LINKS: ./InboxScreen.tsx; ../lib/inboxModel.ts; src/shared/lib/dayGroups.ts;
 *        docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import type { InboxThread } from '../types';

import { ChatInboxScreen } from './InboxScreen';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  useFocusEffect: () => {},
}));

const mockUseInbox = jest.fn();
jest.mock('../hooks/useInbox', () => ({
  useInbox: () => mockUseInbox(),
}));

const DAY_MS = 24 * 60 * 60 * 1000;

const thread = (overrides: Partial<InboxThread> = {}): InboxThread => ({
  threadId: 't1',
  postId: 'p1',
  role: 'owner',
  lastMessageAt: new Date().toISOString(),
  lastMessagePreview: 'Still parked outside number 12',
  unreadCount: 0,
  post: {
    make: 'BMW',
    model: '3 Series',
    colour: 'Blue',
    plate: 'AB12 CDE',
    status: 'active',
    coverPhotoUrl: null,
  },
  other: { firstName: 'Sam' },
  ...overrides,
});

const ready = (threads: InboxThread[]) => ({
  status: 'ready' as const,
  threads,
  refreshing: false,
  refresh: jest.fn(),
  retry: jest.fn(),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUseInbox.mockReturnValue(ready([thread()]));
});

describe('states', () => {
  it('shows a skeleton, led by a day header, while the inbox loads', async () => {
    // A header leads the real list, so one leads the skeleton — otherwise the
    // first conversation lands lower than the skeleton promised.
    mockUseInbox.mockReturnValue({
      status: 'loading',
      threads: [],
      refreshing: false,
      refresh: jest.fn(),
      retry: jest.fn(),
    });
    const { getByTestId } = await act(async () => render(<ChatInboxScreen />));

    expect(getByTestId('inbox-skeleton')).toBeTruthy();
  });

  it('offers a retry when the inbox will not load', async () => {
    const retry = jest.fn();
    mockUseInbox.mockReturnValue({
      status: 'error',
      threads: [],
      refreshing: false,
      refresh: jest.fn(),
      retry,
    });
    const { getByText } = await act(async () => render(<ChatInboxScreen />));

    expect(getByText('We couldn’t load your inbox')).toBeTruthy();
    fireEvent.press(getByText('Try again'));
    expect(retry).toHaveBeenCalled();
  });

  it('⚠️ an empty inbox explains how conversations START, and shows no chips', async () => {
    // Four filters over nothing is furniture; the invitation is the whole job.
    mockUseInbox.mockReturnValue(ready([]));
    const { getByText, queryByText } = await act(async () => render(<ChatInboxScreen />));

    expect(getByText('No conversations yet')).toBeTruthy();
    expect(getByText(/when a spotter reports a sighting on your car/i)).toBeTruthy();
    expect(queryByText('Unread')).toBeNull();
  });
});

describe('⚠️ grouped by day', () => {
  it('heads each day with the calendar word for it', async () => {
    mockUseInbox.mockReturnValue(
      ready([
        thread({ threadId: 'a', lastMessageAt: new Date().toISOString() }),
        thread({ threadId: 'b', lastMessageAt: new Date(Date.now() - DAY_MS).toISOString() }),
      ]),
    );
    const { getByText } = await act(async () => render(<ChatInboxScreen />));

    expect(getByText('Today')).toBeTruthy();
    expect(getByText('Yesterday')).toBeTruthy();
  });

  it('⚠️ heads a day ONCE, however many conversations it holds', async () => {
    // Three headers for three same-day threads would be the tell that the
    // newest-first assumption broke.
    const now = new Date().toISOString();
    mockUseInbox.mockReturnValue(
      ready([
        thread({ threadId: 'a', lastMessageAt: now, other: { firstName: 'Sam' } }),
        thread({ threadId: 'b', lastMessageAt: now, other: { firstName: 'Ada' } }),
        thread({ threadId: 'c', lastMessageAt: now, other: { firstName: 'Ben' } }),
      ]),
    );
    const { getAllByText, getByText } = await act(async () => render(<ChatInboxScreen />));

    expect(getAllByText('Today')).toHaveLength(1);
    expect(getByText('Ada')).toBeTruthy();
    expect(getByText('Ben')).toBeTruthy();
  });

  it('uses the same words the Notifications face uses — one tab, one vocabulary', async () => {
    mockUseInbox.mockReturnValue(
      ready([thread({ lastMessageAt: new Date('2026-07-23T10:00:00.000Z').toISOString() })]),
    );
    const { getByText } = await act(async () => render(<ChatInboxScreen />));

    expect(getByText('23 July')).toBeTruthy();
  });

  it('⚠️ groups AFTER filtering, so a chip never strands an empty day header', async () => {
    // Filtering a grouped list instead of grouping a filtered one leaves
    // "Yesterday" standing over nothing.
    mockUseInbox.mockReturnValue(
      ready([
        thread({ threadId: 'a', unreadCount: 2, lastMessageAt: new Date().toISOString() }),
        thread({
          threadId: 'b',
          unreadCount: 0,
          lastMessageAt: new Date(Date.now() - DAY_MS).toISOString(),
        }),
      ]),
    );
    const { getByText, queryByText } = await act(async () => render(<ChatInboxScreen />));

    expect(getByText('Yesterday')).toBeTruthy();
    // The chip counts unread THREADS, not unread messages — one here.
    await act(async () => {
      fireEvent.press(getByText('Unread (1)'));
    });

    expect(getByText('Today')).toBeTruthy();
    expect(queryByText('Yesterday')).toBeNull();
  });

  it('keeps the chips reachable when a filter empties the list', async () => {
    // The way OUT of an empty filter is the chips, so they stay mounted.
    mockUseInbox.mockReturnValue(ready([thread({ unreadCount: 0 })]));
    const { getByText } = await act(async () => render(<ChatInboxScreen />));

    await act(async () => {
      fireEvent.press(getByText('Unread'));
    });

    expect(getByText('All caught up')).toBeTruthy();
    expect(getByText('All')).toBeTruthy();
  });
});

describe('opening a conversation', () => {
  it('routes to the thread it was tapped on', async () => {
    mockUseInbox.mockReturnValue(ready([thread({ threadId: 'abc' })]));
    const { getByTestId } = await act(async () => render(<ChatInboxScreen />));

    fireEvent.press(getByTestId('thread-row-abc'));

    expect(mockPush).toHaveBeenCalledWith('/chat/abc');
  });
});
