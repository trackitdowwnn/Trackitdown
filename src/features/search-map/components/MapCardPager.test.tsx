/**
 * WHAT:  Tests for MapCardPager — show/dismiss rendering, the sync-loop
 *        guard (a programmatic echo never re-reports), swipe reporting
 *        with end-of-list clamping, and the screen-reader announcement
 *        on selection change.
 * WHY:   The pin↔card loop is the screen's centrepiece and its classic
 *        failure mode is the feedback loop (swipe → selection → scroll →
 *        report → …); these tests pin the guard down. The announcement is
 *        the only signal a TalkBack user gets that a card appeared.
 * LINKS: src/features/search-map/components/MapCardPager.tsx,
 *        docs/TESTING.md.
 */

import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import type { MapPost } from '../types';
import { MapCardPager } from './MapCardPager';

// The official reanimated mock (the project-wide moduleNameMapper target)
// lacks useReducedMotion; extend it rather than hand-rolling — the pager
// renders the whole shared/ui barrel, which uses far more of the API.
// Reduced motion true makes enter/exit snap — deterministic tests.
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated/mock');
  return {
    __esModule: true,
    ...actual,
    default: actual.default,
    useReducedMotion: () => true,
  };
});

const post = (id: string, make: string): MapPost => ({
  id,
  photos: [],
  make,
  model: '3 Series',
  colour: 'Blue',
  plate: 'AB12 CDE',
  status: 'active',
  lastSeenAt: '2026-07-10T18:00:00Z',
  bountyPence: 50000,
  latitude: 51.75,
  longitude: -0.34,
});

const POSTS = [post('a', 'BMW'), post('b', 'Audi'), post('c', 'Ford')];

// The pager derives its snap interval from the window width; mirror the
// component's math so simulated momentum offsets land on real indices.
// jest-expo's default window width is 750.
const CARD_WIDTH = 750 - 16 * 2; // window − 2·spacing.lg
const INTERVAL = CARD_WIDTH + 8; // + CARD_GAP (spacing.sm)

const momentumEndAt = (index: number) => ({
  nativeEvent: { contentOffset: { x: index * INTERVAL, y: 0 } },
});

const announceSpy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

beforeEach(() => {
  announceSpy.mockClear();
});

describe('MapCardPager', () => {
  it('renders nothing with no selection, cards once selected', async () => {
    const { queryByText, getByText, rerender } = await render(
      <MapCardPager posts={POSTS} selectedIndex={-1} onIndexSettled={() => {}} onPressPost={() => {}} />,
    );
    expect(queryByText('BMW 3 Series')).toBeNull();

    await rerender(
      <MapCardPager posts={POSTS} selectedIndex={0} onIndexSettled={() => {}} onPressPost={() => {}} />,
    );
    expect(getByText('BMW 3 Series')).toBeTruthy();
  });

  it('dismisses (unmounts the cards) when selection clears', async () => {
    const { queryByText, rerender } = await render(
      <MapCardPager posts={POSTS} selectedIndex={1} onIndexSettled={() => {}} onPressPost={() => {}} />,
    );
    expect(queryByText('Audi 3 Series')).toBeTruthy();

    await rerender(
      <MapCardPager posts={POSTS} selectedIndex={-1} onIndexSettled={() => {}} onPressPost={() => {}} />,
    );
    // Reanimated's mock completes the exit animation synchronously.
    expect(queryByText('Audi 3 Series')).toBeNull();
  });

  it('reports a swipe settle once and stays quiet on the programmatic echo', async () => {
    const onIndexSettled = jest.fn();
    const { getByTestId, rerender } = await render(
      <MapCardPager
        posts={POSTS}
        selectedIndex={0}
        onIndexSettled={onIndexSettled}
        onPressPost={() => {}}
      />,
    );

    // User swipes to card 1.
    await act(async () => {
      fireEvent(getByTestId('map-card-pager'), 'momentumScrollEnd', momentumEndAt(1));
    });
    expect(onIndexSettled).toHaveBeenCalledTimes(1);
    expect(onIndexSettled).toHaveBeenCalledWith(1);

    // Selection echoes back as a prop; the settle it causes must not re-report.
    await rerender(
      <MapCardPager
        posts={POSTS}
        selectedIndex={1}
        onIndexSettled={onIndexSettled}
        onPressPost={() => {}}
      />,
    );
    await act(async () => {
      fireEvent(getByTestId('map-card-pager'), 'momentumScrollEnd', momentumEndAt(1));
    });
    expect(onIndexSettled).toHaveBeenCalledTimes(1); // still once
  });

  it('clamps an overscrolled settle to the last card', async () => {
    const onIndexSettled = jest.fn();
    const { getByTestId } = await render(
      <MapCardPager
        posts={POSTS}
        selectedIndex={0}
        onIndexSettled={onIndexSettled}
        onPressPost={() => {}}
      />,
    );

    await act(async () => {
      fireEvent(getByTestId('map-card-pager'), 'momentumScrollEnd', momentumEndAt(99));
    });
    expect(onIndexSettled).toHaveBeenCalledWith(POSTS.length - 1);
  });

  it('ignores a momentum settle that lands after the card was dismissed', async () => {
    const onIndexSettled = jest.fn();
    const { queryByTestId, rerender } = await render(
      <MapCardPager
        posts={POSTS}
        selectedIndex={0}
        onIndexSettled={onIndexSettled}
        onPressPost={() => {}}
      />,
    );

    // User flings, then dismisses (map tap / back) while still decelerating.
    await rerender(
      <MapCardPager
        posts={POSTS}
        selectedIndex={-1}
        onIndexSettled={onIndexSettled}
        onPressPost={() => {}}
      />,
    );
    const list = queryByTestId('map-card-pager');
    if (list) {
      // Under reduced motion the mock unmounts immediately; if the list is
      // still up (animated exit), its late settle must not resurrect the card.
      await act(async () => {
        fireEvent(list, 'momentumScrollEnd', momentumEndAt(2));
      });
    }
    expect(onIndexSettled).not.toHaveBeenCalled();
  });

  it('re-shows and re-reports cleanly after a full dismiss of the same index', async () => {
    const onIndexSettled = jest.fn();
    const props = { posts: POSTS, onIndexSettled, onPressPost: () => {} };
    const { queryByText, rerender } = await render(
      <MapCardPager {...props} selectedIndex={1} />,
    );
    expect(queryByText('Audi 3 Series')).toBeTruthy();

    await rerender(<MapCardPager {...props} selectedIndex={-1} />);
    expect(queryByText('Audi 3 Series')).toBeNull();

    // Same pin tapped again: the guard must have reset — the card returns.
    await rerender(<MapCardPager {...props} selectedIndex={1} />);
    expect(queryByText('Audi 3 Series')).toBeTruthy();
  });

  it('announces the selected card to screen readers on each selection change', async () => {
    const { rerender } = await render(
      <MapCardPager posts={POSTS} selectedIndex={0} onIndexSettled={() => {}} onPressPost={() => {}} />,
    );
    expect(announceSpy).toHaveBeenCalledWith(
      'Blue BMW 3 Series, £500 bounty — swipe for more results',
    );

    await rerender(
      <MapCardPager posts={POSTS} selectedIndex={2} onIndexSettled={() => {}} onPressPost={() => {}} />,
    );
    expect(announceSpy).toHaveBeenCalledWith(
      'Blue Ford 3 Series, £500 bounty — swipe for more results',
    );
  });

  it('does not re-announce when a re-search rebuilds the posts array', async () => {
    const { rerender } = await render(
      <MapCardPager posts={POSTS} selectedIndex={0} onIndexSettled={() => {}} onPressPost={() => {}} />,
    );
    expect(announceSpy).toHaveBeenCalledTimes(1);

    // "Search this area" success: new array identity, same selected post.
    await rerender(
      <MapCardPager
        posts={[...POSTS]}
        selectedIndex={0}
        onIndexSettled={() => {}}
        onPressPost={() => {}}
      />,
    );
    expect(announceSpy).toHaveBeenCalledTimes(1); // still once
  });
});
