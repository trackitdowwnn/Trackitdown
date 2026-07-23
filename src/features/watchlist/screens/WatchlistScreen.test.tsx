/**
 * WHAT:  Wiring tests for WatchlistScreen — the empty invitation with its
 *        Explore action, entries rendering as VehicleCards, the "No longer
 *        active" header appearing only when resolved entries exist, the
 *        tombstone row's minimal payload, and the error state's retry.
 * WHY:   This tab is where a watcher learns outcomes; a header that renders
 *        over an empty section (or a tombstone that leaks more than
 *        make/model/colour) would break the section's promise. The empty
 *        state is most guests' first sight of the feature.
 * LINKS: src/features/watchlist/screens/WatchlistScreen.tsx;
 *        src/features/watchlist/hooks/useWatchlist.ts; docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import type { PostSummary } from '@/shared/types';

import type { UseWatchlistResult } from '../hooks/useWatchlist';
import type { WatchedPost, WatchedTombstone } from '../types';
import { WatchlistScreen } from './WatchlistScreen';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

// NOTE: no inline reanimated mock here — VehicleCard's GestureDetector needs
// the mapped react-native-reanimated/mock (see package.json moduleNameMapper).

// The @/shared/ui barrel pulls BottomSheet → @gorhom/bottom-sheet, whose real
// module needs reanimated internals the mock above doesn't provide.
jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@gorhom/bottom-sheet/mock'),
);

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// The real toggle reaches the supabase client via its hydration effect —
// out of scope for screen wiring.
jest.mock('../components/WatchToggle', () => ({
  WatchToggle: () => null,
}));

let mockWatchlist: UseWatchlistResult;
jest.mock('../hooks/useWatchlist', () => ({
  get useWatchlist() {
    return () => mockWatchlist;
  },
}));

const summary = (overrides: Partial<PostSummary>): PostSummary => ({
  id: 'post-1',
  photos: [],
  make: 'BMW',
  model: '3 Series',
  colour: 'Blue',
  plate: 'AB12 CDE',
  status: 'active',
  lastSeenAt: '2026-07-20T10:00:00Z',
  bountyPence: 50000,
  ...overrides,
});

const postEntry = (id: string, status: PostSummary['status'] = 'active'): WatchedPost => ({
  kind: 'post',
  watchedAt: '2026-07-21T10:00:00Z',
  post: summary({ id, status }),
});

const TOMBSTONE: WatchedTombstone = {
  kind: 'tombstone',
  watchedAt: '2026-07-01T10:00:00Z',
  postId: 'gone-1',
  status: 'expired',
  make: 'Ford',
  model: 'Focus',
  colour: 'Red',
  resolvedAt: '2026-07-15T10:00:00Z',
  thumbnailUrl: null,
};

const state = (overrides: Partial<UseWatchlistResult>): UseWatchlistResult => ({
  status: 'ready',
  active: [],
  resolved: [],
  refreshing: false,
  refresh: jest.fn(async () => {}),
  retry: jest.fn(),
  ...overrides,
});

// VehicleCard runs a press animation + useTimeAgo interval; flush pending
// timers so leaked callbacks can't corrupt other suites in the worker.
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockWatchlist = state({});
});

afterEach(async () => {
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

describe('WatchlistScreen', () => {
  it('empty: renders the invitation and Explore action routes to the feed', async () => {
    const { getByText } = await render(<WatchlistScreen />);

    expect(getByText('Tap the bookmark on any post to follow it here.')).toBeTruthy();

    fireEvent.press(getByText('Explore posts'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/explore');
  });

  it('renders active watches as vehicle cards, newest watch first', async () => {
    mockWatchlist = state({ active: [postEntry('a'), postEntry('b')] });
    const { getAllByRole, queryByText } = await render(<WatchlistScreen />);

    const cards = getAllByRole('button');
    expect(cards.length).toBeGreaterThanOrEqual(2);
    expect(cards[0].props.accessibilityLabel).toContain('Blue BMW 3 Series');
    // No resolved entries → the section header must NOT render.
    expect(queryByText('No longer active')).toBeNull();
  });

  it('shows the "No longer active" header only when resolved entries exist', async () => {
    mockWatchlist = state({
      active: [postEntry('a')],
      resolved: [postEntry('c', 'recovered')],
    });
    const { getByText } = await render(<WatchlistScreen />);

    expect(getByText('No longer active')).toBeTruthy();
  });

  it('tombstone row: make/model with the quiet closed line, nothing more', async () => {
    mockWatchlist = state({ resolved: [TOMBSTONE] });
    const { getByText, getByLabelText } = await render(<WatchlistScreen />);

    expect(getByText('Ford Focus')).toBeTruthy();
    expect(getByText('Red · no longer listed')).toBeTruthy();
    expect(getByLabelText('Red Ford Focus, no longer listed')).toBeTruthy();
  });

  it('tapping a card navigates to the post detail', async () => {
    mockWatchlist = state({ active: [postEntry('a')] });
    const { getAllByRole } = await render(<WatchlistScreen />);

    fireEvent.press(getAllByRole('button')[0]);
    expect(mockPush).toHaveBeenCalledWith('/post/a');
  });

  it('error: retry goes through the hook', async () => {
    const retry = jest.fn();
    mockWatchlist = state({ status: 'error', retry });
    const { getByText } = await render(<WatchlistScreen />);

    expect(getByText("We couldn't load your watchlist.")).toBeTruthy();
    fireEvent.press(getByText('Try again'));
    expect(retry).toHaveBeenCalled();
  });
});
