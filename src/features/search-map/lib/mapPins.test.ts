/**
 * WHAT:  Tests for mapPins — viewport culling and the pill/mini ranking.
 * WHY:   Two properties that fail silently. CULLING: `result.posts` only
 *        refreshes when a search lands (~600ms behind the gesture), so if this
 *        stops culling, markers keep drawing where the user has already panned
 *        away from — it looks like ghosts, not like a bug. RANKING: an unstable
 *        sort makes a post flip between pill and mini on identical data as the
 *        user pans, which reads as flicker with no error anywhere.
 * LINKS: src/features/search-map/lib/mapPins.ts, docs/TESTING.md.
 */

import type { GeoRegion } from '@/shared/types';

import type { MapPinItem, MapPost } from '../types';
import { keepMarkersOnScreen, pinsForRegion, revealPins } from './mapPins';

const post = (
  id: string,
  latitude: number,
  longitude: number,
  bountyPence: number | null = 15000,
): MapPost => ({
  id,
  photos: [],
  make: 'Ford',
  model: 'Fiesta',
  colour: 'Blue',
  plate: 'AB12 CDE',
  status: 'active',
  lastSeenAt: '2026-07-10T18:00:00Z',
  bountyPence,
  latitude,
  longitude,
});

/** Centred on St Albans, ~±0.25° — comfortably covers Hertfordshire. */
const REGION: GeoRegion = {
  latitude: 51.75,
  longitude: -0.34,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
};

/** Posts inside REGION, bounty rising with index. */
const spread = (count: number): MapPost[] =>
  Array.from({ length: count }, (_, i) =>
    post(`p${String(i).padStart(2, '0')}`, 51.7 + i * 0.002, -0.36 + i * 0.002, (i + 1) * 1000),
  );

describe('viewport culling', () => {
  it('drops posts outside the region', () => {
    const pins = pinsForRegion(
      [post('inside', 51.75, -0.34), post('glasgow', 55.86, -4.25)],
      REGION,
    );

    expect(pins.map((pin) => pin.key)).toEqual(['inside']);
  });

  it('keeps a post exactly on the boundary', () => {
    const onEdge = post('edge', 51.75 + 0.25, -0.34);

    expect(pinsForRegion([onEdge], REGION)).toHaveLength(1);
  });

  it('returns nothing when the region is empty of posts', () => {
    expect(pinsForRegion([post('glasgow', 55.86, -4.25)], REGION)).toEqual([]);
  });
});

describe('bounty rank (paint order + the AT cap)', () => {
  // EVERY marker is a £ pill now (2026-08-07) — a marker with no price on it
  // reads as a group. Rank survives for the two jobs where order still matters.
  it('gives every post in view a pill and a rank', () => {
    const pins = pinsForRegion(spread(20), REGION);

    expect(pins).toHaveLength(20);
    expect([...pins].map((pin) => pin.rank).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => i),
    );
  });

  it('ranks the HIGHEST bounty first, not the first returned', () => {
    const pins = pinsForRegion(spread(20), REGION);

    // spread() makes bounty rise with index, so the last post wins.
    expect(pins.find((pin) => pin.rank === 0)?.key).toBe('p19');
    expect(pins.find((pin) => pin.rank === 19)?.key).toBe('p00');
  });

  // Server order varies between searches. Under heavy overlap paint order is
  // what decides which marker a tap HITS, so an unstable rank would make taps
  // land on a different car on identical data as the user pans.
  it('breaks bounty ties deterministically, whatever order posts arrive in', () => {
    const tied = spread(6).map((p) => ({ ...p, bountyPence: 5000 }));

    const rankOf = (posts: MapPost[]) =>
      Object.fromEntries(pinsForRegion(posts, REGION).map((pin) => [pin.key, pin.rank]));

    expect(rankOf([...tied].reverse())).toEqual(rankOf(tied));
  });

  // Culling happens FIRST: a bigger bounty outside the viewport must not push
  // a visible marker down the paint order.
  it('ranks only what is in view', () => {
    const pins = pinsForRegion(
      [post('near', 51.75, -0.34, 1000), post('richOffscreen', 55.86, -4.25, 999999)],
      REGION,
    );

    expect(pins).toHaveLength(1);
    expect(pins[0].key).toBe('near');
    expect(pins[0].rank).toBe(0);
  });

  // ADR-0014: a no-reward listing has a NULL bounty. `b.bountyPence -
  // a.bountyPence` on a null yields NaN, which makes the comparator
  // INCONSISTENT rather than merely wrong — and rank drives marker zIndex (so
  // it decides which marker a tap hits), the AT cap, and mount order.
  it('ranks no-reward listings last without producing NaN', () => {
    const pins = pinsForRegion(
      [
        post('noReward', 51.75, -0.34, null),
        post('small', 51.752, -0.338, 5000),
        post('big', 51.754, -0.336, 400000),
      ],
      REGION,
    );

    const rankOfKey = Object.fromEntries(pins.map((pin) => [pin.key, pin.rank]));
    expect(rankOfKey.big).toBe(0);
    expect(rankOfKey.small).toBe(1);
    expect(rankOfKey.noReward).toBe(2);
    // Every rank is a real, distinct integer — a NaN comparator silently
    // produces duplicates or an input-order-dependent shuffle instead.
    expect(pins.every((pin) => Number.isInteger(pin.rank))).toBe(true);
    expect(new Set(pins.map((pin) => pin.rank)).size).toBe(pins.length);
  });

  it('stays order-independent when several listings have no reward', () => {
    // The id tie-break is load-bearing: server order varies between searches,
    // and paint order must not. Nulls must not escape that guarantee.
    const posts = [
      post('a', 51.75, -0.34, null),
      post('b', 51.752, -0.338, null),
      post('c', 51.754, -0.336, null),
    ];
    const rankOf = (input: MapPost[]) =>
      Object.fromEntries(pinsForRegion(input, REGION).map((pin) => [pin.key, pin.rank]));

    expect(rankOf([...posts].reverse())).toEqual(rankOf(posts));
  });
});

describe('revealPins (progressive mounting)', () => {
  const item = (key: string, rank: number): MapPinItem => ({
    type: 'post',
    key,
    post: post(key, 51.75, -0.34),
    rank,
  });
  const pins = (count: number): MapPinItem[] =>
    Array.from({ length: count }, (_, i) => item(`p${i}`, i));

  // Highest bounties first, so the markers a user is most likely reaching for
  // are in the FIRST commit and the fill-in adds the long tail.
  it('reveals the highest-ranked markers first', () => {
    const revealed = revealPins(pins(100), 12);

    expect(revealed).toHaveLength(12);
    expect(revealed.map((pin) => pin.rank)).toEqual(Array.from({ length: 12 }, (_, i) => i));
  });

  it('withholds nothing once the budget covers the population', () => {
    const all = pins(30);

    // Identity, not just length: MapPins is memoised, so a fresh array every
    // tick after the reveal finished would re-render every marker.
    expect(revealPins(all, 30)).toBe(all);
    expect(revealPins(all, 999)).toBe(all);
  });

  it('keeps the original order — this feeds a keyed marker list', () => {
    const keys = revealPins(pins(6), 3).map((pin) => pin.key);

    expect(keys).toEqual(['p0', 'p1', 'p2']);
  });

  it('handles an empty view', () => {
    expect(revealPins([], 20)).toEqual([]);
  });
});

describe('revealPins never withholds the SELECTED pin', () => {
  const item = (key: string, rank: number): MapPinItem => ({
    type: 'post',
    key,
    post: post(key, 51.75, -0.34),
    rank,
  });
  const many = (count: number): MapPinItem[] =>
    Array.from({ length: count }, (_, i) => item(`p${i}`, i));

  // Selection is promoted to a pill DOWNSTREAM, in the renderer — which never
  // sees a pin dropped here. Without this guard the promotion silently does
  // nothing and the card describes a car with no marker under it.
  it('keeps a selected low-rank marker that the budget would have dropped', () => {
    const revealed = revealPins(many(80), 2, 'p40');

    expect(revealed.map((pin) => pin.key)).toContain('p40');
  });

  // Reachable via the PAGER, not a pin tap: selectByIndex walks every result
  // post, not just the drawn ones, so a swipe during the reveal can land on a
  // withheld one — and handlePagerSettle then flies the camera to it.
  it('still withholds its unselected neighbours', () => {
    const revealed = revealPins(many(80), 2, 'p40');

    expect(revealed.map((pin) => pin.key)).not.toContain('p41');
    expect(revealed).toHaveLength(3); // 2 budgeted + the selected one
  });

  it('does not double-count the selected pin against the budget', () => {
    const withSelection = revealPins(many(80), 5, 'p40');
    const without = revealPins(many(80), 5, null);

    expect(withSelection).toHaveLength(without.length + 1);
  });

  it('is a no-op when the selected marker was inside the budget anyway', () => {
    const revealed = revealPins(many(80), 5, 'p0');

    expect(revealed).toHaveLength(5); // nothing added twice
  });
});

describe('keepMarkersOnScreen (nothing gets cut in half)', () => {
  const VIEW: GeoRegion = {
    latitude: 51.75,
    longitude: -0.34,
    latitudeDelta: 0.17,
    longitudeDelta: 0.18, // 360pt wide -> 0.0005 deg per pt
  };
  const WIDTH = 360;
  const pillAt = (lng: number): MapPinItem => ({
    type: 'post',
    key: 'p',
    post: post('p', 51.75, lng),
    rank: 0,
  });
  /** Longitude `dp` points in from the WEST edge. */
  const fromWest = (dp: number) => VIEW.longitude - VIEW.longitudeDelta / 2 + (dp / WIDTH) * VIEW.longitudeDelta;

  it('leaves markers in open ground centred', () => {
    const pins = [pillAt(VIEW.longitude)];

    const out = keepMarkersOnScreen(pins, VIEW, WIDTH);

    expect(out).toBe(pins); // identity kept for the memoised renderer
  });

  // A 72pt pill 10pt from the edge would hang 26pt off it — and a clipped
  // price reads "£1,3…", which cannot be told from £13,000.
  it('shifts a pill that the WEST edge would cut in half', () => {
    const out = keepMarkersOnScreen([pillAt(fromWest(10))], VIEW, WIDTH);

    const anchor = out[0].anchor;
    expect(anchor).toBeDefined();
    expect(anchor!.x).toBeLessThan(0.5);
    // Box starts at x - anchor.x*width; must not be off-screen.
    expect(10 - anchor!.x * 72).toBeGreaterThanOrEqual(-0.001);
  });

  it('shifts a pill that the EAST edge would cut in half', () => {
    const out = keepMarkersOnScreen([pillAt(fromWest(WIDTH - 10))], VIEW, WIDTH);

    const anchor = out[0].anchor;
    expect(anchor).toBeDefined();
    expect(anchor!.x).toBeGreaterThan(0.5);
    // Box ends at x + (1-anchor.x)*width; must not overrun the map.
    expect(WIDTH - 10 + (1 - anchor!.x) * 72).toBeLessThanOrEqual(WIDTH + 0.001);
  });

  // The anchor moves the BOX, never the point. This is the whole reason it
  // survived while the fan-out did not: a displaced POSITION has to grow as you
  // zoom out to keep a constant on-screen gap, so fanned markers slid across
  // the map on every camera change. An anchor offset is bounded by the marker's
  // own width and the coordinate underneath never moves.
  it('never changes the coordinate it is pinned to', () => {
    const out = keepMarkersOnScreen([pillAt(fromWest(2))], VIEW, WIDTH);

    expect(out[0].post.longitude).toBeCloseTo(fromWest(2), 10);
  });

});
