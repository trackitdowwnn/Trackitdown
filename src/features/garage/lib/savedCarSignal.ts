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
  /** Date.now() when published — lets a reader skip a refetch of an answer
   *  loaded moments ago (the + button's wait, then the report host). */
  publishedAt: number;
}

let cached: GarageSnapshot | null = null;
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
    cached = { ...cached, publishedAt: Date.now() };
    return;
  }
  cached = { userId, count: vehicles.length, vehicles, publishedAt: Date.now() };
  notify();
}

/** True when this user's cached garage was loaded within maxAgeMs. */
export function isGarageFresh(userId: string | null, maxAgeMs: number): boolean {
  const garage = garageFor(userId);
  return garage !== null && Date.now() - garage.publishedAt <= maxAgeMs;
}

/**
 * Drop the cache. Called after EVERY garage write (add / update / delete) so a
 * nudge — or a chooser — can never outlive the car it was about: the next
 * reader refetches. Deliberately lives at the api layer rather than in
 * screens: a screen that forgot to call it would leave a stale "add your car"
 * prompt in front of someone who just added one. Also called on sign-out.
 */
export function invalidateSavedCarSignal(): void {
  if (cached === null) {
    return;
  }
  cached = null;
  notify();
}
