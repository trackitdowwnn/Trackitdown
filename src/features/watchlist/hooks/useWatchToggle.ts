/**
 * WHAT:  useWatchToggle — one post's watch state + the toggle action:
 *        gate-aware (guests → AuthSheet, continuation completes the watch),
 *        optimistic (flip now, revert + error Toast on failure), quiet on
 *        removal, "Added to your watchlist" Toast with a View action on add.
 * WHY:   The toggle is the feature's whole surface-level API — every
 *        call site (feed card, map peek card, detail header) gets identical
 *        behaviour from this one hook. The gate conversion is logged
 *        distinctly: a guest completing a watch through the sheet is one of
 *        our best conversion signals.
 * LINKS: src/features/watchlist/lib/watchedStore.ts (shared live state);
 *        src/features/auth (useRequireAuth intent continuation);
 *        docs/LOGGING.md ([watchlist] events).
 */

import { useCallback, useEffect } from 'react';

import { useRequireAuth, useSession } from '@/features/auth';
import { createLogger } from '@/shared/lib/logger';
import { useToast } from '@/shared/ui';

import { addWatch, fetchWatchedPostIds, removeWatch } from '../api/watchlistApi';
import { getMruTarget, hydrateMruCollection, setMruCollection } from '../lib/mruCollection';
import { requestCollectionPicker } from '../lib/pickerIntent';
import {
  ensureWatchedHydrated,
  isWatchedNow,
  markUserToggled,
  setWatched,
  useIsWatched,
} from '../lib/watchedStore';
import type { CollectionId, WatchToggleSource } from '../types';

const log = createLogger('watchlist');

// Per-post op serialisation: a rapid on→off must send insert THEN delete —
// unserialised, the delete can win the race and leave the server watched
// while the UI shows unwatched (code review 2026-07-22). Ops queue behind
// the previous op for the same post regardless of its outcome.
const opChains = new Map<string, Promise<unknown>>();
// Generic in the op's result so a caller can read what the write actually did
// (addWatch reports the collection it LANDED in, which may not be the one asked
// for). The chain itself stays Promise<unknown> — ops of different result types
// queue behind each other for the same post.
function enqueueOp<T>(postId: string, op: () => Promise<T>): Promise<T> {
  const prev = opChains.get(postId) ?? Promise.resolve();
  const next = prev.then(op, op);
  opChains.set(postId, next);
  // Evict once settled (only if still the tail — a newer op may have queued),
  // so the map doesn't grow one entry per post ever toggled. then(f, f), not
  // finally: the eviction branch must swallow the rejection the CALLER
  // handles, never re-raise it as an unhandled rejection.
  const evict = () => {
    if (opChains.get(postId) === next) {
      opChains.delete(postId);
    }
  };
  next.then(evict, evict);
  return next;
}

export interface UseWatchToggleResult {
  watched: boolean;
  /** Gate-aware toggle — safe to call as a guest. */
  toggle: () => void;
}

export function useWatchToggle(postId: string, source: WatchToggleSource): UseWatchToggleResult {
  const watched = useIsWatched(postId);
  const requireAuth = useRequireAuth();
  const session = useSession();
  const toast = useToast();

  // Keep the live store aligned with the session: hydrate for a member,
  // clear for a guest. Cheap (ids only) and deduped inside the store.
  const userId = session.status === 'signedIn' ? session.userId : null;
  useEffect(() => {
    if (session.status === 'loading') {
      return;
    }
    void ensureWatchedHydrated(userId, fetchWatchedPostIds);
    // Restore which list this user was last filing into, so the FIRST save of
    // a session lands where they left off rather than in Saved.
    void hydrateMruCollection(userId);
  }, [session.status, userId]);

  const performToggle = useCallback(
    (viaGate: boolean) => {
      // Read membership at RUN time — the continuation may execute long
      // after the tap (post-auth); a render-captured `watched` would be stale.
      const next = !isWatchedNow(postId);
      // Optimistic: every rendered toggle for this post flips instantly.
      // The user-toggle mark drives the pop (hydration flips never animate).
      markUserToggled(postId);
      setWatched(postId, next);
      log.info('watch_toggle', { postId, watched: next, source });
      if (viaGate) {
        // A guest just became a member to complete THIS action.
        log.info('watch_gate_conversion', { postId, source });
      }
      // Where this save should go: the list the user most recently filed
      // something in. Read synchronously — an await here would race the
      // optimistic flip above, and the toast below needs it NOW.
      const mru = getMruTarget(userId);
      const target = mru?.id ?? null;
      if (next) {
        // "Change", not "View": the save has already happened, and the useful
        // offer at this moment is to re-file it, not to navigate away. Name the
        // list when we know it — that is how someone notices a car went
        // somewhere they didn't expect. Without a name we say nothing rather
        // than guess.
        toast.show(mru?.name ? `Saved to ${mru.name}` : 'Added to your watchlist', 'success', {
          label: 'Change',
          onPress: () =>
            requestCollectionPicker({
              postId,
              currentCollectionId: target,
              source: 'save_toast',
            }),
        });
      }
      // Explicit type argument: inference over the add/remove union widens to
      // `void | null` and drops the collection add resolves with.
      void enqueueOp<CollectionId | void>(postId, () =>
        next ? addWatch(postId, target) : removeWatch(postId),
      )
        .then((landed) => {
          // Record where it ACTUALLY landed, not where we aimed. On the
          // stale-collection fallback those differ, and this one rule then
          // clears the dead target for free — no separate invalidation path.
          if (next && userId !== null) {
            setMruCollection(userId, landed ?? null);
          }
        })
        .catch(() => {
          // Revert ONLY if the user hasn't toggled again since — a stale
          // failure must never clobber a newer state.
          if (isWatchedNow(postId) === next) {
            setWatched(postId, !next);
          }
          toast.show(
            next ? "Couldn't add to your watchlist — try again." : "Couldn't remove — try again.",
            'error',
          );
        });
    },
    [postId, source, toast, userId],
  );

  const toggle = useCallback(() => {
    const wasGuest = session.status !== 'signedIn';
    requireAuth({
      context: 'watch_post',
      // Continuation: runs immediately for members, post-auth for guests —
      // the bookmark fills without a second tap.
      run: () => performToggle(wasGuest),
    });
  }, [requireAuth, performToggle, session.status]);

  return { watched, toggle };
}
