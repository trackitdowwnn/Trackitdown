/**
 * WHAT:  Tests for the radius slider's curve and snap grid.
 * WHY:   The grid is a product decision (steps scale with the AREA they add),
 *        so it should break loudly if someone "tidies" it into even steps.
 *        The reachability of 1 and 50 matters most: a snap grid that can't hit
 *        its own bounds silently makes the advertised 1–50 range a lie.
 * LINKS: ./radiusSliderMath.ts; src/shared/ui/moneySliderMath.ts.
 */

import { MAX_RADIUS_MILES, MIN_RADIUS_MILES } from '../types';
import {
  clampMiles,
  formatMiles,
  milesToPosition,
  positionToMiles,
  snapMiles,
  stepAtMiles,
} from './radiusSliderMath';

describe('snapMiles', () => {
  it('snaps in 1s below 5 miles', () => {
    expect(snapMiles(2.4)).toBe(2);
    expect(snapMiles(3.6)).toBe(4);
  });

  it('snaps in 5s between 5 and 20 miles', () => {
    expect(snapMiles(12)).toBe(10);
    expect(snapMiles(13)).toBe(15);
  });

  it('snaps in 10s above 20 miles', () => {
    expect(snapMiles(34)).toBe(30);
    expect(snapMiles(36)).toBe(40);
  });

  it('keeps both bounds exactly reachable', () => {
    expect(snapMiles(MIN_RADIUS_MILES)).toBe(MIN_RADIUS_MILES);
    expect(snapMiles(MAX_RADIUS_MILES)).toBe(MAX_RADIUS_MILES);
    // Beyond the ends, clamp rather than overshoot.
    expect(snapMiles(0)).toBe(MIN_RADIUS_MILES);
    expect(snapMiles(999)).toBe(MAX_RADIUS_MILES);
  });
});

describe('stepAtMiles', () => {
  it('coarsens as the radius climbs', () => {
    // 1->2 miles quadruples the area; 40->50 adds about half again. The step
    // sizes exist to track that, so they must never be equal.
    expect(stepAtMiles(2)).toBe(1);
    expect(stepAtMiles(10)).toBe(5);
    expect(stepAtMiles(40)).toBe(10);
  });
});

describe('the curve', () => {
  it('round-trips position and miles', () => {
    for (const miles of [1, 5, 10, 20, 35, 50]) {
      expect(positionToMiles(milesToPosition(miles))).toBe(miles);
    }
  });

  it('is monotonic', () => {
    let previous = -1;
    for (let miles = MIN_RADIUS_MILES; miles <= MAX_RADIUS_MILES; miles += 1) {
      const position = milesToPosition(miles);
      expect(position).toBeGreaterThan(previous);
      previous = position;
    }
  });

  it('gives the low miles more of the track than a linear curve would', () => {
    // The whole point of the exponent: 1-10 miles (a fifth of the range)
    // should occupy noticeably more than a fifth of the track.
    const tenth = milesToPosition(10);
    expect(tenth).toBeGreaterThan((10 - MIN_RADIUS_MILES) / (MAX_RADIUS_MILES - MIN_RADIUS_MILES));
  });
});

describe('clampMiles / formatMiles', () => {
  it('clamps without snapping', () => {
    expect(clampMiles(7)).toBe(7); // 7 is off-grid but in range
    expect(clampMiles(0)).toBe(MIN_RADIUS_MILES);
    expect(clampMiles(80)).toBe(MAX_RADIUS_MILES);
  });

  it('singularises one mile', () => {
    expect(formatMiles(1)).toBe('1 mile');
    expect(formatMiles(20)).toBe('20 miles');
  });
});
