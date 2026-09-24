/**
 * WHAT:  Supabase access for "My Listings" — the list_my_posts RPC, zod-validated
 *        and mapped to MyPostSummary card rows (a PostSummary plus the owner's
 *        archive stamp, archivedAt). Returns the caller's OWN posts in every
 *        status (draft → recovered), newest first, archived ones included.
 * WHY:   The owner needs to see their listings incl. private states (drafts,
 *        pending) the public feed never shows; the RPC applies the owner scope
 *        (auth.uid()) server-side and this file only validates + renames, so a
 *        shape drift fails loudly instead of rendering garbage. Loads log
 *        [vehicles], ids only — never plates (docs/LOGGING.md).
 * LINKS: supabase/migrations/…_list_my_posts.sql (the RPC) +
 *        20260924130000_archive_listings.sql (adds archived_at);
 *        src/features/vehicles/hooks/useMyPosts.ts (consumer);
 *        src/features/watchlist/api/watchlistApi.ts (the mapping this mirrors);
 *        src/shared/types/posts.ts (PostSummary).
 */

import { z } from 'zod';

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';
import type { PostStatus, PostSummary } from '@/shared/types';

const log = createLogger('vehicles');

// The owner sees their post in ANY lifecycle state, so the row status spans the
// full post_status enum (unlike the public feed's active-only rows).
const myPostRowSchema = z.object({
  id: z.guid(),
  make: z.string(),
  model: z.string(),
  colour: z.string(),
  plate: z.string().nullable(),
  status: z.enum([
    'draft',
    'pending_verification',
    'active',
    'recovery_claimed',
    'recovered',
    'recovered_no_spotter',
    'cancelled',
    'expired',
    'rejected',
  ]),
  // First (cover) photo pre-shaped by the RPC as a one-element array, or [].
  photos: z.array(z.object({ url: z.string() })),
  last_seen_at: z.string().nullable(),
  last_seen_area: z.string().nullable(),
  bounty_amount_pence: z.number().int().nullable(),
  created_at: z.string(),
  // When the owner archived it, or null. OPTIONAL as well as nullable: an app
  // update can reach phones before the server migration that adds the column
  // (20260924130000), and a missing field must read as "not archived" rather
  // than fail the whole list.
  archived_at: z.string().nullable().optional(),
});

type MyPostRow = z.infer<typeof myPostRowSchema>;

/** One of the caller's own listings — a card, plus whether it is archived. */
export type MyPostSummary = PostSummary & {
  /** When the owner archived it (it then sits in the "Archived" section), or null. */
  archivedAt: string | null;
};

function toSummary(row: MyPostRow): MyPostSummary {
  return {
    archivedAt: row.archived_at ?? null,
    id: row.id,
    photos: row.photos.map((p) => ({ uri: p.url })),
    make: row.make,
    model: row.model,
    colour: row.colour,
    plate: row.plate,
    status: row.status as PostStatus,
    // A draft with no sighting time yet reads from its creation time (the same
    // fallback the feed/watchlist use).
    lastSeenAt: row.last_seen_at ?? row.created_at,
    lastSeenArea: row.last_seen_area ?? undefined,
    // PRESERVE the null (ADR-0014). This read `?? 0` until 2026-08-20, back
    // when a null could only mean "column absent from this projection". Now a
    // null is real data — a no-reward listing — and coercing it to 0 would print
    // "£0 bounty" on the owner's own card. BountyTag decides what null looks
    // like; this layer must not decide it here by accident.
    bountyPence: row.bounty_amount_pence,
  };
}

/** The caller's own posts, newest first (RPC-ordered). */
export async function listMyPosts(): Promise<MyPostSummary[]> {
  const startedAt = Date.now();
  const { data, error } = await supabase.rpc('list_my_posts');
  if (error) {
    log.error('my_posts_load failed', { code: error.code });
    throw error;
  }
  const rows = z.array(myPostRowSchema).parse(data ?? []);
  const posts = rows.map(toSummary);
  log.info('my_posts_load', { count: posts.length, durationMs: Date.now() - startedAt });
  return posts;
}
