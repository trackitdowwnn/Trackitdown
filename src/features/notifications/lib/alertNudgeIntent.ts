/**
 * WHAT:  The pending "offer to set an alert area" intent — raised when someone
 *        finishes their third listing, consumed by AlertNudgeSheet.
 * WHY:   The post-detail route UNMOUNTS as they back out, so the sheet cannot
 *        live there; it needs a store the departing screen can post to and a
 *        root-mounted sheet can read. A FORK of the garage's exitNudgeIntent
 *        rather than a shared generic one: the two offers have different
 *        eligibility, different flags and different funnels, and a shared store
 *        would have to carry a discriminator that neither consumer wants.
 *
 *        In memory only, never serialised. The post-view COUNT behind it does
 *        persist (alertNudgeStorage.ts) — but the intent must not, or the sheet
 *        could open on a cold start long after the browsing that earned it,
 *        which is the nag this whole design is avoiding.
 * LINKS: src/features/garage/lib/exitNudgeIntent.ts (the shape this copies);
 *        ../components/AlertNudgeSheet.tsx (the consumer);
 *        ../hooks/useCountPostViewForAlertNudge.ts (the only setter).
 */

import { useSyncExternalStore } from 'react';

/** Why the offer is being made. One source today; kept as a field so the funnel
 *  logs can tell surfaces apart if a second ever appears. */
export interface AlertNudgeIntent {
  source: 'post_views';
}

let pending: AlertNudgeIntent | null = null;
const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((cb) => cb());
}
function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
function getSnapshot(): AlertNudgeIntent | null {
  return pending;
}

/** Ask for the offer to be made. The sheet decides whether it actually should
 *  be (signed in, no alert yet, never offered before) — the caller only reports
 *  that the moment happened. A second request replaces the first; it never
 *  queues, because two identical offers is one offer. */
export function requestAlertNudge(): void {
  pending = { source: 'post_views' };
  notify();
}

/** Drop the intent. Called both when the sheet closes and when it decides not
 *  to open at all, so a suppressed intent can't fire later. */
export function clearAlertNudge(): void {
  if (pending === null) {
    return;
  }
  pending = null;
  notify();
}

export function useAlertNudgeIntent(): AlertNudgeIntent | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}
