/**
 * WHAT:  Tests for MapSearchScreen's cluster→pager scoping: tapping a
 *        cluster opens the peek-card pager on ONLY that cluster's posts
 *        (nearest first), a lone pin tap restores whole-viewport paging.
 * WHY:   The pager paging through posts OUTSIDE the tapped cluster was the
 *        exact bug this scoping fixes — an index computed against one list
 *        while the pager renders another silently shows the wrong cars.
 * LINKS: src/features/search-map/screens/MapSearchScreen.tsx;
 *        lib/mapClustering.ts (clusterMemberPosts); docs/TESTING.md.
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import type { GeoRegion } from '@/shared/types';

import type { MapPinItem, MapPost } from '../types';
import { MapSearchScreen } from './MapSearchScreen';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

// The official reanimated mock lacks useReducedMotion (house pattern —
// see MapListSheet.test.tsx); extend it.
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('react-native-reanimated/mock'),
  useReducedMotion: () => false,
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  // Precise-point entry: the screen resolves its region from lat/lng alone.
  useLocalSearchParams: () => ({ lat: '51.752', lng: '-0.339' }),
}));

jest.mock('@/features/auth', () => ({
  useRequireAuth: () => jest.fn(),
}));

// The map itself is chrome here — render children so MapPins mounts.
jest.mock('@/shared/ui/AppMap', () => ({
  AppMap: ({ children }: { children: unknown }) => children,
}));

jest.mock('../hooks/useFeedLocation', () => ({
  useFeedLocation: () => ({ location: null }),
}));

// Fixed viewport result — clustering runs REAL supercluster over these.
const mockPost = (id: string, latitude: number, longitude: number): MapPost => ({
  id,
  photos: [],
  make: 'Ford',
  model: 'Fiesta',
  colour: 'Blue',
  plate: 'AB12 CDE',
  status: 'active',
  lastSeenAt: '2026-07-10T18:00:00Z',
  bountyPence: 15000,
  latitude,
  longitude,
});

// A tight trio at the entry point + two far singles (>7km — beyond the
// cluster radius at the entry zoom, so they render as lone pins).
const mockAllPosts = [
  mockPost('c1', 51.752, -0.339),
  mockPost('c2', 51.753, -0.338),
  mockPost('c3', 51.751, -0.34),
  mockPost('farA', 51.822, -0.339),
  mockPost('farB', 51.672, -0.339),
];

const mockSearchedRegion: GeoRegion = {
  latitude: 51.752,
  longitude: -0.339,
  latitudeDelta: 0.15,
  longitudeDelta: 0.15,
};

jest.mock('../hooks/useViewportPosts', () => ({
  useViewportPosts: () => ({
    status: 'ready',
    result: { total: 5, posts: mockAllPosts },
    searchedRegion: mockSearchedRegion,
    searching: false,
    showSearchArea: false,
    onRegionChange: jest.fn(),
    searchThisArea: jest.fn(),
    retry: jest.fn(),
  }),
}));

// Pins become buttons; the pager becomes a props probe. Both are tested on
// their own — THIS test is about the screen's wiring between them.
jest.mock('../components/MapPins', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { Pressable, Text, View } = require('react-native');
  return {
    MapPins: ({
      pins,
      onPressPost,
      onPressCluster,
    }: {
      pins: MapPinItem[];
      onPressPost: (id: string) => void;
      onPressCluster: (clusterId: number) => void;
    }) =>
      React.createElement(
        View,
        null,
        pins.map((pin) =>
          pin.type === 'cluster'
            ? React.createElement(
                Pressable,
                {
                  key: pin.key,
                  testID: `tap-cluster-${pin.count}`,
                  onPress: () => onPressCluster(pin.clusterId),
                },
                React.createElement(Text, null, String(pin.count)),
              )
            : React.createElement(
                Pressable,
                {
                  key: pin.key,
                  testID: `tap-pin-${pin.post.id}`,
                  onPress: () => onPressPost(pin.post.id),
                },
                React.createElement(Text, null, pin.post.id),
              ),
        ),
      ),
  };
});

jest.mock('../components/MapCardPager', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { Text, View } = require('react-native');
  return {
    MapCardPager: ({ posts, selectedIndex }: { posts: MapPost[]; selectedIndex: number }) =>
      React.createElement(
        View,
        null,
        React.createElement(
          Text,
          { testID: 'pager-posts' },
          posts.map((p) => p.id).join(','),
        ),
        React.createElement(Text, { testID: 'pager-index' }, String(selectedIndex)),
      ),
  };
});

jest.mock('../components/MapListSheet', () => ({ MapListSheet: () => null }));
jest.mock('../components/SearchThisAreaButton', () => ({ SearchThisAreaButton: () => null }));

const renderScreen = async () => {
  let result!: Awaited<ReturnType<typeof render>>;
  await act(async () => {
    result = await render(<MapSearchScreen />);
  });
  // Entry region resolves in an async effect — wait for the map body.
  await waitFor(() => expect(result.getByTestId('pager-posts')).toBeTruthy());
  return result;
};

describe('MapSearchScreen cluster→pager scoping', () => {
  it('cluster tap scopes the pager to exactly that cluster’s posts, nearest first', async () => {
    const { getByTestId } = await renderScreen();

    // Unscoped by default: the pager holds the whole viewport.
    expect(getByTestId('pager-posts').props.children.split(',').sort()).toEqual(
      ['c1', 'c2', 'c3', 'farA', 'farB'].sort(),
    );
    expect(getByTestId('pager-index').props.children).toBe('-1');

    await act(async () => {
      fireEvent.press(getByTestId('tap-cluster-3'));
    });

    // Scoped: only the trio, opened on its nearest member.
    expect(getByTestId('pager-posts').props.children.split(',').sort()).toEqual([
      'c1',
      'c2',
      'c3',
    ]);
    expect(getByTestId('pager-index').props.children).toBe('0');
  });

  it('a lone pin tap restores whole-viewport paging', async () => {
    const { getByTestId } = await renderScreen();
    await act(async () => {
      fireEvent.press(getByTestId('tap-cluster-3'));
    });

    // The cluster zoom re-slices pins: the trio unclusters into individual
    // pins inside the framed region. Tapping one is a lone pin tap — the
    // scope drops and the pager pages the whole viewport again.
    await waitFor(() => expect(getByTestId('tap-pin-c2')).toBeTruthy());
    await act(async () => {
      fireEvent.press(getByTestId('tap-pin-c2'));
    });

    expect(getByTestId('pager-posts').props.children.split(',').length).toBe(5);
    expect(getByTestId('pager-index').props.children).toBe('1'); // c2 is 2nd nearest
  });
});
