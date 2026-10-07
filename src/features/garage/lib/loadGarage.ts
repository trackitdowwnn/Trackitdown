/**
 * WHAT:  loadGarage — the ONE shared garage fetch (list_my_vehicles) behind the
 *        garage cache, deduped per user; and awaitGarageAnswer, which waits for
 *        the cache to know a user's garage, but never longer than a deadline.
 * WHY:   The + button, the nudges and the report host all want the same
 *        answer, often at the same moment (just after launch, or just after
 *        signing in from the + button). One in-flight request serves them all.
 *        awaitGarageAnswer lets the + button decide BEFORE it navigates, so
 *        the report form slides up already knowing whether to show the
 *        chooser — a short, bounded wait instead of a second navigation
 *        (2026-10-07: the old path pushed a chooser, then replaced it).
 *
 *        SAFETY: a result is published only if the same user is still signed
 *        in when it lands — the cache holds number plates, and a fetch that
 *        outlives a sign-out must not leave the old account's cars behind.
 * LINKS: ./savedCarSignal.ts (the cache); ../hooks/useHasSavedCar.ts;
 *        ../hooks/useStartReport.ts (awaits it); ../api/garageApi.ts.
 */

import { getCurrentUserId } from '@/features/auth';

import { listMyVehicles } from '../api/garageApi';
import { garageFor, publishGarage } from './savedCarSignal';

let inFlight: { userId: string; promise: Promise<boolean> } | null = null;

/**
 * Fetch the user's garage into the cache. Resolves true when it loaded, false
 * when it failed (listMyVehicles already logged it) — never rejects, so a
 * caller that only wants to warm the cache can fire and forget.
 */
export function loadGarage(userId: string): Promise<boolean> {
  if (inFlight && inFlight.userId === userId) {
    return inFlight.promise;
  }
  const promise = listMyVehicles()
    .then((vehicles) => {
      if (getCurrentUserId() !== userId) {
        return false; // signed out (or switched) while it was in flight
      }
      publishGarage(userId, vehicles);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      if (inFlight?.promise === promise) {
        inFlight = null;
      }
    });
  inFlight = { userId, promise };
  return promise;
}

/**
 * Resolve once the cache knows this user's garage — already cached, freshly
 * loaded, or failed — or after timeoutMs, whichever comes first. Never
 * rejects. A guest (null) resolves at once: there is no garage to know.
 */
export async function awaitGarageAnswer(userId: string | null, timeoutMs: number): Promise<void> {
  if (userId === null || garageFor(userId) !== null) {
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    loadGarage(userId),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
}
