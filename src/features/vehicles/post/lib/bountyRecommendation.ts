/**
 * WHAT:  recommendBounty — turns get_bounty_guidance's two observable signals
 *        into ONE suggested range. Pure, synchronous, unit-tested; no I/O.
 * WHY:   An owner is asked to name a number with nothing to name it against,
 *        and the slider seeds at £250 because a default had to be something.
 *
 *        ⚠️ THE HONEST GUIDANCE IS NOT "cars like yours are recovered N% of the
 *        time". We hold no such data, and inventing it under a MONEY decision
 *        would be the worst thing this feature could do. What we can observe is
 *        exactly two things, and this file may use nothing else:
 *          · REACH — alert_zones.min_bounty_pence literally gates who is shown
 *            the listing, so a bounty buys distribution. That is causal.
 *          · LOCAL — what other owners near here actually set. That is
 *            comparative.
 *
 *        ⚠️ IT SAYS WHAT A BOUNTY REACHES, NEVER WHAT IT RECOVERS. Nothing here
 *        measures outcomes, and no copy built on this output may imply
 *        otherwise. "Reaches", never "notifies" and never "recovers": push
 *        registration, the rolling daily cap and the per-post dedupe all sit
 *        between a reach count and any notification anyone receives.
 * LINKS: supabase/migrations/20260813100000_bounty_guidance.sql (the RPC, its
 *          floors and its containments);
 *        supabase/migrations/20260813130000_bounty_floor_completion.sql (why
 *          the £10 rung is load-bearing here);
 *        ./bountyBounds.ts (the range, and the grid a suggestion must land on);
 *        src/features/vehicles/post/components/postSteps.tsx (the consumer).
 */

import { MAX_BOUNTY_PENCE, MIN_BOUNTY_PENCE, snapBountyPence } from '@/shared/lib/bountyBounds';

/** One point on the reach curve: what this amount reaches, today, near here. */
export interface ReachRung {
  bountyPence: number;
  /** Floored at 5 server-side — 0 means "nobody, or too few to report". */
  reach: number;
}

/** What owners near here actually set. Null when too few to say (floor of 5). */
export interface LocalBand {
  p25Pence: number;
  medianPence: number;
  p75Pence: number;
  sample: number;
}

export interface BountyGuidance {
  rungs: ReachRung[];
  local: LocalBand | null;
}

export interface BountyRecommendation {
  lowPence: number;
  midPence: number;
  highPence: number;
  /** Which signals this rested on — recorded against the chosen amount by
   *  log_bounty_recommendation, so a future recommender can tell advice apart
   *  from outcome. */
  basis: 'reach' | 'local' | 'reach+local';
}

/**
 * Fraction of maximum reach that counts as "most of the people you can reach".
 *
 * The KNEE of the curve: the cheapest rung that already gets you nearly
 * everyone. Above it a higher bounty is buying a handful of extra eyes, which
 * is a real thing to know when the money is yours and your car has just been
 * taken.
 *
 * 0.9 rather than 1.0 deliberately — the top rung is £5,000 and always reaches
 * the maximum by definition, so a threshold of 1.0 would recommend the ceiling
 * to everyone.
 */
const KNEE_FRACTION = 0.9;

/**
 * The rungs worth reasoning about: inside the postable range, in order.
 *
 * ⚠️ THE FLOOR RUNG IS LOAD-BEARING. 20260813130000 records this: a curve that
 * does not start at MIN_BOUNTY_PENCE cannot describe the cheapest amount an
 * owner may pick, so the recommendation could never suggest it. If the floor
 * moves again, the RPC's rung array must move with it.
 */
function usableRungs(rungs: ReachRung[]): ReachRung[] {
  return rungs
    .filter((r) => r.bountyPence >= MIN_BOUNTY_PENCE && r.bountyPence <= MAX_BOUNTY_PENCE)
    .sort((a, b) => a.bountyPence - b.bountyPence);
}

/**
 * The reach half: [cheapest rung that reaches anyone, the knee].
 *
 * Returns null when the curve says nothing — every rung floored to 0, which
 * happens in a quiet area and is NOT the same as "nobody is watching". The RPC
 * reports 0 both for "none" and for "fewer than 5", and an owner hours from a
 * theft must never be shown a map of where nobody is looking.
 */
function reachBandFrom(rungs: ReachRung[]): { lowPence: number; highPence: number } | null {
  const usable = usableRungs(rungs);
  const reaching = usable.filter((r) => r.reach > 0);
  if (reaching.length === 0) return null;

  const maxReach = Math.max(...reaching.map((r) => r.reach));
  const knee = reaching.find((r) => r.reach >= maxReach * KNEE_FRACTION) ?? reaching[reaching.length - 1];

  return { lowPence: reaching[0].bountyPence, highPence: knee.bountyPence };
}

/**
 * Turn the guidance payload into one suggested range, or null when there is
 * nothing honest to say.
 *
 * WHEN BOTH SIGNALS EXIST, the LOCAL band is the range and the KNEE is the
 * suggested point inside it. That division is deliberate: what neighbours pay
 * is real behaviour and makes the better bracket, while the knee is the only
 * thing in the payload that answers "where does more money stop buying more
 * eyes" — clamping it into the band lets it inform the suggestion without
 * overriding what people around here actually do.
 *
 * Returning NULL is a first-class outcome, not a failure. No location yet, a
 * quiet area, too few neighbours to say — in all of them the right answer is to
 * show no guidance at all rather than a confident-looking number resting on
 * two data points.
 */
export function recommendBounty(guidance: BountyGuidance): BountyRecommendation | null {
  const reach = reachBandFrom(guidance.rungs);
  const local = guidance.local;

  if (local && reach) {
    const lowPence = snapBountyPence(local.p25Pence);
    const highPence = snapBountyPence(local.p75Pence);
    // The knee, kept inside the band. Math.min/max rather than a conditional so
    // an inverted band (p25 > p75 is impossible from percentiles, but this is
    // MONEY and the input is remote) still yields a mid inside its own range.
    const midPence = snapBountyPence(
      Math.min(Math.max(reach.highPence, Math.min(lowPence, highPence)), Math.max(lowPence, highPence)),
    );
    return { lowPence, midPence, highPence, basis: 'reach+local' };
  }

  if (local) {
    return {
      lowPence: snapBountyPence(local.p25Pence),
      midPence: snapBountyPence(local.medianPence),
      highPence: snapBountyPence(local.p75Pence),
      basis: 'local',
    };
  }

  if (reach) {
    return {
      lowPence: snapBountyPence(reach.lowPence),
      // With no local band the knee IS the recommendation: it is the cheapest
      // amount that reaches nearly everyone this location can reach.
      midPence: snapBountyPence(reach.highPence),
      highPence: snapBountyPence(reach.highPence),
      basis: 'reach',
    };
  }

  return null;
}

/**
 * Reach at the amount the owner has actually chosen — the highest rung AT OR
 * BELOW it.
 *
 * ⚠️ AT OR BELOW, never the nearest. A bounty of £40 does not reach the people
 * whose alert filter starts at £50, and rounding to the closest rung would
 * quietly promise that it does. Returns null when no rung qualifies, which the
 * caller must render as nothing at all — never "0 spotters".
 */
export function reachAtChosen(rungs: ReachRung[], chosenPence: number): number | null {
  const below = usableRungs(rungs).filter((r) => r.bountyPence <= chosenPence && r.reach > 0);
  return below.length === 0 ? null : below[below.length - 1].reach;
}
