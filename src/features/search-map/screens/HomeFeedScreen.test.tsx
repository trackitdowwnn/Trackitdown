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

import { render } from '@testing-library/react-native';

import { HomeFeedScreen } from './HomeFeedScreen';

const SEARCH_LABEL = 'Search make or model';

let mockFeed: Record<string, unknown>;
let mockLocation: Record<string, unknown>;

jest.mock('../hooks/useHomeFeed', () => ({ useHomeFeed: () => mockFeed }));
jest.mock('../hooks/useFeedLocation', () => ({ useFeedLocation: () => mockLocation }));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  // setOptions: the screen hides the tab bar while the search surface is open.
  useNavigation: () => ({ setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
}));

// The nudges and profile reach storage/network and are irrelevant here.
jest.mock('@/features/garage', () => ({
  SaveYourCarCard: () => null,
  useGarageNudgeCard: () => ({ visible: false, accept: jest.fn(), dismiss: jest.fn() }),
}));
jest.mock('@/features/notifications/components/AlertNudgeCard', () => ({
  AlertNudgeCard: () => null,
}));
jest.mock('@/features/notifications/hooks/useAlertNudgeCard', () => ({
  useAlertNudgeCard: () => ({ visible: false, accept: jest.fn(), dismiss: jest.fn() }),
}));
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

beforeEach(() => {
  jest.clearAllMocks();
  mockLocation = { ...LOCAL_LOCATION };
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
