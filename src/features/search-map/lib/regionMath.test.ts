/**
 * WHAT:  Tests for regionMath — bbox conversion, the moved-enough rule
 *        (centre shift and zoom change, both directions), point-at-radius
 *        framing, coord framing with padding/minimums, and the camera insets
 *        for chrome floating over the map.
 * WHY:   These numbers drive when the map re-searches itself and what the
 *        RPC is asked for; a wrong sign here searches the wrong half of
 *        the country without any visible error.
 * LINKS: src/features/search-map/lib/regionMath.ts, docs/TESTING.md.
 */

import type { GeoRegion } from '@/shared/types';

import {
  NO_INSETS,
  type MapInsets,
  cameraForVisible,
  distanceMeters,
  frameCoords,
  isComfortablyVisible,
  movedEnough,
  regionAround,
  regionToBbox,
  visibleCentre,
  visibleRegion,
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

describe('distanceMeters', () => {
  it('is zero for the same point', () => {
    expect(distanceMeters(HERTS, HERTS)).toBe(0);
  });

  it('matches a known distance (St Albans → central London ≈ 30 km)', () => {
    const stAlbans = { latitude: 51.752, longitude: -0.339 };
    const london = { latitude: 51.5074, longitude: -0.1278 };
    const d = distanceMeters(stAlbans, london);
    expect(d).toBeGreaterThan(28_000);
    expect(d).toBeLessThan(33_000);
  });

  it('is symmetric', () => {
    const a = { latitude: 51.7, longitude: -0.4 };
    const b = { latitude: 52.2, longitude: 0.1 };
    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 6);
  });

  it('orders nearer points before farther ones', () => {
    const centre = { latitude: 51.77, longitude: -0.34 };
    const near = { latitude: 51.78, longitude: -0.34 };
    const far = { latitude: 51.9, longitude: -0.34 };
    expect(distanceMeters(centre, near)).toBeLessThan(distanceMeters(centre, far));
  });
});

describe('isComfortablyVisible', () => {
  it('is true at the centre', () => {
    expect(isComfortablyVisible(HERTS, HERTS)).toBe(true);
  });

  it('is false outside the region entirely', () => {
    const outside = { latitude: HERTS.latitude + 1, longitude: HERTS.longitude };
    expect(isComfortablyVisible(outside, HERTS)).toBe(false);
  });

  it('is false inside the region but within the edge margin', () => {
    // 0.24 above centre is inside the 0.25 half-span but past the 15%
    // margin line at 0.25 * 0.7 = 0.175 — visible, yet not comfortably.
    const nearEdge = { latitude: HERTS.latitude + 0.24, longitude: HERTS.longitude };
    expect(isComfortablyVisible(nearEdge, HERTS)).toBe(false);
  });

  it('is true just inside the margin line', () => {
    const comfortable = { latitude: HERTS.latitude + 0.17, longitude: HERTS.longitude };
    expect(isComfortablyVisible(comfortable, HERTS)).toBe(true);
  });

  it('respects a custom margin', () => {
    const point = { latitude: HERTS.latitude + 0.2, longitude: HERTS.longitude };
    expect(isComfortablyVisible(point, HERTS, 0)).toBe(true); // any visible is fine
    expect(isComfortablyVisible(point, HERTS, 0.3)).toBe(false); // strict centre band
  });
});

describe('map insets', () => {
  // The sheet covers the BOTTOM, so what you can see is the upper band —
  // its centre sits NORTH of the full rect's centre (latitude increases
  // up-screen). Getting this sign wrong points every fly-to the wrong way.
  const SHEET: MapInsets = { top: 0, bottom: 0.25 };

  it('shrinks the visible span and moves its centre away from the chrome', () => {
    const visible = visibleRegion(HERTS, SHEET);

    expect(visible.latitudeDelta).toBeCloseTo(0.5 * 0.75, 10);
    expect(visible.latitude).toBeCloseTo(51.77 + 0.25 * 0.5 / 2, 10); // north
    // Longitude is untouched — there are no left/right insets.
    expect(visible.longitude).toBe(HERTS.longitude);
    expect(visible.longitudeDelta).toBe(HERTS.longitudeDelta);
  });

  it('a top inset moves the visible centre the OTHER way', () => {
    const visible = visibleRegion(HERTS, { top: 0.25, bottom: 0 });

    expect(visible.latitude).toBeCloseTo(51.77 - 0.25 * 0.5 / 2, 10); // south
  });

  // cameraForVisible is the exact inverse of visibleRegion. If this drifts,
  // framing a cluster lands it under the sheet.
  it('round-trips: framing a target then reading it back gives the target', () => {
    const target: GeoRegion = {
      latitude: 51.5,
      longitude: -0.12,
      latitudeDelta: 0.08,
      longitudeDelta: 0.08,
    };

    const camera = cameraForVisible(target, SHEET);
    const backToVisible = visibleRegion(camera, SHEET);

    expect(backToVisible.latitude).toBeCloseTo(target.latitude, 10);
    expect(backToVisible.longitude).toBeCloseTo(target.longitude, 10);
    expect(backToVisible.latitudeDelta).toBeCloseTo(target.latitudeDelta, 10);
  });

  it('round-trips with chrome on BOTH edges', () => {
    const both: MapInsets = { top: 0.12, bottom: 0.3 };
    const camera = cameraForVisible(HERTS, both);

    const back = visibleRegion(camera, both);

    expect(back.latitude).toBeCloseTo(HERTS.latitude, 10);
    expect(back.latitudeDelta).toBeCloseTo(HERTS.latitudeDelta, 10);
  });

  it('is the identity when there is no chrome', () => {
    expect(visibleRegion(HERTS, NO_INSETS)).toEqual(HERTS);
    expect(cameraForVisible(HERTS, NO_INSETS)).toEqual(HERTS);
    expect(visibleCentre(HERTS, NO_INSETS)).toEqual({
      latitude: HERTS.latitude,
      longitude: HERTS.longitude,
    });
  });

  it('gives the visible centre, not the rect centre, as the sort anchor', () => {
    const centre = visibleCentre(HERTS, SHEET);

    expect(centre.latitude).toBeGreaterThan(HERTS.latitude);
    expect(centre.longitude).toBe(HERTS.longitude);
  });
});

describe('the visible-fraction FLOOR', () => {
  // The full sheet snap plus the top bar leaves ~1% of the map visible. The
  // floor stops that turning into a 100x camera; the trap is that callers who
  // recompute the fraction inline don't get it.
  const NEARLY_ALL_CHROME: MapInsets = { top: 0.108, bottom: 0.88 };

  it('still round-trips where the floor BITES', () => {
    const camera = cameraForVisible(HERTS, NEARLY_ALL_CHROME);
    const back = visibleRegion(camera, NEARLY_ALL_CHROME);

    expect(back.latitudeDelta).toBeCloseTo(HERTS.latitudeDelta, 10);
    expect(back.latitude).toBeCloseTo(HERTS.latitude, 10);
  });

  // REGRESSION GUARD. MapSearchScreen's recentre and card-follow used to build
  // their target span as `settled.latitudeDelta * (1 - top - bottom)` and hand
  // it to cameraForVisible — which then divides by the FLOORED fraction. The
  // two agree only while (1 - top - bottom) >= 0.2. At the full snap the inline
  // gives 0.012 against a floor of 0.2, so recentring became a ~16x zoom IN;
  // on a tall-inset, short-window device the inline goes NEGATIVE and hands the
  // map a negative latitudeDelta. visibleRegion IS the floored value, so it is
  // the only correct way to ask "how much do I see".
  it('is what an inline (1 - top - bottom) gets wrong', () => {
    const inlineFraction = 1 - NEARLY_ALL_CHROME.top - NEARLY_ALL_CHROME.bottom;
    const flooredSpan = visibleRegion(HERTS, NEARLY_ALL_CHROME).latitudeDelta;

    expect(inlineFraction).toBeLessThan(0.2);
    expect(HERTS.latitudeDelta * inlineFraction).toBeLessThan(flooredSpan);
    // Feeding the inline value back through the camera SHRINKS the view...
    expect(
      cameraForVisible(
        { ...HERTS, latitudeDelta: HERTS.latitudeDelta * inlineFraction },
        NEARLY_ALL_CHROME,
      ).latitudeDelta,
    ).toBeLessThan(HERTS.latitudeDelta);
    // ...where the floored value returns the span the user already had.
    expect(
      cameraForVisible({ ...HERTS, latitudeDelta: flooredSpan }, NEARLY_ALL_CHROME).latitudeDelta,
    ).toBeCloseTo(HERTS.latitudeDelta, 10);
  });

  it('never lets chrome produce a negative or zero span', () => {
    const impossible: MapInsets = { top: 0.15, bottom: 0.9 }; // sums past 1
    const visible = visibleRegion(HERTS, impossible);

    expect(visible.latitudeDelta).toBeGreaterThan(0);
  });
});
