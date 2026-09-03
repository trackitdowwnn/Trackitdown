/**
 * WHAT:  Tests for recommendBounty and reachAtChosen — the pure half of bounty
 *        guidance.
 * WHY:   MONEY-adjacent, and the arithmetic is the whole feature: this is the
 *        only place a suggested amount is decided, and it is shown to someone
 *        hours after their car was taken. Two properties matter more than the
 *        exact numbers — a suggestion must be selectable on the slider, and
 *        "nothing to say" must produce nothing rather than a confident number.
 * LINKS: ./bountyRecommendation.ts; ./bountyBounds.ts;
 *        supabase/migrations/20260813100000_bounty_guidance.sql.
 */

import { MAX_BOUNTY_PENCE, MIN_BOUNTY_PENCE, snapBountyPence } from '@/shared/lib/bountyBounds';
import { recommendBounty, reachAtChosen, type ReachRung } from './bountyRecommendation';

/** The RPC's eight rungs, with a curve that flattens after £250. */
const CURVE: ReachRung[] = [
  { bountyPence: 1000, reach: 6 },
  { bountyPence: 5000, reach: 12 },
  { bountyPence: 10000, reach: 20 },
  { bountyPence: 25000, reach: 38 },
  { bountyPence: 50000, reach: 40 },
  { bountyPence: 100000, reach: 41 },
  { bountyPence: 250000, reach: 41 },
  { bountyPence: 500000, reach: 41 },
];

/** Every rung floored — a quiet area, which is NOT "nobody is watching". */
const SILENT: ReachRung[] = CURVE.map((r) => ({ ...r, reach: 0 }));

const LOCAL = { p25Pence: 15000, medianPence: 25000, p75Pence: 40000, sample: 11 };

describe('recommendBounty', () => {
  it('says nothing when there is nothing to say', () => {
    // The commonest case in a quiet area, and the one most likely to be got
    // wrong: a floored curve and no neighbours must produce NO guidance, not a
    // confident range resting on two data points.
    expect(recommendBounty({ rungs: SILENT, local: null })).toBeNull();
    expect(recommendBounty({ rungs: [], local: null })).toBeNull();
  });

  it('uses the local band as the range, and the knee as the point inside it', () => {
    const result = recommendBounty({ rungs: CURVE, local: LOCAL });

    expect(result).not.toBeNull();
    expect(result?.basis).toBe('reach+local');
    expect(result?.lowPence).toBe(15000);
    expect(result?.highPence).toBe(40000);
    // The knee is £250 (the cheapest rung reaching >= 90% of 41), which sits
    // inside £150–£400, so it survives unclamped.
    expect(result?.midPence).toBe(25000);
  });

  it('clamps a knee that falls outside what neighbours pay', () => {
    // Neighbours pay far more than the reach curve justifies. The suggestion
    // must stay inside the band — we are not telling someone their whole street
    // is wrong, only where the extra money stops buying eyes.
    const rich = { p25Pence: 100000, medianPence: 150000, p75Pence: 200000, sample: 9 };
    const result = recommendBounty({ rungs: CURVE, local: rich });

    expect(result?.midPence).toBe(100000);
    expect(result?.midPence).toBeGreaterThanOrEqual(result?.lowPence ?? 0);
    expect(result?.midPence).toBeLessThanOrEqual(result?.highPence ?? 0);
  });

  it('falls back to the curve alone when there are too few neighbours', () => {
    const result = recommendBounty({ rungs: CURVE, local: null });

    expect(result?.basis).toBe('reach');
    // Cheapest rung that reaches anyone — the £10 floor rung, which is exactly
    // why the RPC must keep it (20260813130000).
    expect(result?.lowPence).toBe(1000);
    expect(result?.midPence).toBe(25000);
  });

  it('falls back to neighbours alone when the curve says nothing', () => {
    const result = recommendBounty({ rungs: SILENT, local: LOCAL });

    expect(result?.basis).toBe('local');
    expect(result?.lowPence).toBe(15000);
    expect(result?.midPence).toBe(25000);
    expect(result?.highPence).toBe(40000);
  });

  it('never recommends an amount the slider cannot land on', () => {
    // A suggestion off the snap grid tells someone to pick £237 and then
    // refuses to let them. Percentiles come back as raw pence, so this is a
    // real risk rather than a theoretical one.
    const awkward = { p25Pence: 13711, medianPence: 24099, p75Pence: 41234, sample: 7 };
    const result = recommendBounty({ rungs: CURVE, local: awkward });

    for (const value of [result?.lowPence, result?.midPence, result?.highPence]) {
      expect(value).toBe(snapBountyPence(value ?? 0));
      expect(value).toBeGreaterThanOrEqual(MIN_BOUNTY_PENCE);
      expect(value).toBeLessThanOrEqual(MAX_BOUNTY_PENCE);
    }
  });

  it('ignores rungs outside the postable range', () => {
    // A stale RPC still serving the old £50 first rung, or one that grew a
    // rung above the ceiling, must not produce an unpostable suggestion.
    const outOfRange: ReachRung[] = [
      { bountyPence: 100, reach: 30 },
      { bountyPence: 900000, reach: 99 },
      ...CURVE,
    ];
    const result = recommendBounty({ rungs: outOfRange, local: null });

    expect(result?.lowPence).toBeGreaterThanOrEqual(MIN_BOUNTY_PENCE);
    expect(result?.highPence).toBeLessThanOrEqual(MAX_BOUNTY_PENCE);
  });
});

describe('reachAtChosen', () => {
  it('takes the highest rung AT OR BELOW the chosen amount', () => {
    // £40 does NOT reach the people whose alert filter starts at £50, and
    // rounding to the nearest rung would quietly promise that it does.
    expect(reachAtChosen(CURVE, 4000)).toBe(6);
    expect(reachAtChosen(CURVE, 5000)).toBe(12);
    expect(reachAtChosen(CURVE, 24999)).toBe(20);
  });

  it('returns null rather than 0 when no rung qualifies', () => {
    // Rendered as nothing at all. An owner hours from a theft must never be
    // told "0 spotters are watching" — demoralising, unactionable, and a map of
    // where nobody is looking.
    expect(reachAtChosen(CURVE, 500)).toBeNull();
    expect(reachAtChosen(SILENT, 500000)).toBeNull();
    expect(reachAtChosen([], 25000)).toBeNull();
  });
});
