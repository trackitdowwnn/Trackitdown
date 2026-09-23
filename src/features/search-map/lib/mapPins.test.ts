/**
 * WHAT:  Tests for pinsInView — viewport culling and bounty order.
 * WHY:   Both fail silently. If culling stops, markers keep drawing where the
 *        user has panned away from (ghosts, not an error). If the order is
 *        unstable, pills swap paint order on identical data as the user pans,
 *        and under overlap paint order decides which car a tap hits.
 * LINKS: src/features/search-map/lib/mapPins.ts, docs/TESTING.md.
 */

import type { GeoRegion } from '@/shared/types';

import type { MapPost } from '../types';
import { pinsInView } from './mapPins';

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

/** Centred on St Albans, ~±0.25°. */
const REGION: GeoRegion = {
  latitude: 51.75,
  longitude: -0.34,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
};

const ids = (posts: MapPost[]) => posts.map((p) => p.id);

describe('culling', () => {
  it('drops posts outside the region', () => {
    const out = pinsInView([post('inside', 51.75, -0.34), post('glasgow', 55.86, -4.25)], REGION);

    expect(ids(out)).toEqual(['inside']);
  });

  it('keeps a post exactly on the boundary', () => {
    expect(pinsInView([post('edge', 51.75 + 0.25, -0.34)], REGION)).toHaveLength(1);
  });

  it('returns nothing when no post is in view', () => {
    expect(pinsInView([post('glasgow', 55.86, -4.25)], REGION)).toEqual([]);
  });
});

describe('order (paint order: first is on top)', () => {
  it('puts the highest bounty first', () => {
    const out = pinsInView(
      [post('small', 51.75, -0.34, 5000), post('big', 51.751, -0.34, 400000), post('mid', 51.752, -0.34, 20000)],
      REGION,
    );

    expect(ids(out)).toEqual(['big', 'mid', 'small']);
  });

  // ADR-0014: a no-reward listing has a NULL bounty. A null subtraction is NaN,
  // which makes the comparator inconsistent rather than merely wrong.
  it('puts no-reward listings last', () => {
    const out = pinsInView(
      [post('none', 51.75, -0.34, null), post('small', 51.751, -0.34, 5000)],
      REGION,
    );

    expect(ids(out)).toEqual(['small', 'none']);
  });

  // Server order varies between searches; paint order must not.
  it('breaks ties on id, whatever order the posts arrive in', () => {
    const tied = [
      post('c', 51.75, -0.34, null),
      post('a', 51.751, -0.34, 5000),
      post('b', 51.752, -0.34, 5000),
      post('d', 51.753, -0.34, null),
    ];

    expect(ids(pinsInView(tied, REGION))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(pinsInView([...tied].reverse(), REGION))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not reorder the caller\'s array', () => {
    const input = [post('small', 51.75, -0.34, 5000), post('big', 51.751, -0.34, 400000)];

    pinsInView(input, REGION);

    expect(ids(input)).toEqual(['small', 'big']);
  });
});
