/**
 * WHAT:  useHasSavedCar — 'unknown' | 'none' | 'some', the gated view of the
 *        saved-car signal. Fetches the garage at most once per user per app
 *        session, and only when the caller says it's worth knowing.
 * WHY:   The nudges need to know whether to appear, on screens that must not pay
 *        for a garage fetch per mount. `enabled` is the whole point: a
 *        day-old account, or one that has already been offered the nudge, costs
 *        ZERO network — the caller's cheap conditions are evaluated first and
 *        this never fires.
 *
 *        'unknown' NEVER nudges. A failed fetch, a guest, a mid-flight request
 *        and a user switch all read 'unknown', so the honest default everywhere
 *        is "say nothing". A network blip must never produce a prompt.
 *
 *        SAFETY: the cached count is keyed by user id and ignored when it
 *        belongs to anyone else — a saved car is a number plate.
 * LINKS: src/features/garage/lib/savedCarSignal.ts (the store);
 *        src/features/garage/hooks/useGarageNudgeCard.ts,
 *        src/features/garage/components/SaveYourCarSheet.tsx (consumers);
 *        src/features/garage/hooks/useMyVehicles.ts (primes the same store).
 */

import { useEffect, useSyncExternalStore } from 'react';

import { useSession } from '@/features/auth';

import { listMyVehicles } from '../api/garageApi';
import {
  getSavedCarSnapshot,
  publishSavedCarCount,
  subscribeToSavedCarSignal,
} from '../lib/savedCarSignal';

export type SavedCarState = 'unknown' | 'none' | 'some';

export interface UseHasSavedCarOptions {
  /** Only fetch when the caller actually needs the answer. */
  enabled: boolean;
}

/** One in-flight request shared by every mounted consumer, so the Profile row
 *  and the feed card mounting together cause ONE round trip, not two. */
let inFlight: Promise<void> | null = null;

function loadOnce(userId: string): Promise<void> {
  if (inFlight) {
    return inFlight;
  }
  inFlight = listMyVehicles()
    .then((vehicles) => {
      publishSavedCarCount(userId, vehicles.length);
    })
    .catch(() => {
      // listMyVehicles already logged it. Leaving the signal 'unknown' means the
      // nudges simply stay quiet — the right failure mode for a prompt.
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function useHasSavedCar({ enabled }: UseHasSavedCarOptions): SavedCarState {
  const session = useSession();
  const userId = session.status === 'signedIn' ? session.userId : null;
  const cached = useSyncExternalStore(subscribeToSavedCarSignal, getSavedCarSnapshot);

  // Another user's cached answer is not an answer. Guests are 'unknown' rather
  // than 'none' (unlike useMyVehicles, which reports them as ready-and-empty) —
  // treating a signed-out user as having no cars would nudge them to save one.
  const known = userId !== null && cached?.userId === userId ? cached : null;

  useEffect(() => {
    if (!enabled || !userId || known) {
      return;
    }
    void loadOnce(userId);
  }, [enabled, userId, known]);

  if (!known) {
    return 'unknown';
  }
  return known.count > 0 ? 'some' : 'none';
}
