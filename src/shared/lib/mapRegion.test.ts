/**
 * WHAT:  Tests for regionAround — the radius → viewport framing used by the
 *        map screen and by LocationPicker's fitRadiusMiles.
 * WHY:   The DIAMETER semantic is the trap. `regionAround(c, 5)` spans 10 miles
 *        top-to-bottom, so a 5-mile circle touches both edges exactly. Callers
 *        that DRAW the circle must inflate the radius for breathing room, and
 *        that only makes sense if this function's contract is pinned. Halving
 *        it here to "fix" a cramped map would silently rescale the search
 *        screen's viewport queries instead.
 * LINKS: ./mapRegion.ts; src/features/search-map/lib/regionMath.ts (re-export);
 *        src/shared/ui/LocationPicker.tsx (CIRCLE_FIT_PADDING).
 */

import { regionAround } from './mapRegion';

const LUTON = { latitude: 51.77, longitude: -0.34 };

describe('regionAround', () => {
  it('spans the DIAMETER, so the named radius reaches the viewport edge', () => {
    // 20 miles of radius => 40 miles of span => 40/69 degrees.
    expect(regionAround(LUTON, 20).latitudeDelta).toBeCloseTo(40 / 69, 6);
  });

  it('widens longitude to keep the span square on the ground', () => {
    // Longitude degrees shrink with latitude, so at 51.77°N a degree of
    // longitude covers less ground than one of latitude.
    const region = regionAround(LUTON, 20);
    expect(region.longitudeDelta).toBeGreaterThan(region.latitudeDelta);
  });

  it('keeps the centre it was given', () => {
    const region = regionAround(LUTON, 5);
    expect(region.latitude).toBe(LUTON.latitude);
    expect(region.longitude).toBe(LUTON.longitude);
  });

  it('scales linearly with the radius', () => {
    // The property the alert map's zoom rides on: double the radius, double
    // the span. If this stopped holding, dragging the slider would still move
    // the camera, just not in step with the circle.
    const small = regionAround(LUTON, 5).latitudeDelta;
    const large = regionAround(LUTON, 50).latitudeDelta;
    expect(large / small).toBeCloseTo(10, 6);
  });

  it('clamps the longitude correction near the poles rather than exploding', () => {
    // cos(89°) is ~0.017; without the 0.2 floor the longitudeDelta would blow
    // up ~57x and the map would jump to a whole-hemisphere view.
    const polar = regionAround({ latitude: 89, longitude: 0 }, 5);
    expect(polar.longitudeDelta).toBeCloseTo(polar.latitudeDelta / 0.2, 6);
  });
});
