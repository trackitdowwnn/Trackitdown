/**
 * WHAT:  Orchestration tests for MapSearchScreen — the entry-region gate, the
 *        failure path, and who owns the Android back gesture.
 * WHY:   ⚠️ 825 LINES AND NO TESTS until 2026-09-02, on the app's centrepiece.
 *        Its PARTS are well covered — 24 suites across search-map's components
 *        and hooks — so what was missing is precisely what those cannot see:
 *        the composition. Every case below is a bug the source file already
 *        carries a comment about, which is the honest way to choose them:
 *
 *        1. **The retry drops the selection FIRST.** `retry()` runs immediately
 *           and does not consult the hook's `paused`, so swapping the result set
 *           under an open card leaves the index-derived pager pointing at a
 *           different vehicle than the card shows — and that card files
 *           SIGHTINGS by post.id. A report against the wrong car is the worst
 *           thing this screen could do.
 *        2. **The failure toast carries its retry.** Deleting "Search this
 *           area" also deleted the manual re-search, so without an action the
 *           only way back is to pan 30% of the viewport again, and nothing
 *           tells anyone that.
 *        3. **It fires on the EDGE.** Announcing on every render would re-toast
 *           an error the user has already dismissed, forever.
 *        4. **Back with a card up dismisses the CARD**, and while the search
 *           surface is open that surface owns the gesture instead — registering
 *           both would close two things with one press.
 *
 *        The map itself, the pins and the pager are stubbed: this asserts what
 *        the screen WIRES, not what those render (they have their own suites).
 * LINKS: src/features/search-map/screens/MapSearchScreen.tsx;
 *        src/features/search-map/hooks/useViewportPosts.ts;
 *        src/features/search-map/hooks/useMapSelection.ts; docs/TESTING.md.
 */

import { act, render } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import { MapSearchScreen } from './MapSearchScreen';

// --- The data hook, which the whole screen hangs off -------------------------
const mockRetry = jest.fn();
const mockOnRegionChange = jest.fn();
const mockApplySearch = jest.fn();
let mockViewportState: Record<string, unknown>;
jest.mock('../hooks/useViewportPosts', () => ({
  useViewportPosts: () => mockViewportState,
}));

// --- Selection ---------------------------------------------------------------
// ⚠️ Only the STATE is stubbed. useMapSelection itself is pure, tested, and the
// thing that turns a selected id into the index the pager reads — replacing it
// would mean the ordering assertion below tested a stand-in rather than the
// wiring. `clear()` calls setSelectedId(null), so the spy sees it.
const mockSetSelectedId = jest.fn();
let mockSelectedId: string | null = null;
jest.mock('../hooks/useMapSelection', () => ({
  ...jest.requireActual('../hooks/useMapSelection'),
  useMapSelectionState: () => [mockSelectedId, mockSetSelectedId],
}));

// A `let` rather than a fixed return: the entry-region gate needs the hook to
// be able to answer "not yet".
let mockLocation: unknown = {
  latitude: 53.48,
  longitude: -2.24,
  mode: 'local',
  radiusMiles: 10,
};
jest.mock('../hooks/useFeedLocation', () => ({
  useFeedLocation: () => ({ location: mockLocation }),
}));
jest.mock('../hooks/useProgressivePins', () => ({ useProgressivePins: () => [] }));
// A REGION, not null: the screen sorts its cards by distance from this anchor
// during render, so null throws before any assertion is reached.
jest.mock('../hooks/useSortAnchor', () => ({
  useSortAnchor: () => ({
    latitude: 53.48,
    longitude: -2.24,
    latitudeDelta: 0.2,
    longitudeDelta: 0.2,
  }),
}));

// --- Leaves that cannot render under jest ------------------------------------
jest.mock('@/shared/ui/AppMap', () => ({ AppMap: 'AppMap', AppMapMarker: 'AppMapMarker' }));
jest.mock('../components/MapPins', () => ({ MapPins: () => null }));
jest.mock('../components/MapCardPager', () => ({ MapCardPager: () => null }));
// ⚠️ The sheet GEOMETRY is not stubbed — it lives in ../lib/mapSheetGeometry
// precisely so this stub can exist. Stubbing the component used to make
// MAP_SHEET_SNAP_PERCENTS undefined and the screen threw on first render: a
// mock failure wearing the costume of a screen bug. Re-declaring the numbers
// here instead would be the mocked-constant mistake TESTING.md records.
jest.mock('../components/MapListSheet', () => ({
  ...jest.requireActual('../lib/mapSheetGeometry'),
  MapListSheet: () => null,
}));
// SearchSheet, by contrast, is stubbed WHOLESALE — requireActual on it reaches
// the supabase client and the suite dies at import. The screen takes only the
// component and a type from it, and types are erased.
jest.mock('../components/SearchSheet', () => ({ SearchSheet: () => null }));
jest.mock('../components/MapSearchPill', () => ({ MapSearchPill: () => null }));
jest.mock('../components/MapRecentreButton', () => ({ MapRecentreButton: () => null }));
jest.mock('../components/MapCircleButton', () => ({ MapCircleButton: () => null }));

const mockToastShow = jest.fn();
// ⚠️ ONE STABLE OBJECT, not a fresh literal per call. The real ToastProvider
// hands out a memoised context value; a mock that rebuilds it every render
// changes an effect dependency every render, and the edge-triggered toast below
// re-fires — which reads as a screen bug and is a mock bug. It cost a
// "3 calls, expected 1" before this comment existed.
const mockToast = { show: mockToastShow };
jest.mock('@/shared/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { View } = require('react-native');
  return {
    FullscreenLoader: ({ message }: { message: string }) => (
      <View testID="map-resolving" accessibilityLabel={message} />
    ),
    useToast: () => mockToast,
  };
});

jest.mock('@/features/auth', () => ({ useRequireAuth: () => jest.fn() }));
jest.mock('@/features/permissions', () => ({
  useDevicePermission: () => ({ status: 'granted', request: jest.fn() }),
}));
jest.mock('@/shared/lib/location/expoLocationServices', () => ({
  expoLocationServices: { forwardGeocode: jest.fn(async () => []) },
}));
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('react-native-reanimated/mock'),
  useReducedMotion: () => true,
}));
jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  require('react-native-safe-area-context/jest/mock').default,
);

let mockSearchParams: Record<string, string> = {};
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: jest.fn(), back: mockBack }),
}));

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

/** One live listing, so a selection can resolve to an index. */
const POST = {
  id: 'p1',
  photos: [],
  make: 'Ford',
  model: 'Fiesta',
  colour: 'Blue',
  plate: 'AB12 CDE',
  status: 'active' as const,
  lastSeenAt: '2026-07-10T18:00:00Z',
  bountyPence: 15000,
  latitude: 53.48,
  longitude: -2.24,
};

function viewport(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ready',
    result: { posts: [POST], areas: [] },
    // A real region, not null: the screen frames its camera from this, and a
    // null one throws inside cameraForVisible before any assertion is reached.
    searchedRegion: {
      latitude: 53.48,
      longitude: -2.24,
      latitudeDelta: 0.2,
      longitudeDelta: 0.2,
    },
    searching: false,
    searchId: 1,
    populationId: 1,
    searchFailed: false,
    onRegionChange: mockOnRegionChange,
    recordRegion: jest.fn(),
    applySearch: mockApplySearch,
    retry: mockRetry,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearchParams = {};
  mockSelectedId = null;
  mockViewportState = viewport();
  mockLocation = { latitude: 53.48, longitude: -2.24, mode: 'local', radiusMiles: 10 };
});

describe('resolving the entry region', () => {
  it('holds on a loader until it knows where to look', async () => {
    // No area, no coords, and the location hook has not answered yet — the
    // screen must not mount a map over an arbitrary region and then jump.
    mockLocation = null;

    const { getByTestId } = await render(<MapSearchScreen />);

    expect(getByTestId('map-resolving')).toBeTruthy();
  });
});

describe('a failed search', () => {
  it('⚠️ carries a retry, because panning 30% of the viewport is the alternative', async () => {
    mockViewportState = viewport({ searchFailed: true });

    await render(<MapSearchScreen />);

    expect(mockToastShow).toHaveBeenCalledWith(
      "Couldn't refresh this area.",
      'error',
      expect.objectContaining({ label: 'Try again' }),
    );
  });

  it('⚠️ drops the open card BEFORE re-searching', async () => {
    // The hazard the source comments about: retry() does not consult the
    // hook's `paused`, so a result set swapped under an open card leaves the
    // index-derived pager pointing at a different vehicle than the card shows
    // — and that card files sightings by post.id.
    mockSelectedId = 'p1';
    mockViewportState = viewport({ searchFailed: true });

    await render(<MapSearchScreen />);
    const action = mockToastShow.mock.calls[0][2] as { onPress: () => void };
    await act(async () => {
      action.onPress();
    });

    expect(mockSetSelectedId).toHaveBeenCalledWith(null);
    expect(mockRetry).toHaveBeenCalled();
    expect(mockSetSelectedId.mock.invocationCallOrder[0]).toBeLessThan(
      mockRetry.mock.invocationCallOrder[0],
    );
  });

  it('announces once per failure, not once per render', async () => {
    mockViewportState = viewport({ searchFailed: true });
    const { rerender } = await render(<MapSearchScreen />);

    await act(async () => {
      rerender(<MapSearchScreen />);
    });

    // Fired on the EDGE of a boolean. Re-announcing would re-toast an error the
    // user has already dismissed, on every render, forever.
    expect(mockToastShow).toHaveBeenCalledTimes(1);
  });

  it('says nothing at all while the search is healthy', async () => {
    await render(<MapSearchScreen />);
    expect(mockToastShow).not.toHaveBeenCalled();
  });
});

describe('who owns the Android back gesture', () => {
  it('⚠️ dismisses the card rather than leaving the screen', async () => {
    mockSelectedId = 'p1';
    const addSpy = jest.spyOn(BackHandler, 'addEventListener');

    await render(<MapSearchScreen />);

    const registered = addSpy.mock.calls.find(([event]) => event === 'hardwareBackPress');
    expect(registered).toBeTruthy();

    const handled = (registered![1] as () => boolean)();
    expect(mockSetSelectedId).toHaveBeenCalledWith(null);
    // `true` = consumed. Returning false would clear the card AND pop the
    // screen, so one press would undo two things.
    expect(handled).toBe(true);
  });

  it('registers nothing when no card is open', async () => {
    const addSpy = jest.spyOn(BackHandler, 'addEventListener');

    await render(<MapSearchScreen />);

    expect(
      addSpy.mock.calls.filter(([event]) => event === 'hardwareBackPress'),
    ).toHaveLength(0);
  });
});
