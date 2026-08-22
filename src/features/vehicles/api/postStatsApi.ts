/**
 * WHAT:  fetchPostStats — the one read behind the per-listing stats screen.
 *        Calls get_post_stats and validates its payload.
 * WHY:   Every figure is aggregated SERVER-SIDE and arrives as a number, so
 *        this file receives counts and never rows: no watcher list, no spotter
 *        list, no push ledger. That is the RPC's security posture and this
 *        schema is where it is enforced on our side — `.strict()` means an RPC
 *        that grows a field fails loudly HERE, in one place, rather than
 *        quietly handing the UI something it was never meant to render.
 *
 *        `null` is a real answer, not an error: the RPC returns it for a post
 *        the caller does not own AND for a post that does not exist, on
 *        purpose, so neither can be probed. Callers render "not found".
 * LINKS: supabase/migrations/20260807130000_post_stats.sql (the RPC, its
 *          ownership gate and why the shape is counts-only);
 *        src/features/vehicles/hooks/usePostStats.ts (the only caller);
 *        src/features/sightings/api/sightingApi.ts (the pattern).
 */

import { z } from 'zod';

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

const log = createLogger('vehicles');

/** One day that HAS sightings. The series is sparse by design — the server
 *  sends only non-empty days and the chart fills the gaps, because the chart
 *  is the side that knows how wide it is. */
const dayRowSchema = z
  .object({
    day: z.string(),
    count: z.number().int().nonnegative(),
  })
  .strict();

const postStatsSchema = z
  .object({
    spotters_alerted: z.number().int().nonnegative(),
    created_at: z.string(),
    expires_at: z.string().nullable(),
    sightings_total: z.number().int().nonnegative(),
    sightings_unverified: z.number().int().nonnegative(),
    sightings_helpful: z.number().int().nonnegative(),
    sightings_credited: z.number().int().nonnegative(),
    // ⚠️ ADDED 2026-08-22, and its absence is what the `.strict()` above was
    // for — get_post_stats has returned this since 20260814140000 and this
    // schema did not know it, so the owner's stats screen threw. The guard
    // worked; the repo simply did not have the migration that widened the RPC.
    //
    // It exists because without it the other three buckets stopped summing to
    // sightings_total the moment 'not_mine' did, and a page whose own numbers
    // disagree teaches a reader to trust none of them.
    sightings_not_mine: z.number().int().nonnegative(),
    first_sighting_at: z.string().nullable(),
    last_sighting_at: z.string().nullable(),
    sightings_by_day: z.array(dayRowSchema),
    conversations: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
  })
  .strict();

/** A day bucket, camelCased for the app side. */
export interface PostStatsDay {
  /** ISO date (UTC calendar day). */
  day: string;
  count: number;
}

export interface PostStats {
  /** Distinct spotters the alert reached. FLOORED to 0 below 5 by the RPC —
   *  0 means "nobody, or too few to report", never a precise nobody. */
  spottersAlerted: number;
  createdAt: string;
  /** Null on a post that has never gone live — drafts carry no clock. */
  expiresAt: string | null;
  sightingsTotal: number;
  sightingsUnverified: number;
  sightingsHelpful: number;
  sightingsCredited: number;
  /** The owner's own "that isn't my car" verdicts. Present so the four buckets
   *  sum to sightingsTotal — they stopped doing so the moment not_mine existed,
   *  and a page whose own numbers disagree teaches a reader to trust none of
   *  them. */
  sightingsNotMine: number;
  firstSightingAt: string | null;
  lastSightingAt: string | null;
  /** Sparse, oldest first: only days that have at least one sighting. */
  sightingsByDay: PostStatsDay[];
  conversations: number;
  messages: number;
}

/** Stats for one of the CALLER'S OWN posts, or null if it isn't theirs. */
export async function fetchPostStats(postId: string): Promise<PostStats | null> {
  const { data, error } = await supabase.rpc('get_post_stats', { p_post_id: postId });
  if (error) {
    log.warn('post_stats_load_failed', { code: error.code });
    throw new Error(error.message);
  }
  // Not an error — see the header. The server deliberately cannot tell us
  // whether the post is someone else's or absent, and neither can we.
  if (data === null) {
    return null;
  }
  const row = postStatsSchema.parse(data);
  return {
    spottersAlerted: row.spotters_alerted,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    sightingsTotal: row.sightings_total,
    sightingsUnverified: row.sightings_unverified,
    sightingsHelpful: row.sightings_helpful,
    sightingsCredited: row.sightings_credited,
    sightingsNotMine: row.sightings_not_mine,
    firstSightingAt: row.first_sighting_at,
    lastSightingAt: row.last_sighting_at,
    sightingsByDay: row.sightings_by_day,
    conversations: row.conversations,
    messages: row.messages,
  };
}
