/**
 * WHAT:  Tests for MoneySlider's pure maths — curve monotonicity, exact
 *        bounds, position↔pence round-trips, tiered snapping (including the
 *        £500 step change), clamping, and formatter parity.
 * WHY:   The mapping IS the money here: a curve or snap slip writes a wrong
 *        bounty without anyone noticing, so the maths are pinned exhaustively
 *        where they're cheap to test (no rendering). Tier 1 money adjacent
 *        per docs/TESTING.md.
 * LINKS: src/shared/ui/moneySliderMath.ts; src/shared/lib/money.ts.
 */

import { formatPounds } from '../lib/money';
import {
  clampPence,
  type CurveConfig,
  formatWholePounds,
  penceToPosition,
  positionToPence,
  type SnapStep,
  snapPence,
  stepAtPence,
} from './moneySliderMath';

/** The bounty configuration: £50–£5,000, £25 steps to £500 then £50 steps. */
const BOUNTY: CurveConfig = { minPence: 5000, maxPence: 500000, curveExponent: 2 };
const BOUNTY_STEPS: SnapStep[] = [{ upToPence: 50000, stepPence: 2500 }, { stepPence: 5000 }];

describe('penceToPosition / positionToPence', () => {
  it('is exact at the bounds in both directions', () => {
    expect(penceToPosition(BOUNTY.minPence, BOUNTY)).toBe(0);
    expect(penceToPosition(BOUNTY.maxPence, BOUNTY)).toBe(1);
    expect(positionToPence(0, BOUNTY)).toBe(BOUNTY.minPence);
    expect(positionToPence(1, BOUNTY)).toBe(BOUNTY.maxPence);
  });

  it('is strictly monotonic across the range', () => {
    let previous = -1;
    for (let pence = BOUNTY.minPence; pence <= BOUNTY.maxPence; pence += 2500) {
      const position = penceToPosition(pence, BOUNTY);
      expect(position).toBeGreaterThan(previous);
      previous = position;
    }
  });

  it('round-trips pence → position → pence exactly', () => {
    for (let pence = BOUNTY.minPence; pence <= BOUNTY.maxPence; pence += 12500) {
      expect(positionToPence(penceToPosition(pence, BOUNTY), BOUNTY)).toBe(pence);
    }
    expect(positionToPence(penceToPosition(BOUNTY.maxPence, BOUNTY), BOUNTY)).toBe(
      BOUNTY.maxPence,
    );
  });

  it('gives lower amounts more track than a linear mapping (exponent 2)', () => {
    // A quarter of the value range sits at HALF the track.
    const quarterValue = BOUNTY.minPence + (BOUNTY.maxPence - BOUNTY.minPence) / 4;
    expect(penceToPosition(quarterValue, BOUNTY)).toBeCloseTo(0.5, 10);
  });

  it('exponent 1 is linear', () => {
    const linear: CurveConfig = { ...BOUNTY, curveExponent: 1 };
    const midValue = (BOUNTY.minPence + BOUNTY.maxPence) / 2;
    expect(penceToPosition(midValue, linear)).toBeCloseTo(0.5, 10);
  });

  it('clamps out-of-range inputs instead of extrapolating', () => {
    expect(penceToPosition(0, BOUNTY)).toBe(0);
    expect(penceToPosition(BOUNTY.maxPence * 2, BOUNTY)).toBe(1);
    expect(positionToPence(-0.5, BOUNTY)).toBe(BOUNTY.minPence);
    expect(positionToPence(1.5, BOUNTY)).toBe(BOUNTY.maxPence);
  });

  it('degenerate range (min === max) pins to the start, never divides by zero', () => {
    const degenerate: CurveConfig = { minPence: 5000, maxPence: 5000, curveExponent: 2 };
    expect(penceToPosition(5000, degenerate)).toBe(0);
    expect(positionToPence(0.5, degenerate)).toBe(5000);
  });
});

describe('stepAtPence', () => {
  it('picks the tier covering the amount, boundary inclusive', () => {
    expect(stepAtPence(20000, BOUNTY_STEPS)).toBe(2500); // £200 → £25 steps
    expect(stepAtPence(50000, BOUNTY_STEPS)).toBe(2500); // £500 exactly → still £25
    expect(stepAtPence(50001, BOUNTY_STEPS)).toBe(5000); // past £500 → £50 steps
    expect(stepAtPence(400000, BOUNTY_STEPS)).toBe(5000);
  });
});

describe('snapPence', () => {
  it('snaps to the £25 grid below £500 and the £50 grid above', () => {
    expect(snapPence(21100, BOUNTY_STEPS, BOUNTY.minPence, BOUNTY.maxPence)).toBe(20000); // £211 → £200
    expect(snapPence(21300, BOUNTY_STEPS, BOUNTY.minPence, BOUNTY.maxPence)).toBe(22500); // £213 → £225
    expect(snapPence(53000, BOUNTY_STEPS, BOUNTY.minPence, BOUNTY.maxPence)).toBe(55000); // £530 → £550
    expect(snapPence(51000, BOUNTY_STEPS, BOUNTY.minPence, BOUNTY.maxPence)).toBe(50000); // £510 → £500
  });

  it('anchors the upper tier at the boundary so crossing £500 stays on-grid', () => {
    // The £50 grid runs £500, £550, £600… (anchored at the £500 boundary).
    expect(snapPence(52400, BOUNTY_STEPS, BOUNTY.minPence, BOUNTY.maxPence)).toBe(50000);
    expect(snapPence(52600, BOUNTY_STEPS, BOUNTY.minPence, BOUNTY.maxPence)).toBe(55000);
  });

  it('keeps min and max exactly reachable', () => {
    expect(snapPence(BOUNTY.minPence, BOUNTY_STEPS, BOUNTY.minPence, BOUNTY.maxPence)).toBe(
      BOUNTY.minPence,
    );
    expect(snapPence(BOUNTY.maxPence, BOUNTY_STEPS, BOUNTY.minPence, BOUNTY.maxPence)).toBe(
      BOUNTY.maxPence,
    );
    expect(snapPence(BOUNTY.maxPence + 999, BOUNTY_STEPS, BOUNTY.minPence, BOUNTY.maxPence)).toBe(
      BOUNTY.maxPence,
    );
  });

  it('with no steps, only clamps', () => {
    expect(snapPence(23700, [], BOUNTY.minPence, BOUNTY.maxPence)).toBe(23700);
  });
});

describe('clampPence', () => {
  it('clamps and rounds to integer pence', () => {
    expect(clampPence(100, 5000, 500000)).toBe(5000);
    expect(clampPence(9e9, 5000, 500000)).toBe(500000);
    expect(clampPence(20000.4, 5000, 500000)).toBe(20000);
  });
});

describe('formatWholePounds', () => {
  it('matches formatPounds for whole-pound amounts (the readout contract)', () => {
    for (const pence of [0, 5000, 20000, 50000, 123400, 500000, 100000000]) {
      expect(formatWholePounds(pence)).toBe(formatPounds(pence));
    }
  });

  it('rounds mid-drag fractional values to the nearest pound', () => {
    expect(formatWholePounds(20049)).toBe('£200');
    expect(formatWholePounds(20051)).toBe('£201');
  });

  it('handles negatives like formatPounds does', () => {
    expect(formatWholePounds(-50000)).toBe('-£500');
  });
});
