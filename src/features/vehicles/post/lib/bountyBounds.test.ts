/**
 * WHAT:  Tests for the bounty range and the slider snap grid.
 * WHY:   ⚠️ NO COVERAGE until 2026-09-02, on numbers TESTING.md names as Tier 1
 *        must-test — and this file exists BECAUSE of an incident. On
 *        2026-08-13 the floor moved £50 → £10 across seven server-side places;
 *        the client mirror was missed, so for nine days the app enforced £50
 *        against a database that allowed £10. Nothing errored. An owner who
 *        could only offer £15 simply could not post, and no screen said why.
 *
 *        So the assertions here are deliberately literal. Pinning
 *        `MIN_BOUNTY_PENCE === 1000` looks like testing a constant against
 *        itself, and it is not: it is the ONLY place in the repo that will fail
 *        when this number moves without the migration moving with it. The
 *        failure message is the point — it names the file to change next.
 *
 *        `snapBountyPence` gets the real attention, because it has real logic
 *        and a subtle failure: a recommendation the slider cannot land on is
 *        worse than no recommendation, since it tells someone to pick £237 and
 *        then refuses to let them.
 * LINKS: ./bountyBounds.ts;
 *        supabase/migrations/20260813120000_bounty_minimum_ten.sql (the
 *          authority: posts_bounty_amount_pence_check);
 *        supabase/migrations/20260813130000_bounty_floor_completion.sql;
 *        docs/TESTING.md (Tier 1, and the incident this records).
 */

import {
  BOUNTY_SNAP_STEPS,
  DEFAULT_BOUNTY_PENCE,
  MAX_BOUNTY_PENCE,
  MIN_BOUNTY_PENCE,
  snapBountyPence,
} from './bountyBounds';

describe('the bounty range', () => {
  it('⚠️ matches the database CHECK — £10 to £5,000', () => {
    // If this fails, the migration and the app disagree about what an owner may
    // offer, and the symptom is a post that cannot be submitted with no
    // explanation. Change posts_bounty_amount_pence_check FIRST, then here.
    expect(MIN_BOUNTY_PENCE).toBe(1000);
    expect(MAX_BOUNTY_PENCE).toBe(500000);
  });

  it('is integer pence throughout — no floats anywhere near money', () => {
    for (const value of [MIN_BOUNTY_PENCE, MAX_BOUNTY_PENCE, DEFAULT_BOUNTY_PENCE]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('seeds the slider at a value inside its own range', () => {
    // The default must be valid and non-dirty. A default below the floor would
    // open the wizard on an invalid step.
    expect(DEFAULT_BOUNTY_PENCE).toBeGreaterThanOrEqual(MIN_BOUNTY_PENCE);
    expect(DEFAULT_BOUNTY_PENCE).toBeLessThanOrEqual(MAX_BOUNTY_PENCE);
    expect(snapBountyPence(DEFAULT_BOUNTY_PENCE)).toBe(DEFAULT_BOUNTY_PENCE);
  });
});

describe('the snap grid', () => {
  it('keeps the cheapest bounties reachable at £1 steps', () => {
    // ⚠️ THE REASON THE GRID EXISTS. On the old £25 grid the three cheapest
    // selectable bounties would be £10, £25 and £50 — which makes most of the
    // newly-allowed range unreachable and the 2026-08-13 change pointless.
    expect(snapBountyPence(1100)).toBe(1100);
    expect(snapBountyPence(1150)).toBe(1200);
    expect(BOUNTY_SNAP_STEPS[0]).toEqual({ upToPence: 5000, stepPence: 100 });
  });

  it('coarsens as the amount grows', () => {
    // £50–£500: a £25 grid, rounding to nearest.
    expect(snapBountyPence(20000)).toBe(20000);
    expect(snapBountyPence(21200)).toBe(20000);
    expect(snapBountyPence(21300)).toBe(22500);
    // Above £500: a £50 grid.
    expect(snapBountyPence(120000)).toBe(120000);
    expect(snapBountyPence(121000)).toBe(120000);
    expect(snapBountyPence(124000)).toBe(125000);
  });

  it('clamps below the floor and above the ceiling', () => {
    expect(snapBountyPence(0)).toBe(MIN_BOUNTY_PENCE);
    expect(snapBountyPence(-5000)).toBe(MIN_BOUNTY_PENCE);
    expect(snapBountyPence(9_999_999)).toBe(MAX_BOUNTY_PENCE);
  });

  it('⚠️ re-clamps after rounding, so a value just under the ceiling cannot exceed it', () => {
    // Rounding at a band edge can step OUTSIDE the range: on the £50 grid,
    // £4,999 rounds up past £5,000. Without the second clamp this returns an
    // amount the database will reject, from the function whose job is to
    // return one it will accept.
    const justUnder = MAX_BOUNTY_PENCE - 100;
    expect(snapBountyPence(justUnder)).toBeLessThanOrEqual(MAX_BOUNTY_PENCE);
    expect(snapBountyPence(MAX_BOUNTY_PENCE)).toBe(MAX_BOUNTY_PENCE);
  });

  it('always returns something the range accepts, across the whole span', () => {
    // The property that matters more than any single case: whatever goes in,
    // what comes out is offerable.
    for (let pence = -1000; pence <= 520000; pence += 971) {
      const snapped = snapBountyPence(pence);
      expect(snapped).toBeGreaterThanOrEqual(MIN_BOUNTY_PENCE);
      expect(snapped).toBeLessThanOrEqual(MAX_BOUNTY_PENCE);
      expect(Number.isInteger(snapped)).toBe(true);
    }
  });

  it('is idempotent — snapping a snapped value changes nothing', () => {
    // The sliders re-snap on every drag frame; a grid that drifted under
    // repetition would walk an owner's bounty away from what they chose.
    for (const pence of [1000, 1150, 25000, 47600, 499999]) {
      const once = snapBountyPence(pence);
      expect(snapBountyPence(once)).toBe(once);
    }
  });

  it('has exactly one open-ended final band', () => {
    // A grid whose last band had a ceiling would leave amounts above it with no
    // band at all, and `step` would fall back to 1 — silently ungridded.
    const openEnded = BOUNTY_SNAP_STEPS.filter((step) => step.upToPence === undefined);
    expect(openEnded).toHaveLength(1);
    expect(BOUNTY_SNAP_STEPS[BOUNTY_SNAP_STEPS.length - 1].upToPence).toBeUndefined();
  });
});
