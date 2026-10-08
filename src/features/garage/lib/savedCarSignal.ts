/**
 * WHAT:  The garage cache — the signed-in user's saved cars (and their count),
 *        module-level and keyed by user id, with a subscriber set so every
 *        surface sees the same answer. Holds state only; the fetching lives in
 *        loadGarage.ts.
 * WHY:   Several surfaces need the garage and must NOT each pay for a fetch:
 *        the nudges (Explore card, Profile row) only need the count, and the
 *        report flow needs the cars themselves — the + button decides from
 *        them, and the report host renders the chooser or the prefilled form
 *        from them on its FIRST frame, during its slide-up, instead of
 *        fetching again behind a loader (2026-10-07). /my-cars primes it for
 *        nothing (useMyVehicles publishes what it already loaded).
 *
 *        Module-level store + subscriber Set + useSyncExternalStore is the house
 *        convention for cross-instance state (invalidateMyProfile,
 *        invalidateProfileCheck, gateIntent).
 *
 *        SAFETY: the cars are stored WITH their user id and never returned for
 *        a different one, and the cache is dropped on sign-out. A saved car is
 *        a number plate, so showing user A's garage to user B is a privacy
 *        bug, not a cosmetic one.
 * LINKS: src/features/garage/lib/loadGarage.ts (the one shared fetch);
 *        src/features/garage/hooks/useHasSavedCar.ts (the count view);
 *        src/features/garage/hooks/useMyVehicles.ts (seeds from and primes it);
 *        src/features/garage/api/garageApi.ts (invalidates it on every write).
 */

import type { SavedVehicle } from '../types';

export interface GarageSnapshot {
  userId: string;
  count: number;
  vehicles: SavedVehicle[];
}

let cached: GarageSnapshot | null = null;
/** When the cached garage was last confirmed (Date.now()). Kept OUTSIDE the snapshot:
 *  refreshing it on a same-answer publish must not change the object
 *  useSyncExternalStore compares — that would re-render every subscriber for
 *  an identical answer without telling them (review of #141). */
let confirmedAt = 0;
/** Bumped on every write; see garageGeneration. */
let generation = 0;
const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((cb) => cb());
}

export function subscribeToSavedCarSignal(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

/** Stable between changes (useSyncExternalStore needs that). */
export function getSavedCarSnapshot(): GarageSnapshot | null {
  return cached;
}

/** The cached garage for THIS user, or null — never another user's. */
export function garageFor(userId: string | null): GarageSnapshot | null {
  return userId !== null && cached?.userId === userId ? cached : null;
}

/**
 * Record a user's garage. Called by anything that just loaded it — loadGarage
 * and useMyVehicles.
 *
 * No-ops when nothing changed: useMyVehicles revalidates on every refocus, so
 * without this guard every return to /my-cars would wake every subscriber and
 * re-render the Profile row and the feed header for an identical answer. The
 * list is small (a person's own cars), so a serialised compare is cheap.
 */
export function publishGarage(userId: string, vehicles: SavedVehicle[]): void {
  if (
    cached &&
    cached.userId === userId &&
    cached.count === vehicles.length &&
    JSON.stringify(cached.vehicles) === JSON.stringify(vehicles)
  ) {
    // Same answer: refresh its age without waking anyone.
    confirmedAt = Date.now();
    return;
  }
  cached = { userId, count: vehicles.length, vehicles };
  confirmedAt = Date.now();
  notify();
}

/** True when this user's cached garage was loaded within maxAgeMs. */
export function isGarageFresh(userId: string | null, maxAgeMs: number): boolean {
  return garageFor(userId) !== null && Date.now() - confirmedAt <= maxAgeMs;
}

/**
 * Drop the cache. Called after EVERY garage write (add / update / delete) so a
 * nudge — or a chooser — can never outlive the car it was about: the next
 * reader refetches. Deliberately lives at the api layer rather than in
 * screens: a screen that forgot to call it would leave a stale "add your car"
 * prompt in front of someone who just added one. Also called on sign-out.
 */
export function invalidateSavedCarSignal(): void {
  // Bumped even when nothing is cached: a fetch already in flight was asked
  // for BEFORE this write, so its answer is stale and must not be published
  // or joined (loadGarage checks the generation).
  generation += 1;
  if (cached === null) {
    return;
  }
  cached = null;
  notify();
}

/** Counts invalidations — a fetch started under an older one is stale. */
export function garageGeneration(): number {
  return generation;
}

/**
 * Mark ONE cached car as reported, the moment its post exists (review of
 * #141). Not a refetch: the server only counts a post as live once it is
 * paid (list_my_vehicles' is_currently_posted), so a refetch right after
 * creation would still say "not posted" and the next + would offer the car
 * again.
 *
 * It bridges the gap until the server agrees — it does not outlast it. The
 * next fetch replaces it with the server's answer: by then the payment's
 * webhook has normally landed (posted), and if the owner never paid, offering
 * the car again is right — an unpaid draft doesn't hold the plate.
 */
export function markVehiclePosted(vehicleId: string): void {
  if (!cached || !cached.vehicles.some((v) => v.id === vehicleId && !v.isCurrentlyPosted)) {
    return;
  }
  const vehicles = cached.vehicles.map((v) =>
    v.id === vehicleId ? { ...v, isCurrentlyPosted: true } : v,
  );
  cached = { ...cached, vehicles };
  notify();
}
