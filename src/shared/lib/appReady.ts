/**
 * WHAT:  appReady — "the first screen has real content on it". Set once per
 *        app launch by the home feed when its first load settles; read by the
 *        gate, which holds the brand splash until then.
 * WHY:   A cold start used to show the native splash, a black gap while fonts
 *        loaded, the brand splash, and then the feed assembling itself in
 *        public. Holding one steady screen until there is something to show
 *        replaces four transitions with one.
 *
 *        SETTLED, not succeeded. An error marks ready too: a user who is
 *        offline must reach the feed's error state, not sit on a splash
 *        forever. The gate additionally caps how long it will wait at all, so
 *        a request that never settles cannot wedge the app — between the two,
 *        every path reaches the app.
 *
 *        Module-level store + subscriber Set + useSyncExternalStore is the
 *        house convention for cross-feature state (gateIntent, savedCarSignal,
 *        watchedStore). It lives in shared/ because the publisher
 *        (features/search-map) and the reader (features/auth) must not import
 *        each other.
 * LINKS: src/features/search-map/hooks/useHomeFeed.ts (the only publisher);
 *        src/features/auth/components/AuthGate.tsx (the reader);
 *        src/features/auth/components/BrandSplash.tsx.
 */

import { useSyncExternalStore } from 'react';

let contentReady = false;
const subscribers = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

function getSnapshot(): boolean {
  return contentReady;
}

/**
 * Report that the first screen has something to show. Idempotent, and
 * deliberately one-way: this is about the FIRST paint of a launch, so a later
 * refetch must not re-raise the splash.
 */
export function markContentReady(): void {
  if (contentReady) {
    return;
  }
  contentReady = true;
  subscribers.forEach((cb) => cb());
}

/** Non-reactive read, for callers outside a component. */
export function isContentReady(): boolean {
  return contentReady;
}

export function useContentReady(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Test seam — module state outlives a single test file otherwise. */
export function resetContentReadyForTests(): void {
  contentReady = false;
}
