/**
 * WHAT:  The pending "offer to save a car" intent — set when someone abandons
 *        the post-a-car wizard, consumed by SaveYourCarSheet.
 * WHY:   The wizard route UNMOUNTS when the user backs out, so the sheet cannot
 *        live there; it needs a store the departing screen can post to and a
 *        root-mounted sheet can read. Deliberately a FORK of the auth
 *        gateIntent rather than an extension of it: adding a non-auth
 *        GateContext would make a signed-in user's tap resolve instantly and
 *        show nothing, because useRequireAuth short-circuits on 'member'.
 *
 *        In memory only, never serialised — same reasoning as gateIntent. An
 *        offer that survived an app restart would be a nag arriving out of
 *        nowhere, long after the moment that prompted it.
 * LINKS: src/features/auth/gate/gateIntent.ts (the shape this copies);
 *        src/features/garage/components/SaveYourCarSheet.tsx (the consumer);
 *        src/app/post-a-car.tsx (the only setter).
 */

import { useSyncExternalStore } from 'react';

/** Where the offer came from. One source today; kept as a field so the funnel
 *  logs can tell surfaces apart if a second ever appears. */
export interface SaveCarNudgeIntent {
  source: 'post_a_car_abandoned';
}

let pending: SaveCarNudgeIntent | null = null;
const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((cb) => cb());
}
function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
function getSnapshot(): SaveCarNudgeIntent | null {
  return pending;
}

/** Ask for the offer to be made. The sheet decides whether it actually should
 *  be (signed in, no saved car, never offered before) — the caller only reports
 *  that the moment happened. A second request simply replaces the first; it
 *  never queues, because two identical offers is one offer. */
export function requestSaveCarNudge(): void {
  pending = { source: 'post_a_car_abandoned' };
  notify();
}

/** Drop the intent. Called both when the sheet closes and when it decides not
 *  to open at all, so a suppressed intent can't fire later. */
export function clearSaveCarNudge(): void {
  if (pending === null) {
    return;
  }
  pending = null;
  notify();
}

export function useSaveCarNudgeIntent(): SaveCarNudgeIntent | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}
