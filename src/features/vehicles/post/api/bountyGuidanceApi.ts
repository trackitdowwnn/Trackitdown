/**
 * WHAT:  The two calls behind bounty guidance — read the reach curve and the
 *        local band (get_bounty_guidance), and record what was SHOWN against
 *        what was CHOSEN (log_bounty_recommendation).
 * WHY:   The recommendation is built from distribution facts because those are
 *        the only inputs we hold. The input we would MOST like — "what bounty
 *        levels actually led to a confirmed sighting" — is computable from the
 *        schema, but useless without knowing what we ADVISED: otherwise a
 *        future analysis cannot separate "high bounties recover cars" from "we
 *        told people to set high bounties". The log is that missing half.
 *
 *        BOTH ARE NON-FATAL BY DESIGN. This is a supporting line under a slider
 *        on a screen someone reached hours after their car was stolen; a
 *        failure hides the guidance or drops one analytics row, and never
 *        interrupts posting.
 * LINKS: supabase/migrations/20260813100000_bounty_guidance.sql (the RPC, its
 *          floor of 5 per rung, and the grid snap on the caller's point);
 *        supabase/migrations/20260813110000_bounty_recommendation_log.sql
 *          (log_bounty_recommendation — silent on refusal, and why);
 *        ../lib/bountyRecommendation.ts (the pure function this feeds);
 *        src/features/notifications/api/alertsApi.ts (fetchAlertReach — the
 *          single-point sibling this generalises).
 */

import { z } from 'zod';

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

import type { BountyGuidance, BountyRecommendation } from '../lib/bountyRecommendation';

const log = createLogger('vehicles');

const guidanceSchema = z.object({
  rungs: z.array(
    z.object({
      bounty_pence: z.number().int().nonnegative(),
      reach: z.number().int().nonnegative(),
    }),
  ),
  local: z
    .object({
      p25_pence: z.number().int().nonnegative(),
      median_pence: z.number().int().nonnegative(),
      p75_pence: z.number().int().nonnegative(),
      sample: z.number().int().nonnegative(),
    })
    .nullable(),
});

/**
 * The reach curve and the local band for a point, in one round trip.
 *
 * Returns an EMPTY curve with no local band on any failure, which
 * recommendBounty turns into "no guidance". That is the same answer as a quiet
 * area, and the right one: a supporting line that cannot be computed should
 * disappear, not error.
 */
const EMPTY: BountyGuidance = { rungs: [], local: null };

/**
 * Answers kept per point, and lookups in flight (2026-10-08). The map step
 * warms this the moment its pin settles, several screens before the reward
 * step, so the guidance is simply THERE when that step slides in rather than
 * popping in above the slider a beat later — and the post's own analytics
 * line (PostACarScreen) reuses it instead of asking again. Keyed to ~100m,
 * finer than the RPC's own ~1km grid, so two keys can share an answer but one
 * key never stands for two. A failure is not kept: the next ask tries again.
 */
const cache = new Map<string, Promise<BountyGuidance>>();
const settled = new Map<string, BountyGuidance>();
const CACHE_SIZE = 10;

function cacheKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
}

/** The guidance for a point if it has already arrived — synchronously, so a
 *  step can start from it. Undefined while unknown or in flight. */
export function peekBountyGuidance(latitude: number, longitude: number): BountyGuidance | undefined {
  return settled.get(cacheKey(latitude, longitude));
}

/** Start the lookup for a point the owner is about to reach the reward with. */
export function warmBountyGuidance(latitude: number, longitude: number): void {
  void fetchBountyGuidance(latitude, longitude);
}

/** Test-only: forget every remembered answer. */
export function resetBountyGuidanceCache(): void {
  cache.clear();
  settled.clear();
}

export function fetchBountyGuidance(latitude: number, longitude: number): Promise<BountyGuidance> {
  const key = cacheKey(latitude, longitude);
  const known = cache.get(key);
  if (known) {
    return known;
  }
  const request = requestGuidance(latitude, longitude).then((guidance) => {
    if (guidance === null) {
      cache.delete(key); // failed: ask again next time
      return EMPTY;
    }
    settled.set(key, guidance);
    return guidance;
  });
  cache.set(key, request);
  if (cache.size > CACHE_SIZE) {
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
    settled.delete(oldest);
  }
  return request;
}

/**
 * One RPC round trip; null when it failed (already logged). Never throws —
 * not even synchronously: it is now started from the map step's pin settle
 * (warmBountyGuidance), where an escaped error would be an unhandled
 * rejection in the middle of choosing a location.
 */
async function requestGuidance(latitude: number, longitude: number): Promise<BountyGuidance | null> {
  let response: { data: unknown; error: { code?: string } | null };
  try {
    response = await supabase.rpc('get_bounty_guidance', { p_lat: latitude, p_lng: longitude });
  } catch {
    log.warn('bounty_guidance_failed', { code: 'NETWORK' });
    return null;
  }
  const { data, error } = response;
  if (error) {
    log.warn('bounty_guidance_failed', { code: error.code });
    return null;
  }

  const parsed = guidanceSchema.safeParse(data);
  if (!parsed.success) {
    log.warn('bounty_guidance_parse_failed');
    return null;
  }

  return {
    rungs: parsed.data.rungs.map((r) => ({ bountyPence: r.bounty_pence, reach: r.reach })),
    local: parsed.data.local
      ? {
          p25Pence: parsed.data.local.p25_pence,
          medianPence: parsed.data.local.median_pence,
          p75Pence: parsed.data.local.p75_pence,
          sample: parsed.data.local.sample,
        }
      : null,
  };
}

/**
 * Record the range that was SHOWN against the amount that was SET.
 *
 * ⚠️ FIRE-AND-FORGET, and it must stay that way. It runs on the post-creation
 * SUCCESS path, immediately after someone has paid; nothing it does may ever
 * surface to them. The RPC is built for exactly this — it returns SILENTLY when
 * the caller does not own the post (an error there would make an analytics
 * endpoint into an ownership oracle) and discards out-of-range values rather
 * than raising.
 *
 * A NULL recommendation is still worth logging: those rows are the CONTROL
 * GROUP. Someone who was shown nothing and chose £250 anyway is exactly the
 * comparison a future recommender needs.
 */
export function logBountyRecommendation(
  postId: string,
  chosenPence: number,
  shown: BountyRecommendation | null,
  localSample: number | null,
): void {
  // The try/catch is NOT redundant with the .catch(): a synchronous throw from
  // rpc() (a misconfigured client) creates no promise, so .catch() is never
  // attached and the error would propagate into a screen that has just taken
  // someone's money.
  try {
    void supabase
      .rpc('log_bounty_recommendation', {
        p_post_id: postId,
        p_chosen_pence: chosenPence,
        p_shown_low_pence: shown?.lowPence ?? null,
        p_shown_high_pence: shown?.highPence ?? null,
        p_shown_mid_pence: shown?.midPence ?? null,
        p_shown_basis: shown?.basis ?? null,
        p_local_sample: localSample,
      })
      .then(
        ({ error }) => {
          if (error) log.warn('bounty_recommendation_log_failed', { code: error.code });
        },
        () => {
          // Offline. Silent by design — this is analytics, not the post.
          //
          // The REJECTION HANDLER of .then, not a trailing .catch: supabase-js
          // returns a PromiseLike here, which has no .catch to chain onto.
        },
      );
  } catch {
    log.warn('bounty_recommendation_log_failed', {});
  }
}
