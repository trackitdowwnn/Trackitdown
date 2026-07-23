/**
 * WHAT:  watchedStore — the live set of post ids the current user watches:
 *        a module-level store (useSyncExternalStore) hydrated once per user
 *        from the server, flipped optimistically by toggles, cleared when
 *        the user changes.
 * WHY:   The toggle renders on MANY surfaces at once (feed cards, map peek
 *        cards, post detail) — every instance must agree instantly when any
 *        one flips, without prop-drilling or refetching per card. Same
 *        live-store pattern as useOnboardingGate / the startup-grant store.
 * LINKS: src/features/watchlist/api/watchlistApi.ts (hydration read);
 *        src/features/watchlist/hooks/useWatchToggle.ts (consumer).
 */

import { useSyncExternalStore } from 'react';

import { createLogger } from '@/shared/lib/logger';

const log = createLogger('watchlist');

const watchedIds = new Set<string>();
// Which user the set belongs to; a different user (or sign-out) invalidates.
let hydratedForUser: string | null = null;
// Generation counter: every hydration attempt (and every guest clear) bumps
// it, and a fetch only lands if its generation is still current — a user
// switch mid-flight discards the stale user's ids instead of leaking them
// to the next account (security review 2026-07-22).
let hydrationGeneration = 0;
let hydrationInFlight = false;
// Toggles made WHILE a hydration fetch is in flight: the fetched snapshot
// predates them, so they re-apply over it — a tap during cold-start
// hydration must never visually undo itself (code review 2026-07-22).
const pendingOps = new Map<string, boolean>();
// Posts the USER just toggled (vs hydration flips) — drives the pop
// animation/haptic so a hydration landing never makes every watched card
// on screen pop at once.
const userToggled = new Set<string>();

const subscribers = new Set<() => void>();
function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
function notify(): void {
  subscribers.forEach((cb) => cb());
}

/** Live membership for one post id. */
export function useIsWatched(postId: string): boolean {
  return useSyncExternalStore(subscribe, () => watchedIds.has(postId));
}

/** Non-reactive read at RUN time — for continuations that may execute long
 *  after the tap (post-auth), where a render-captured value would be stale. */
export function isWatchedNow(postId: string): boolean {
  return watchedIds.has(postId);
}

/** Optimistic flip — the caller owns persisting (and reverting on failure). */
export function setWatched(postId: string, watched: boolean): void {
  if (hydrationInFlight) {
    pendingOps.set(postId, watched);
  }
  if (watched) {
    watchedIds.add(postId);
  } else {
    watchedIds.delete(postId);
  }
  notify();
}

/** Mark a flip as user-initiated (incl. gate continuations) — the toggle's
 *  pop consumes this so hydration flips never animate. */
export function markUserToggled(postId: string): void {
  userToggled.add(postId);
}

/** True once per user-initiated flip; consuming clears the mark. */
export function consumeUserToggled(postId: string): boolean {
  return userToggled.delete(postId);
}

/**
 * Hydrate the set for a user (no-op while already hydrated for them, or
 * mid-flight). Guests (null userId) clear the set — nothing is watched.
 */
export async function ensureWatchedHydrated(
  userId: string | null,
  fetchIds: () => Promise<string[]>,
): Promise<void> {
  if (userId === null) {
    hydrationGeneration += 1; // invalidate any in-flight fetch
    hydrationInFlight = false;
    pendingOps.clear();
    if (hydratedForUser !== null || watchedIds.size > 0) {
      watchedIds.clear();
      hydratedForUser = null;
      notify();
    }
    return;
  }
  if (hydratedForUser === userId) {
    return;
  }
  const generation = ++hydrationGeneration;
  hydrationInFlight = true;
  try {
    const ids = await fetchIds();
    if (generation !== hydrationGeneration) {
      return; // a different user (or sign-out) superseded this fetch
    }
    watchedIds.clear();
    ids.forEach((id) => watchedIds.add(id));
    // The snapshot predates any toggle made during the flight — the user's
    // taps win over the fetch.
    pendingOps.forEach((watched, id) => {
      if (watched) {
        watchedIds.add(id);
      } else {
        watchedIds.delete(id);
      }
    });
    pendingOps.clear();
    hydratedForUser = userId;
    notify();
  } catch {
    // Hydration is best-effort: toggles still work optimistically; a later
    // mount retries. Never crash a card over it.
    log.warn('watched_hydration failed');
  } finally {
    if (generation === hydrationGeneration) {
      hydrationInFlight = false;
    }
  }
}

/** Test-only reset. */
export function resetWatchedStoreForTests(): void {
  watchedIds.clear();
  hydratedForUser = null;
  hydrationGeneration += 1;
  hydrationInFlight = false;
  pendingOps.clear();
  userToggled.clear();
  notify();
}
