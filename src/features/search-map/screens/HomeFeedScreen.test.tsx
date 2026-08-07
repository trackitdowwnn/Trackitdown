/**
 * WHAT:  Tests that the feed's search pill is PINNED — present in every state
 *        the screen can be in (loading, error, ready), because it lives above
 *        the list rather than inside it.
 * WHY:   This is the one thing that silently regresses. The pill used to be the
 *        first child of the FlashList's ListHeaderComponent, so it scrolled out
 *        of reach two rails down; moving it back there would look completely
 *        normal in a screenshot of the top of the feed and would break nothing
 *        else. Asserting it survives the LOADING and ERROR branches is the
 *        cheap proxy for "it is not in the list" — a pill inside
 *        ListHeaderComponent cannot render when the list is not rendered.
 * LINKS: ./HomeFeedScreen.tsx; ../components/FeedTopBar.tsx;
 *        ../components/FeedSkeleton.tsx.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { HomeFeedScreen } from './HomeFeedScreen';

const SEARCH_LABEL = 'Search make or model';

let mockFeed: Record<string, unknown>;
let mockLocation: Record<string, unknown>;

jest.mock('../hooks/useHomeFeed', () => ({ useHomeFeed: () => mockFeed }));
jest.mock('../hooks/useFeedLocation', () => ({ useFeedLocation: () => mockLocation }));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  // setOptions: the screen hides the tab bar while the search surface is open.
  useNavigation: () => ({ setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
}));

// The nudge and profile reach storage/network and are irrelevant here. The card
// is rendered as a findable MARKER (not null) so the placement tests below can
// tell WHERE in the feed the offer landed.
let mockGarageNudge: Record<string, unknown>;
jest.mock('@/features/garage', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    SaveYourCarCard: () => <Text testID="garage-nudge-card">garage nudge</Text>,
    useGarageNudgeCard: () => mockGarageNudge,
  };
});
jest.mock('@/features/profile', () => ({ useMyProfile: () => ({ profile: null }) }));
jest.mock('@/features/watchlist', () => ({ WatchToggle: () => null }));

// The map surface, the search overlay and the floating Map pill are
// native-heavy (reanimated / react-native-maps) and not under test.
jest.mock('@/shared/ui/AppMap', () => ({ AppMap: () => null }));
jest.mock('../components/SearchSheet', () => ({ SearchSheet: () => null }));
jest.mock('../components/MapPillButton', () => ({ MapPillButton: () => null }));

const LOCAL_LOCATION = {
  location: {
    mode: 'local',
    latitude: 51.77,
    longitude: -0.34,
    addressLabel: 'St Albans',
    radiusMiles: 20,
    fromPreference: true,
  },
  showLocationPrimer: false,
  setArea: jest.fn(),
  requestMyLocation: jest.fn(),
};

const post = (id: string) => ({
  id,
  photos: [],
  make: 'Ford',
  model: 'Fiesta',
  colour: 'Blue',
  plate: 'AB12 CDE',
  status: 'active',
  lastSeenAt: '2026-07-10T18:00:00Z',
  bountyPence: 15000,
});

const feedSection = (id: string, title: string) => ({
  id,
  title,
  layout: 'carousel' as const,
  posts: [post(`${id}-1`)],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockLocation = { ...LOCAL_LOCATION };
  mockGarageNudge = { visible: false, accept: jest.fn(), dismiss: jest.fn() };
  mockFeed = {
    status: 'ready',
    sections: [],
    refreshing: false,
    loadingMore: false,
    onRefresh: jest.fn(),
    loadMore: jest.fn(),
    retry: jest.fn(),
  };
});

describe('the feed search pill is pinned', () => {
  it('is there while the feed is loading', async () => {
    // The skeleton renders instead of the list, so a pill living inside
    // ListHeaderComponent could not appear at all.
    mockFeed = { ...mockFeed, status: 'loading' };
    const view = await render(<HomeFeedScreen />);
    expect(view.getByLabelText(SEARCH_LABEL)).toBeTruthy();
  });

  it('is there when the feed has failed', async () => {
    // The failure may be area-specific, so search and "change area" are exactly
    // what the user needs here.
    mockFeed = { ...mockFeed, status: 'error' };
    const view = await render(<HomeFeedScreen />);
    expect(view.getByLabelText(SEARCH_LABEL)).toBeTruthy();
  });

  it('is there before a location has resolved', async () => {
    mockLocation = { ...LOCAL_LOCATION, location: null };
    const view = await render(<HomeFeedScreen />);
    expect(view.getByLabelText(SEARCH_LABEL)).toBeTruthy();
  });

  it('is there on a normal, ready feed — exactly once', async () => {
    const view = await render(<HomeFeedScreen />);
    // ONCE: the screen used to render its own copy in the error branch on top
    // of the one in the list header, and the skeleton drew a third placeholder.
    expect(view.getAllByLabelText(SEARCH_LABEL)).toHaveLength(1);
  });

  it('shows only one pill while loading, not a placeholder as well', async () => {
    // FeedSkeleton used to draw its own pill-shaped Block. With the real one
    // pinned above it that would be two pills, one of them dead.
    mockFeed = { ...mockFeed, status: 'loading' };
    const view = await render(<HomeFeedScreen />);
    expect(view.getAllByLabelText(SEARCH_LABEL)).toHaveLength(1);
  });
});

describe('where a setup offer sits in the feed', () => {
  /** Section titles and the nudge marker, in the order they render. */
  const order = (view: Awaited<ReturnType<typeof render>>) =>
    [...view.queryAllByText(/^(Near St Albans|Highest bounties|garage nudge)$/)].map(
      (node) => node.props.children as string,
    );

  it('rides BELOW the first rail, so the tab opens on cars and not on setup', async () => {
    mockGarageNudge = { visible: true, accept: jest.fn(), dismiss: jest.fn() };
    mockFeed = {
      ...mockFeed,
      sections: [
        feedSection('near_you', 'Near you'),
        feedSection('highest_bounties', 'Highest bounties'),
      ],
    };

    const view = await render(<HomeFeedScreen />);

    expect(order(view)).toEqual(['Near St Albans', 'garage nudge', 'Highest bounties']);
  });

  it('falls back into the header when there are no rails to ride between', async () => {
    // good-news-empty: without this the offer would vanish for exactly the
    // people with the emptiest feed.
    mockGarageNudge = { visible: true, accept: jest.fn(), dismiss: jest.fn() };
    mockFeed = { ...mockFeed, sections: [] };

    const view = await render(<HomeFeedScreen />);

    expect(view.getByTestId('garage-nudge-card')).toBeTruthy();
  });

  it('is absent entirely when the hook says so', async () => {
    mockFeed = { ...mockFeed, sections: [feedSection('near_you', 'Near you')] };

    const view = await render(<HomeFeedScreen />);

    expect(view.queryByTestId('garage-nudge-card')).toBeNull();
  });
});

describe('section chevrons', () => {
  // Every chevron means the same thing now: "show me this section on the map".
  // near_you's used to open the AREA PICKER instead — one affordance behaving
  // unlike every other one (changed 2026-08-06; change-area moved into the
  // search surface). If this reverts, the feed regains that inconsistency.
  it('opens the map framed on the feed area from the "Near <Area>" header', async () => {
    mockFeed = { ...mockFeed, sections: [feedSection('near_you', 'Near you')] };

    const view = await render(<HomeFeedScreen />);
    await act(async () => {
      fireEvent.press(view.getByLabelText('See all — Near St Albans'));
    });

    expect(mockPush).toHaveBeenCalledTimes(1);
    const [call] = mockPush.mock.calls[0] as [{ pathname: string; params: Record<string, string> }];
    expect(call.pathname).toBe('/search-map');
    // Framed on the feed's own region, since near_you has no named area.
    expect(call.params.lat).toBe('51.77');
    expect(call.params.lng).toBe('-0.34');
    expect(call.params.latDelta).toBeDefined();
    expect(call.params.lngDelta).toBeDefined();
  });

  it('opens the map by NAME for an area carousel', async () => {
    mockFeed = {
      ...mockFeed,
      sections: [
        {
          ...feedSection('area_st-albans', 'Recently stolen in St Albans'),
          area: 'St Albans',
        },
      ],
    };

    const view = await render(<HomeFeedScreen />);
    await act(async () => {
      fireEvent.press(view.getByLabelText('See all — Recently stolen in St Albans'));
    });

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/search-map',
      params: { area: 'St Albans' },
    });
  });
});
