/**
 * WHAT:  useBountyGuidance — fetches the reach curve and the local band ONCE
 *        for a location, and derives the suggested range from them.
 * WHY:   Replaces a per-drag round trip. useAlertReach asked the server for one
 *        point every time the slider settled; get_bounty_guidance returns all
 *        eight rungs in a single call, which is what its own migration was
 *        written for — "eight rungs is eight calls any authenticated client
 *        could already make, spent as one".
 *
 *        The difference that matters is not the saved requests: it is that a
 *        CURVE can answer "where does more money stop buying more eyes", and a
 *        single point never can.
 *
 *        ⚠️ REACH IS THEREFORE QUANTISED TO THE RUNGS, and always rounds DOWN
 *        (reachAtChosen takes the highest rung at or below the amount). £40
 *        shows what £25 reaches, because £40 genuinely does not reach the people
 *        whose alert filter starts at £50. Understating is the safe direction
 *        for a number an owner is about to spend money against; overstating
 *        would be a promise we cannot keep.
 * LINKS: ../api/bountyGuidanceApi.ts; ../lib/bountyRecommendation.ts;
 *        supabase/migrations/20260813100000_bounty_guidance.sql.
 *
 * (The superseded `useAlertReach` was deleted on 2026-09-03 — it had had no
 * caller since this hook replaced it, and a tested dead hook reads as a live
 * one.)
 */

import { useEffect, useMemo, useState } from 'react';

import { fetchBountyGuidance } from '../api/bountyGuidanceApi';
import {
  recommendBounty,
  type BountyGuidance,
  type BountyRecommendation,
} from '../lib/bountyRecommendation';

const EMPTY: BountyGuidance = { rungs: [], local: null };

export interface UseBountyGuidanceResult {
  guidance: BountyGuidance;
  /** Null when there is nothing honest to say — render no guidance at all. */
  recommendation: BountyRecommendation | null;
}

export function useBountyGuidance(
  latitude: number | null,
  longitude: number | null,
): UseBountyGuidanceResult {
  const [guidance, setGuidance] = useState<BountyGuidance>(EMPTY);

  useEffect(() => {
    if (latitude === null || longitude === null) {
      return; // the location step has not resolved yet
    }
    let cancelled = false;
    // Every write happens after the await, so this never trips
    // react-hooks/set-state-in-effect.
    void fetchBountyGuidance(latitude, longitude).then((next) => {
      if (!cancelled) setGuidance(next);
    });
    return () => {
      cancelled = true;
    };
    // The RPC snaps the caller's point to a ~1km grid, so re-fetching on a
    // small coordinate change would spend a request to receive the identical
    // answer. The location step settles once, which is when this runs.
  }, [latitude, longitude]);

  const recommendation = useMemo(() => recommendBounty(guidance), [guidance]);

  return { guidance, recommendation };
}
