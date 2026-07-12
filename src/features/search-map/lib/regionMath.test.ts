/**
 * WHAT:  Tests for regionMath — bbox conversion, the moved-enough rule
 *        (centre shift and zoom change, both directions), point-at-radius
 *        framing, coord framing with padding/minimums, and zoom levels.
 * WHY:   These numbers drive when "Search this area" appears and what the
 *        RPC is asked for; a wrong sign here searches the wrong half of
 *        the country without any visible error.
 * LINKS: src/features/search-map/lib/regionMath.ts, docs/TESTING.md.
 */

import type { GeoRegion } from '@/shared/types';

import {
  frameCoords,
  movedEnough,
  regionAround,
  regionToBbox,
  regionZoom,
} from './regionMath';

const HERTS: GeoRegion = {
  latitude: 51.77,
  longitude: -0.34,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
};

describe('regionToBbox', () => {
  it('halves deltas around the centre', () => {
    const bbox = regionToBbox(HERTS);
    expect(bbox.minLat).toBeCloseTo(51.52, 10);
    expect(bbox.maxLat).toBeCloseTo(52.02, 10);
    expect(bbox.minLng).toBeCloseTo(-0.59, 10);
    expect(bbox.maxLng).toBeCloseTo(-0.09, 10);
  });
});

describe('movedEnough', () => {
  it('stays quiet for small nudges', () => {
    const nudged = { ...HERTS, latitude: HERTS.latitude + 0.05 }; // 10% of span
    expect(movedEnough(HERTS, nudged)).toBe(false);
  });

  it('fires when the centre shifts beyond the fraction', () => {
    const panned = { ...HERTS, longitude: HERTS.longitude + 0.2 }; // 40% of span
    expect(movedEnough(HERTS, panned)).toBe(true);
  });

  it('fires on zoom OUT and zoom IN beyond ~40%', () => {
    expect(movedEnough(HERTS, { ...HERTS, latitudeDelta: 0.8, longitudeDelta: 0.8 })).toBe(true);
    expect(movedEnough(HERTS, { ...HERTS, latitudeDelta: 0.3, longitudeDelta: 0.3 })).toBe(true);
    expect(movedEnough(HERTS, { ...HERTS, latitudeDelta: 0.55, longitudeDelta: 0.55 })).toBe(
      false,
    );
  });
});

describe('regionAround', () => {
  it('spans ~2x the radius in latitude and widens longitude at UK latitudes', () => {
    const region = regionAround({ latitude: 51.77, longitude: -0.34 }, 20);
    expect(region.latitudeDelta).toBeCloseTo(40 / 69, 5);
    expect(region.longitudeDelta).toBeGreaterThan(region.latitudeDelta); // cos(51.77°) < 1
  });
});

describe('frameCoords', () => {
  const fallback = HERTS;

  it('falls back when empty', () => {
    expect(frameCoords([], fallback)).toBe(fallback);
  });

  it('centres on the coords with padding', () => {
    const region = frameCoords(
      [
        { latitude: 51.7, longitude: -0.4 },
        { latitude: 51.9, longitude: -0.2 },
      ],
      fallback,
    );
    expect(region.latitude).toBeCloseTo(51.8, 5);
    expect(region.longitude).toBeCloseTo(-0.3, 5);
    expect(region.latitudeDelta).toBeCloseTo(0.2 * 1.4, 5);
  });

  it('applies minimum spans for a single point', () => {
    const region = frameCoords([{ latitude: 51.7, longitude: -0.4 }], fallback);
    expect(region.latitudeDelta).toBe(0.01);
    expect(region.longitudeDelta).toBe(0.01);
  });
});

describe('regionZoom', () => {
  it('is coarser zoomed out, finer zoomed in', () => {
    expect(regionZoom({ ...HERTS, longitudeDelta: 45 })).toBe(3);
    expect(regionZoom({ ...HERTS, longitudeDelta: 0.35 })).toBe(10);
    expect(regionZoom({ ...HERTS, longitudeDelta: 0.01 })).toBe(15);
  });
});
