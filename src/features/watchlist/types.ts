/**
 * WHAT:  Watchlist domain types — a watched post as returned by the
 *        get_my_watchlist RPC: full rows for visible posts, tombstones
 *        (nulled sensitive fields) for resolved posts the watcher can no
 *        longer read, both within the 30-day post-transition window.
 * WHY:   One discriminated shape keeps the screen honest about what it may
 *        render: a tombstone HAS no location/plate/bounty by design (the
 *        approved DOMAIN carve-out exposes less than an active post did).
 * LINKS: src/features/watchlist/README.md; supabase migration
 *        (watchlist_items + get_my_watchlist); docs/DOMAIN.md
 *        (recovered-visibility window).
 */

import type { PostSummary } from '@/shared/types';

/**
 * Which named list a saved post is filed in. `null` is the implicit "Saved"
 * bucket — NOT a real collection: it has no row, no name of its own, and cannot
 * be renamed or deleted. Every watch made before collections existed is null,
 * which is why the column is nullable and why there was no backfill.
 *
 * A post is in AT MOST ONE collection (the (user_id, post_id) primary key
 * enforces it). Collections are a filing system, not tags.
 */
export type CollectionId = string | null;

/** A visible watched post: the standard card payload + watch metadata. */
export interface WatchedPost {
  kind: 'post';
  /** When the user watched it — the list's sort key (desc). */
  watchedAt: string;
  collectionId: CollectionId;
  post: PostSummary;
}

/** A resolved post the watcher can no longer read — minimal, by design. */
export interface WatchedTombstone {
  kind: 'tombstone';
  watchedAt: string;
  /** A closed car keeps its filing, so it still shows in its own list's
   *  "No longer active" section rather than jumping back to Saved. */
  collectionId: CollectionId;
  postId: string;
  status: PostSummary['status'];
  make: string;
  model: string;
  colour: string;
  /** When the post left its previous state (drives the 30-day drop). */
  resolvedAt: string;
  thumbnailUrl: string | null;
}

export type WatchlistEntry = WatchedPost | WatchedTombstone;

/** One of the user's named lists. PRIVATE: the name is free text they wrote and
 *  never leaves their own session — never logged, never shared (DOMAIN.md). */
export interface WatchlistCollection {
  id: string;
  name: string;
  createdAt: string;
}

/** Server-enforced in create_watchlist_collection; mirrored here so the client
 *  can explain the limit instead of failing on submit. */
export const MAX_COLLECTIONS = 20;

/** Where a toggle happened — the logging dimension. */
export type WatchToggleSource = 'feed' | 'detail' | 'map' | 'watchlist';
