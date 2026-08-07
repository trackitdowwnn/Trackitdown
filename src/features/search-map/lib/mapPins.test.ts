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
import { pinsForRegion, revealPins } from './mapPins';

const post = (
  id: string,
  latitude: number,
  longitude: number,
  bountyPence = 15000,
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

describe('pill vs mini ranking', () => {
  // The floor: a quiet area should read as quiet, not coy. Four markers cost
  // almost no ink whatever they are, so there is nothing to save by hiding
  // three of their prices.
  it('prices every post in a sparse view', () => {
    const pins = pinsForRegion(spread(4), REGION, 12);

    expect(pins).toHaveLength(4);
    expect(pins.every((pin) => pin.emphasis === 'full')).toBe(true);
  });

  // The share: the middle band is where a flat cap did the most damage — 12
  // pills out of 20 posts is a wall of price tags.
  it('prices only a share of a busy view', () => {
    const pins = pinsForRegion(spread(20), REGION, 12);

    expect(pins.filter((pin) => pin.emphasis === 'full')).toHaveLength(4);
    expect(pins.filter((pin) => pin.emphasis === 'mini')).toHaveLength(16);
  });

  // The ceiling: the share would ask for 15 at a hundred posts.
  it('never exceeds maxPricePins however crowded it gets', () => {
    const pins = pinsForRegion(spread(100), REGION, 12);

    expect(pins.filter((pin) => pin.emphasis === 'full')).toHaveLength(12);
    expect(pins).toHaveLength(100);
  });

  it('the pills are the HIGHEST bounties, not the first returned', () => {
    const pins = pinsForRegion(spread(20), REGION, 3);

    const priced = pins
      .filter((pin) => pin.emphasis === 'full')
      .map((pin) => pin.key)
      .sort();
    // spread() makes bounty rise with index, so the last three win.
    expect(priced).toEqual(['p17', 'p18', 'p19']);
  });

  // Server order varies between searches; an unstable sort would flip a post
  // between pill and mini on identical data as the user pans.
  it('breaks bounty ties deterministically, whatever order posts arrive in', () => {
    const tied = spread(6).map((p) => ({ ...p, bountyPence: 5000 }));

    const forwards = pinsForRegion(tied, REGION, 3)
      .filter((pin) => pin.emphasis === 'full')
      .map((pin) => pin.key)
      .sort();
    const backwards = pinsForRegion([...tied].reverse(), REGION, 3)
      .filter((pin) => pin.emphasis === 'full')
      .map((pin) => pin.key)
      .sort();

    expect(forwards).toEqual(backwards);
  });

  // Culling happens FIRST: a high bounty outside the viewport must not take a
  // pill away from one the user can actually see.
  it('ranks only what is in view', () => {
    const pins = pinsForRegion(
      [post('near', 51.75, -0.34, 1000), post('richOffscreen', 55.86, -4.25, 999999)],
      REGION,
      1,
    );

    expect(pins).toHaveLength(1);
    expect(pins[0].key).toBe('near');
    expect(pins[0].emphasis).toBe('full');
  });
});

describe('revealPins (progressive mounting)', () => {
  const item = (key: string, emphasis: 'full' | 'mini'): MapPinItem => ({
    type: 'post',
    key,
    post: post(key, 51.75, -0.34),
    emphasis,
  });
  const pins = (fullCount: number, miniCount: number): MapPinItem[] => [
    ...Array.from({ length: fullCount }, (_, i) => item(`f${i}`, 'full')),
    ...Array.from({ length: miniCount }, (_, i) => item(`m${i}`, 'mini')),
  ];

  // The ranked few are the whole point of the map; a price fading in late
  // would read as the map changing its mind about what matters.
  it('never withholds a priced pin, however small the budget', () => {
    const revealed = revealPins(pins(12, 80), 0);

    expect(revealed).toHaveLength(12);
    expect(revealed.every((pin) => pin.emphasis === 'full')).toBe(true);
  });

  it('reveals the budgeted number of demoted pins on top', () => {
    const revealed = revealPins(pins(12, 80), 20);

    expect(revealed.filter((pin) => pin.emphasis === 'full')).toHaveLength(12);
    expect(revealed.filter((pin) => pin.emphasis === 'mini')).toHaveLength(20);
  });

  // MapPins is memoised. A fresh array on every tick after the reveal has
  // finished would re-render every marker and undo the whole point.
  it('returns the SAME array once nothing is withheld', () => {
    const all = pins(12, 80);

    expect(revealPins(all, 80)).toBe(all);
    expect(revealPins(all, 999)).toBe(all);
  });

  it('keeps the original order — this feeds a keyed marker list', () => {
    const all = pins(2, 4);

    const keys = revealPins(all, 2).map((pin) => pin.key);
    expect(keys).toEqual(['f0', 'f1', 'm0', 'm1']);
  });

  it('handles an empty view', () => {
    expect(revealPins([], 20)).toEqual([]);
  });
});

describe('revealPins never withholds the SELECTED pin', () => {
  const item = (key: string, emphasis: 'full' | 'mini'): MapPinItem => ({
    type: 'post',
    key,
    post: post(key, 51.75, -0.34),
    emphasis,
  });
  const many = (miniCount: number): MapPinItem[] => [
    item('f0', 'full'),
    ...Array.from({ length: miniCount }, (_, i) => item(`m${i}`, 'mini')),
  ];

  // Selection is promoted to a pill DOWNSTREAM, in the renderer — which never
  // sees a pin dropped here. Without this guard the promotion silently does
  // nothing and the card describes a car with no marker under it.
  it('keeps a selected demoted pin that the budget would have dropped', () => {
    const revealed = revealPins(many(80), 2, 'm40');

    expect(revealed.map((pin) => pin.key)).toContain('m40');
  });

  // Reachable via the PAGER, not a pin tap: selectByIndex walks every result
  // post, not just the drawn ones, so a swipe during the reveal can land on a
  // withheld one — and handlePagerSettle then flies the camera to it.
  it('still withholds its unselected neighbours', () => {
    const revealed = revealPins(many(80), 2, 'm40');

    expect(revealed.map((pin) => pin.key)).not.toContain('m41');
    expect(revealed).toHaveLength(4); // f0 + 2 budgeted + the selected one
  });

  it('does not double-count the selected pin against the budget', () => {
    const withSelection = revealPins(many(80), 5, 'm40');
    const without = revealPins(many(80), 5, null);

    expect(withSelection).toHaveLength(without.length + 1);
  });

  it('is a no-op when the selected pin was priced anyway', () => {
    const revealed = revealPins(many(80), 5, 'f0');

    expect(revealed).toHaveLength(6); // f0 + 5 budgeted, nothing added twice
  });
});
