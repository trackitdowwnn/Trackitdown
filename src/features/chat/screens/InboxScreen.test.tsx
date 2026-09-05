/**
 * WHAT:  Tests for the Messages face of the inbox — its five states, the flat
 *        row list and its per-row date stamp, and the filter chips.
 * WHY:   ⚠️ THIS SCREEN SHIPPED WITH NO TESTS AT ALL and was then restructured
 *        (2026-08-28, Airbnb inbox pass: day headers, a rebuilt row, a shared
 *        skeleton). Nothing pinned its states or its copy — including
 *        "All caught up", which is the one moment this feature gets to be
 *        pleasant, and the per-filter empty copy that is the only way OUT of an
 *        empty filter.
 *
 *        ⚠️ THE GROUPING WENT ON 2026-09-04. The paragraph that stood here
 *        explained why grouping had to happen AFTER filtering, or a chip left
 *        headers over days it emptied. Both the hazard and its guard left with
 *        the headers; what replaced them is asserted below.
 * LINKS: ./InboxScreen.tsx; ../lib/inboxModel.ts; src/shared/lib/dayGroups.ts;
 *        docs/TESTING.md.
 */

import { act, fireEvent, render, within } from '@testing-library/react-native';

import { formatListStamp } from '@/shared/lib/dateTimeLabel';

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

// ⚠️ THIS BLOCK USED TO BE "grouped by day" AND ASSERTED THE OPPOSITE. The
// list was headed by `DayHeader`s until 2026-09-04; the owner asked for the
// messaging-app structure, where a flat recency-ordered list is the point and
// each row's own stamp carries the day a header used to. Both inbox faces
// dropped grouping together, which is how "one tab, one vocabulary" survives —
// the rule was never "both must group", it was "both must do the same thing".
describe('⚠️ flat, with the day on the row', () => {
  it('heads nothing — no calendar words above the rows', async () => {
    mockUseInbox.mockReturnValue(
      ready([
        thread({ threadId: 'a', lastMessageAt: new Date().toISOString() }),
        thread({ threadId: 'b', lastMessageAt: new Date(Date.now() - DAY_MS).toISOString() }),
      ]),
    );
    const { queryByText, getByTestId } = await act(async () => render(<ChatInboxScreen />));

    // "Today" was a header; nothing prints it now. "Yesterday" survives, but as
    // the older ROW's own stamp rather than a heading over it.
    expect(queryByText('Today')).toBeNull();
    expect(within(getByTestId('thread-row-b')).getByText('Yesterday')).toBeTruthy();
  });

  it('gives every row its own stamp, however many share a day', async () => {
    // Under grouping, three same-day threads shared one header and showed three
    // bare clocks. Flat, each row answers "when" by itself.
    const now = new Date().toISOString();
    mockUseInbox.mockReturnValue(
      ready([
        thread({ threadId: 'a', lastMessageAt: now, other: { firstName: 'Sam' } }),
        thread({ threadId: 'b', lastMessageAt: now, other: { firstName: 'Ada' } }),
        thread({ threadId: 'c', lastMessageAt: now, other: { firstName: 'Ben' } }),
      ]),
    );
    const { getByText, getByTestId } = await act(async () => render(<ChatInboxScreen />));

    expect(getByText('Ada')).toBeTruthy();
    expect(getByText('Ben')).toBeTruthy();
    const clock = formatListStamp(now);
    for (const id of ['a', 'b', 'c']) {
      expect(within(getByTestId(`thread-row-${id}`)).getByText(clock)).toBeTruthy();
    }
  });

  // ⚠️ THE LADDER IS THE WHOLE REASON THIS IS NOT JUST A CLOCK. A bare "14:32"
  // on a thread from July would be actively misleading, which is the failure a
  // day header used to prevent.
  it('degrades from a clock to a date as a thread ages', async () => {
    mockUseInbox.mockReturnValue(
      ready([thread({ threadId: 'old', lastMessageAt: '2026-07-23T10:00:00.000Z' })]),
    );
    const { getByTestId } = await act(async () => render(<ChatInboxScreen />));
    const meta = within(getByTestId('thread-row-old'));

    expect(meta.getByText(formatListStamp('2026-07-23T10:00:00.000Z'))).toBeTruthy();
    expect(meta.queryByText(/^\d{1,2}[:.]\d{2}$/)).toBeNull();
  });

  it('a chip that empties a day leaves nothing standing behind it', async () => {
    // The hazard this replaces: filtering a GROUPED list left "Yesterday"
    // heading nothing. There is no structure to strand now, and this is what
    // says so.
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
    const { getByText, queryByText, queryByTestId } = await act(async () =>
      render(<ChatInboxScreen />),
    );

    expect(queryByTestId('thread-meta-b')).toBeTruthy();
    // The chip counts unread THREADS, not unread messages — one here.
    await act(async () => {
      fireEvent.press(getByText('Unread (1)'));
    });

    expect(queryByTestId('thread-meta-a')).toBeTruthy();
    expect(queryByTestId('thread-meta-b')).toBeNull();
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
