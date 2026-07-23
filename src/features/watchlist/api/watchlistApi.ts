/**
 * WHAT:  Supabase access for the watchlist — plain insert/delete on
 *        watchlist_items (a watch is private user preference, not domain
 *        state) and the get_my_watchlist RPC, zod-validated and mapped to
 *        the WatchlistEntry union (full posts vs tombstones).
 * WHY:   The RPC applies the visibility/tombstone/30-day rules SERVER-side
 *        (the approved DOMAIN carve-out) — this file only validates and
 *        renames, so a shape drift fails loudly instead of rendering
 *        garbage. Loads are logged [watchlist], ids only — never plates.
 * LINKS: supabase/migrations/20260722100000_watchlist.sql (table + RPC +
 *        SAFETY notes); src/features/watchlist/types.ts; docs/LOGGING.md.
 */

import { z } from 'zod';

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';
import type { PostStatus } from '@/shared/types';

import type { WatchlistEntry } from '../types';

const log = createLogger('watchlist');

// Full rows carry active/recovered statuses; tombstones carry the closed
// states the public can't read. Anything else failing validation is the
// server-side visibility matrix leaking — fail loudly.
const watchRowSchema = z.object({
  id: z.guid(),
  watched_at: z.string(),
  status: z.enum(['active', 'recovered', 'recovered_no_spotter', 'expired', 'cancelled']),
  make: z.string(),
  model: z.string(),
  colour: z.string(),
  thumbnail_url: z.string().nullable(),
  resolved_at: z.string().nullable(),
  // Nulled on tombstones by the RPC (SAFETY: a tombstone exposes less than
  // the post's active-era public payload).
  plate: z.string().nullable(),
  bounty_amount_pence: z.number().int().nullable(),
  last_seen_at: z.string().nullable(),
  last_seen_area: z.string().nullable(),
  distance_miles: z.number().nullable(),
  created_at: z.string().nullable(),
});

type WatchRow = z.infer<typeof watchRowSchema>;

function toEntry(row: WatchRow): WatchlistEntry {
  if (row.status === 'expired' || row.status === 'cancelled') {
    return {
      kind: 'tombstone',
      watchedAt: row.watched_at,
      postId: row.id,
      status: row.status as PostStatus,
      make: row.make,
      model: row.model,
      colour: row.colour,
      // The RPC guarantees resolved_at on closed rows; watched_at is a
      // defensive fallback that can only move the drop-off EARLIER.
      resolvedAt: row.resolved_at ?? row.watched_at,
      thumbnailUrl: row.thumbnail_url,
    };
  }
  // Full rows come from home_feed_post_json, which always carries the post's
  // created_at — its absence is server drift, so fail as loudly as a schema
  // break rather than fabricating a "last seen" from the watch time.
  if (row.created_at == null) {
    throw new Error(`watchlist full row missing created_at (post ${row.id})`);
  }
  return {
    kind: 'post',
    watchedAt: row.watched_at,
    post: {
      id: row.id,
      photos: row.thumbnail_url ? [{ uri: row.thumbnail_url }] : [],
      make: row.make,
      model: row.model,
      colour: row.colour,
      plate: row.plate,
      status: row.status as PostStatus,
      // Same fallback the home feed uses (feedApi.toPostSummary): a post
      // with no sighting yet reads from its creation time.
      lastSeenAt: row.last_seen_at ?? row.created_at,
      lastSeenArea: row.last_seen_area ?? undefined,
      distanceMiles: row.distance_miles ?? undefined,
      bountyPence: row.bounty_amount_pence ?? 0,
    },
  };
}

/** The caller's watchlist, newest watch first (RPC-ordered). */
export async function fetchWatchlist(): Promise<WatchlistEntry[]> {
  const startedAt = Date.now();
  const { data, error } = await supabase.rpc('get_my_watchlist');
  if (error) {
    log.error('watchlist_load failed', { code: error.code });
    throw error;
  }
  const rows = z.array(watchRowSchema).parse(data ?? []);
  const entries = rows.map(toEntry);
  log.info('watchlist_load', { count: entries.length, durationMs: Date.now() - startedAt });
  return entries;
}

/** Just the watched post ids — hydrates the live toggle store cheaply. */
export async function fetchWatchedPostIds(): Promise<string[]> {
  const { data, error } = await supabase.from('watchlist_items').select('post_id');
  if (error) {
    log.error('watched_ids_load failed', { code: error.code });
    throw error;
  }
  return (data ?? []).map((row) => row.post_id as string);
}

/** Insert a watch. RLS pins user_id to the caller and requires the post to
 *  be visible (see-before-act) — a rejected insert throws. */
export async function addWatch(postId: string): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) {
    throw new Error('addWatch requires a session (the gate guarantees one)');
  }
  const { error } = await supabase
    .from('watchlist_items')
    .insert({ user_id: userId, post_id: postId });
  // A duplicate (unique-pair) insert means we're already watching — treat
  // as success so a double-tap can't surface a spurious error.
  if (error && error.code !== '23505') {
    throw error;
  }
}

/** Delete a watch. RLS scopes the delete to the caller's own rows. */
export async function removeWatch(postId: string): Promise<void> {
  const { error } = await supabase.from('watchlist_items').delete().eq('post_id', postId);
  if (error) {
    throw error;
  }
}
