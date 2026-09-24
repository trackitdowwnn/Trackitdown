/**
 * WHAT:  Tests for the radius slider's curve and snap grid.
 * WHY:   The grid is a product decision (steps scale with the AREA they add),
 *        so it should break loudly if someone "tidies" it into even steps.
 *        The reachability of 1 and 50 matters most: a snap grid that can't hit
 *        its own bounds silently makes the advertised 1–50 range a lie.
 * LINKS: ./radiusSliderMath.ts; ./moneySliderMath.ts (the shared curve maths,
 *        now a sibling rather than a cross-layer import).
 */

import {
  RADIUS_MAX_MILES as MAX_RADIUS_MILES,
  RADIUS_MIN_MILES as MIN_RADIUS_MILES,
} from '@/shared/lib/distance';
import {
  clampMiles,
  shouldCommitRadius,
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

describe('shouldCommitRadius', () => {
  // ⚠️ THE REGRESSION THIS EXISTS FOR. `lastSnapped` starts at the value the
  // thumb RESTS on, so on a slider showing "Any" the snap comparison alone
  // never fires inside the resting band — above 5 miles the step is 5, making
  // that band 7.5–12.5 around a resting 10. The label cleared and nothing was
  // committed, so the readout stated a number the caller was not filtering by.
  it('commits the FIRST touch even when it lands on the resting value', () => {
    expect(shouldCommitRadius(true, 10, 10)).toBe(true);
  });

  it('commits any touch that crosses a snap boundary', () => {
    expect(shouldCommitRadius(false, 15, 10)).toBe(true);
    expect(shouldCommitRadius(false, 5, 10)).toBe(true);
  });

  it('stays quiet mid-drag while the snapped value has not moved', () => {
    // The emit fires on snap CROSSINGS, not on every frame of a drag — that
    // is what keeps a debounced consumer from refetching per pixel.
    expect(shouldCommitRadius(false, 10, 10)).toBe(false);
  });
});
