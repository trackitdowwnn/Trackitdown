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

/** A visible watched post: the standard card payload + watch metadata. */
export interface WatchedPost {
  kind: 'post';
  /** When the user watched it — the list's sort key (desc). */
  watchedAt: string;
  post: PostSummary;
}

/** A resolved post the watcher can no longer read — minimal, by design. */
export interface WatchedTombstone {
  kind: 'tombstone';
  watchedAt: string;
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

/** Where a toggle happened — the logging dimension. */
export type WatchToggleSource = 'feed' | 'detail' | 'map' | 'watchlist';
