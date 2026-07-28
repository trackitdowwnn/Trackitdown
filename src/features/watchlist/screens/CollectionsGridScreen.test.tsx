/**
 * WHAT:  Wiring tests for CollectionsGridScreen — the tab's tiles, what each
 *        opens, the empty invitation, and the deliberate choice NOT to error
 *        the screen when only the collection NAMES fail to load.
 * WHY:   This screen replaced a plain list, so the states it inherited (guest
 *        invitation, error retry) have to survive the change. The
 *        names-failed-but-watches-loaded case is the one a reader would get
 *        wrong: erroring there would hide a watchlist that loaded perfectly
 *        well, over a cosmetic failure.
 * LINKS: src/features/watchlist/screens/CollectionsGridScreen.tsx;
 *        src/features/watchlist/lib/collectionsModel.ts; docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import type { PostSummary } from '@/shared/types';

import type { UseCollectionsResult } from '../hooks/useCollections';
import type { UseWatchlistResult } from '../hooks/useWatchlist';
import type { WatchedPost } from '../types';
import { CollectionsGridScreen } from './CollectionsGridScreen';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@gorhom/bottom-sheet/mock'),
);

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

let mockWatchlist: UseWatchlistResult;
jest.mock('../hooks/useWatchlist', () => ({
  get useWatchlist() {
    return () => mockWatchlist;
  },
}));

let mockCollections: UseCollectionsResult;
jest.mock('../hooks/useCollections', () => ({
  get useCollections() {
    return () => mockCollections;
  },
}));

const COMMUTE = { id: 'cccccccc-0000-0000-0000-00000000000c', name: 'My commute', createdAt: 'x' };

const entry = (id: string, collectionId: string | null): WatchedPost => ({
  kind: 'post',
  watchedAt: '2026-07-21T10:00:00Z',
  collectionId,
  post: {
    id,
    photos: [],
    make: 'BMW',
    model: '3 Series',
    colour: 'Blue',
    plate: 'AB12 CDE',
    status: 'active',
    lastSeenAt: '2026-07-20T10:00:00Z',
    bountyPence: 50000,
  } as PostSummary,
});

const watchlist = (overrides: Partial<UseWatchlistResult>): UseWatchlistResult => ({
  status: 'ready',
  entries: [],
  active: [],
  resolved: [],
  refreshing: false,
  refresh: jest.fn(async () => {}),
  retry: jest.fn(),
  ...overrides,
});

const collections = (overrides: Partial<UseCollectionsResult>): UseCollectionsResult => ({
  status: 'ready',
  collections: [],
  reload: jest.fn(),
  create: jest.fn(),
  rename: jest.fn(),
  remove: jest.fn(),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockWatchlist = watchlist({});
  mockCollections = collections({});
});

describe('CollectionsGridScreen', () => {
  it('empty: keeps the invitation the flat list used to show', async () => {
    const { getByText } = await act(async () => render(<CollectionsGridScreen />));

    expect(getByText('Tap the bookmark on any post to follow it here.')).toBeTruthy();
    fireEvent.press(getByText('Explore posts'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/explore');
  });

  it('shows one Saved tile holding everything before any list exists', async () => {
    // The zero-migration case: every pre-existing watch has a null collection.
    mockWatchlist = watchlist({ entries: [entry('a', null), entry('b', null)] });
    const { getByTestId } = await act(async () => render(<CollectionsGridScreen />));

    expect(getByTestId('collection-tile-saved')).toBeTruthy();
    expect(getByTestId('collection-tile-saved').props.accessibilityLabel).toBe('Saved, 2 cars');
  });

  it('opens a tile onto its own screen', async () => {
    mockWatchlist = watchlist({ entries: [entry('a', COMMUTE.id)] });
    mockCollections = collections({ collections: [COMMUTE] });
    const { getByTestId } = await act(async () => render(<CollectionsGridScreen />));

    fireEvent.press(getByTestId(`collection-tile-${COMMUTE.id}`));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/collection/[collectionId]',
      params: { collectionId: COMMUTE.id },
    });
  });

  it('shows a list the user made but has not filled yet', async () => {
    // This tile comes from the names call — the watchlist payload alone can't
    // describe an empty list, which is why that call exists at all.
    mockCollections = collections({ collections: [COMMUTE] });
    const { getByTestId } = await act(async () => render(<CollectionsGridScreen />));

    expect(getByTestId(`collection-tile-${COMMUTE.id}`).props.accessibilityLabel).toBe(
      'My commute, 0 cars',
    );
  });

  it('renders the watchlist even when the names fail to load', async () => {
    // A cosmetic failure must not hide a watchlist that loaded fine.
    mockWatchlist = watchlist({ entries: [entry('a', null)] });
    mockCollections = collections({ status: 'error' });
    const { getByTestId, queryByText } = await act(async () => render(<CollectionsGridScreen />));

    expect(getByTestId('collection-tile-saved')).toBeTruthy();
    expect(queryByText("We couldn't load your watchlist.")).toBeNull();
  });

  it('error: retry goes through the watchlist hook', async () => {
    const retry = jest.fn();
    mockWatchlist = watchlist({ status: 'error', retry });
    const { getByText } = await act(async () => render(<CollectionsGridScreen />));

    expect(getByText("We couldn't load your watchlist.")).toBeTruthy();
    fireEvent.press(getByText('Try again'));
    expect(retry).toHaveBeenCalled();
  });
});
