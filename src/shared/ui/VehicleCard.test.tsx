/**
 * WHAT:  Tests for VehicleCard — the combined accessibility label, badge
 *        visibility rules, formatted distance/bounty/last-seen output,
 *        carousel-swipe-not-press behaviour, compact variant trimming,
 *        missing-photo fallback, and the skeleton.
 * WHY:   This is the app's signature card, recycled across the feed, map,
 *        and my-posts; a labelling or interaction slip here misrepresents
 *        posts (including money) everywhere at once.
 * LINKS: src/shared/ui/VehicleCard.tsx, docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import type { PostSummary } from '../types';
import { SkeletonVehicleCard, VehicleCard } from './VehicleCard';

const photoAt = (n: number) => ({ uri: `https://example.com/${n}.jpg` });

const BASE_POST: PostSummary = {
  id: 'post-1',
  photos: [
    { uri: 'https://example.com/1.jpg' },
    { uri: 'https://example.com/2.jpg' },
  ],
  make: 'BMW',
  model: '3 Series',
  colour: 'Blue',
  plate: 'AB12 CDE',
  status: 'active',
  lastSeenAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  lastSeenArea: 'Camden',
  distanceMiles: 2.3,
  bountyPence: 50000,
};

// Fake timers with a pending-timer flush: the press animation and the
// useTimeAgo interval otherwise outlive each test on real timers, and the
// leaked callbacks corrupt OTHER suites sharing the Jest worker (seen as
// fake-timer failures in unrelated files during full runs).
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(async () => {
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

describe('VehicleCard', () => {
  it('combines identity, plate, bounty, recency, and distance into one label', async () => {
    const { getByRole } = await render(<VehicleCard post={BASE_POST} onPress={() => {}} />);

    const card = getByRole('button');
    expect(card.props.accessibilityLabel).toBe(
      'Blue BMW 3 Series, plate A B 1 2, C D E, £500 bounty, last seen 2h ago, 2.3 mi away',
    );
  });

  it('includes BOTH the badge and the last-seen info in the label when badged', async () => {
    const { getByRole } = await render(
      <VehicleCard post={{ ...BASE_POST, status: 'recovered' }} onPress={() => {}} />,
    );

    const label = getByRole('button').props.accessibilityLabel as string;
    expect(label).toContain('recovered');
    expect(label).toContain('last seen 2h ago');
  });

  it('fires onPress for taps', async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(<VehicleCard post={BASE_POST} onPress={onPress} />);

    fireEvent.press(getByRole('button'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire onPress when the carousel is swiped', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(<VehicleCard post={BASE_POST} onPress={onPress} />);

    fireEvent(getByTestId('vehicle-card-carousel'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 350 } },
    });

    expect(onPress).not.toHaveBeenCalled();
  });

  it('pages the active dot from the measured width, not an assumed one', async () => {
    const post = { ...BASE_POST, photos: [photoAt(1), photoAt(2), photoAt(3)] };
    const { getByTestId } = await render(<VehicleCard post={post} onPress={() => {}} />);

    // Sequential awaited acts — overlapping act() calls corrupt the test
    // renderer for every test that follows.
    // The frame measures 350 wide; landing at offset 700 is photo 3.
    await act(async () => {
      fireEvent(getByTestId('vehicle-card-carousel-frame'), 'layout', {
        nativeEvent: { layout: { width: 350, height: 262 } },
      });
    });
    await act(async () => {
      fireEvent(getByTestId('vehicle-card-carousel'), 'momentumScrollEnd', {
        nativeEvent: { contentOffset: { x: 700 } },
      });
    });

    const dots = [0, 1, 2].map((i) => getByTestId(`carousel-dot-${i}`));
    const opacityOf = (dot: (typeof dots)[number]) =>
      StyleSheet.flatten(dot.props.style).opacity;
    expect(opacityOf(dots[2])).toBe(1);
    expect(opacityOf(dots[0])).toBeLessThan(1);
  });

  it('shows no badge on active posts and the mapped badge otherwise', async () => {
    const active = await render(<VehicleCard post={BASE_POST} onPress={() => {}} />);
    expect(active.queryByText('Recovered')).toBeNull();
    // Meta line merges identity + recency (Airbnb-reference anatomy).
    expect(active.getByText(/Blue · last seen 2h ago near Camden/)).toBeTruthy();

    const recovered = await render(
      <VehicleCard post={{ ...BASE_POST, status: 'recovered' }} onPress={() => {}} />,
    );
    expect(recovered.getByText('Recovered')).toBeTruthy();

    const pending = await render(
      <VehicleCard post={{ ...BASE_POST, status: 'pending_verification' }} onPress={() => {}} />,
    );
    expect(pending.getByText('Pending')).toBeTruthy();
  });

  it('renders formatted bounty and distance', async () => {
    const { getByText } = await render(<VehicleCard post={BASE_POST} onPress={() => {}} />);

    expect(getByText('£500 bounty')).toBeTruthy();
    expect(getByText('2.3 mi')).toBeTruthy();
  });

  it('compact rail variant: full-line title, distance-led meta, bounty, no plate chip', async () => {
    const { getByText, queryByText } = await render(
      <VehicleCard post={BASE_POST} onPress={() => {}} variant="compact" />,
    );

    expect(getByText('BMW 3 Series')).toBeTruthy();
    // Distance moves into the meta line (no standalone distance on the title
    // row) and colour drops off rails.
    expect(getByText('2.3 mi · last seen 2h ago')).toBeTruthy();
    expect(queryByText('2.3 mi')).toBeNull();
    expect(queryByText(/Blue ·/)).toBeNull();
    expect(getByText('£500 bounty')).toBeTruthy();
    expect(queryByText('AB12 CDE')).toBeNull();
  });

  it('compact rail variant renders a static photo — no inner carousel or dots', async () => {
    const { queryByTestId } = await render(
      <VehicleCard post={BASE_POST} onPress={() => {}} variant="compact" />,
    );

    // BASE_POST has multiple photos, but rails must not nest a swipeable
    // carousel inside the rail's own horizontal scroll.
    expect(queryByTestId('vehicle-card-carousel')).toBeNull();
    expect(queryByTestId('carousel-dot-0')).toBeNull();
  });

  it('degrades gracefully without distance, area, or photos', async () => {
    const bare: PostSummary = {
      ...BASE_POST,
      photos: [],
      distanceMiles: undefined,
      lastSeenArea: undefined,
    };
    const { getByText, queryByText, getByRole } = await render(
      <VehicleCard post={bare} onPress={() => {}} />,
    );

    expect(getByText('Blue · last seen 2h ago')).toBeTruthy();
    expect(queryByText(/mi$/)).toBeNull();
    expect(getByRole('button').props.accessibilityLabel).not.toMatch(/away/);
  });

  it('renders no carousel (or dots) for single-photo posts', async () => {
    const single = await render(
      <VehicleCard post={{ ...BASE_POST, photos: [BASE_POST.photos[0]] }} onPress={() => {}} />,
    );

    expect(single.queryByTestId('vehicle-card-carousel')).toBeNull();
  });
});

describe('SkeletonVehicleCard', () => {
  it('renders the loading placeholder for both variants', async () => {
    const feed = await render(<SkeletonVehicleCard />);
    expect(feed.getByLabelText('Loading post')).toBeTruthy();

    const compact = await render(<SkeletonVehicleCard variant="compact" />);
    expect(compact.getByLabelText('Loading post')).toBeTruthy();
  });
});
