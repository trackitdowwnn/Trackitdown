/**
 * WHAT:  The "does this user have a saved car?" cache — a module-level count
 *        keyed by user id, with a subscriber set so every surface sees the same
 *        answer. Holds state only; the fetching lives in useHasSavedCar.
 * WHY:   Two nudge surfaces need this answer (the Explore card and the Profile
 *        row hint), and both sit on screens that must NOT pay for a garage fetch
 *        per mount — Explore is the app's hottest screen and useMyVehicles also
 *        revalidates on every refocus. Caching the count once per user per app
 *        session makes the nudges effectively free, and /my-cars primes it for
 *        nothing (useMyVehicles publishes what it already loaded).
 *
 *        Module-level store + subscriber Set + useSyncExternalStore is the house
 *        convention for cross-instance state (invalidateMyProfile,
 *        invalidateProfileCheck, gateIntent).
 *
 *        SAFETY: the count is stored WITH its user id and never returned for a
 *        different one. A saved car is a number plate, so showing user A's
 *        answer to user B is a privacy bug, not a cosmetic one.
 * LINKS: src/features/garage/hooks/useHasSavedCar.ts (the only reader);
 *        src/features/garage/hooks/useMyVehicles.ts (primes it);
 *        src/features/garage/api/garageApi.ts (invalidates it on every write).
 */

interface SavedCarCount {
  userId: string;
  count: number;
}

let cached: SavedCarCount | null = null;
const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((cb) => cb());
}

export function subscribeToSavedCarSignal(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function getSavedCarSnapshot(): SavedCarCount | null {
  return cached;
}

/**
 * Record how many cars a user has. Called by anything that already knows —
 * today useMyVehicles, after a successful load.
 *
 * No-ops when nothing changed: useMyVehicles revalidates on every refocus, so
 * without this guard every return to /my-cars would wake every subscriber and
 * re-render the Profile row and the feed header for an identical answer.
 */
export function publishSavedCarCount(userId: string, count: number): void {
  if (cached && cached.userId === userId && cached.count === count) {
    return;
  }
  cached = { userId, count };
  notify();
}

/**
 * Drop the cache. Called after EVERY garage write (add / update / delete) so a
 * nudge can never outlive the car it was nudging about — the next reader
 * refetches. Deliberately lives at the api layer rather than in screens: a
 * screen that forgot to call it would leave a stale "add your car" prompt in
 * front of someone who just added one.
 */
export function invalidateSavedCarSignal(): void {
  if (cached === null) {
    return;
  }
  cached = null;
  notify();
}
