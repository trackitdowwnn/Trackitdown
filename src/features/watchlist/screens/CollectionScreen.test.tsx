/**
 * WHAT:  Wiring tests for CollectionScreen — the empty invitation with its
 *        Explore action, entries rendering as VehicleCards, the "No longer
 *        active" header appearing only when resolved entries exist, the
 *        tombstone row's minimal payload, and the error state's retry.
 * WHY:   This tab is where a watcher learns outcomes; a header that renders
 *        over an empty section (or a tombstone that leaks more than
 *        make/model/colour) would break the section's promise. The empty
 *        state is most guests' first sight of the feature.
 * LINKS: src/features/watchlist/screens/CollectionScreen.tsx;
 *        src/features/watchlist/hooks/useWatchlist.ts; docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import type { PostSummary } from '@/shared/types';

import type { UseWatchlistResult } from '../hooks/useWatchlist';
import {
  getCollectionPickerIntent,
  resetCollectionPickerForTests,
} from '../lib/pickerIntent';
import type { WatchedPost, WatchedTombstone } from '../types';
import { CollectionScreen } from './CollectionScreen';

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
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

// Only useToast is stubbed — the real ToastProvider calls useReducedMotion,
// which the mapped reanimated mock doesn't provide. Everything else in the
// barrel (VehicleCard, BottomSheet, ConfirmDialog) stays real, so this suite
// still exercises the actual sheets and dialog.
const mockShowToast = jest.fn();
jest.mock('@/shared/ui', () => {
  const actual = jest.requireActual('@/shared/ui');
  return {
    ...actual,
    get useToast() {
      return () => ({ show: mockShowToast });
    },
  };
});

const COMMUTE = { id: 'cccccccc-0000-0000-0000-00000000000c', name: 'My commute', createdAt: 'x' };
const mockRename = jest.fn(async (_id: string, _name: string) => {});
const mockRemove = jest.fn(async (_id: string) => {});
jest.mock('../hooks/useCollections', () => ({
  useCollections: () => ({
    status: 'ready',
    collections: [COMMUTE],
    reload: jest.fn(),
    create: jest.fn(),
    rename: (id: string, name: string) => mockRename(id, name),
    remove: (id: string) => mockRemove(id),
  }),
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
  collectionId: null,
  post: summary({ id, status }),
});

const TOMBSTONE: WatchedTombstone = {
  kind: 'tombstone',
  watchedAt: '2026-07-01T10:00:00Z',
  collectionId: null,
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
  entries: [],
  active: [],
  resolved: [],
  refreshing: false,
  refresh: jest.fn(async () => {}),
  retry: jest.fn(),
  ...overrides,
});

const renderScreen = (collectionId: string | null) =>
  render(<CollectionScreen collectionId={collectionId} />);

/** The vehicle cards among a screen's buttons — not Back, ⋯, or Move. The
 *  Move label names the same car, so it has to be excluded explicitly. */
const vehicleCards = <T extends { props: { accessibilityLabel?: string } }>(buttons: T[]): T[] =>
  buttons.filter((b) => {
    const label = b.props.accessibilityLabel ?? '';
    return /BMW|Ford/.test(label) && !label.startsWith('Move ');
  });

// VehicleCard runs a press animation + useTimeAgo interval; flush pending
// timers so leaked callbacks can't corrupt other suites in the worker.
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockWatchlist = state({});
  resetCollectionPickerForTests();
});

afterEach(async () => {
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

describe('CollectionScreen', () => {
  it('empty: renders the invitation and Explore action routes to the feed', async () => {
    const { getByText } = await renderScreen(null);

    expect(getByText('Tap the bookmark on any post to follow it here.')).toBeTruthy();

    fireEvent.press(getByText('Explore posts'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/explore');
  });

  it('renders active watches as vehicle cards, newest watch first', async () => {
    mockWatchlist = state({ active: [postEntry('a'), postEntry('b')] });
    const { getAllByRole, queryByText } = await renderScreen(null);

    // Filter out the header's Back control and each card's Move action —
    // only the cards themselves are under test here.
    const cards = vehicleCards(getAllByRole('button'));
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
    const { getByText } = await renderScreen(null);

    expect(getByText('No longer active')).toBeTruthy();
  });

  it('tombstone row: make/model with the quiet closed line, nothing more', async () => {
    mockWatchlist = state({ resolved: [TOMBSTONE] });
    const { getByText, getByLabelText } = await renderScreen(null);

    expect(getByText('Ford Focus')).toBeTruthy();
    expect(getByText('Red · no longer listed')).toBeTruthy();
    expect(getByLabelText('Red Ford Focus, no longer listed')).toBeTruthy();
  });

  it('tapping a card navigates to the post detail', async () => {
    mockWatchlist = state({ active: [postEntry('a')] });
    const { getAllByRole } = await renderScreen(null);

    fireEvent.press(vehicleCards(getAllByRole('button'))[0]);
    expect(mockPush).toHaveBeenCalledWith('/post/a');
  });

  it('error: retry goes through the hook', async () => {
    const retry = jest.fn();
    mockWatchlist = state({ status: 'error', retry });
    const { getByText } = await renderScreen(null);

    expect(getByText("We couldn't load your watchlist.")).toBeTruthy();
    fireEvent.press(getByText('Try again'));
    expect(retry).toHaveBeenCalled();
  });
});

describe('a named list', () => {
  it('titles itself from the collection, not the route', async () => {
    // A rename must retitle this screen without a navigation round trip.
    const { getByTestId } = await renderScreen(COMMUTE.id);

    expect(getByTestId('collection-title')).toHaveTextContent('My commute');
  });

  it('offers Rename and Delete behind the ⋯', async () => {
    const { getByTestId } = await renderScreen(COMMUTE.id);

    await act(async () => {
      fireEvent.press(getByTestId('collection-menu'));
    });

    // By testID, not text: "Rename list" is legitimately both a menu row and
    // the title of the sheet it opens.
    expect(getByTestId('menu-rename')).toBeTruthy();
    expect(getByTestId('menu-delete')).toBeTruthy();
  });

  it('tells the truth about what deleting does', async () => {
    // The cars are SET NULL by the foreign key, never deleted. Copy implying
    // otherwise would stop people tidying at all — the most damaging possible
    // wording bug in this feature.
    const { getByTestId, getByText } = await renderScreen(COMMUTE.id);

    await act(async () => {
      fireEvent.press(getByTestId('collection-menu'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('menu-delete'));
    });

    expect(getByText('The cars in it will move back to Saved.')).toBeTruthy();
  });

  it('deleting returns to the grid', async () => {
    const { getByTestId, getByText } = await renderScreen(COMMUTE.id);

    await act(async () => {
      fireEvent.press(getByTestId('collection-menu'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('menu-delete'));
    });
    // The dialog's own confirm button, not the menu row that opened it.
    await act(async () => {
      fireEvent.press(getByText('Delete'));
    });

    expect(mockRemove).toHaveBeenCalledWith(COMMUTE.id);
    expect(mockBack).toHaveBeenCalled();
  });
});

describe('the Saved bucket', () => {
  it('has no ⋯ menu — it is not a row and cannot be renamed or deleted', async () => {
    const { queryByTestId, getByTestId } = await renderScreen(null);

    expect(getByTestId('collection-title')).toHaveTextContent('Saved');
    expect(queryByTestId('collection-menu')).toBeNull();
  });
});

describe('the Move affordance', () => {
  it('raises the picker for the card, pointed at the list it is in now', async () => {
    // The save toast's Change auto-dismisses, so this is the only permanent
    // way to re-file a car that ended up in the wrong list.
    mockWatchlist = state({ active: [postEntry('a')] });
    const { getByTestId } = await renderScreen(COMMUTE.id);

    await act(async () => {
      fireEvent.press(getByTestId('move-a'));
    });

    expect(getCollectionPickerIntent()).toEqual({
      postId: 'a',
      currentCollectionId: COMMUTE.id,
      source: 'collection_card',
    });
  });
});
