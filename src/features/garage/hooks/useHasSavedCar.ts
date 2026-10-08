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
 *        SAFETY: the cached garage is keyed by user id and ignored when it
 *        belongs to anyone else, and dropped on sign-out — a saved car is a
 *        number plate.
 * LINKS: src/features/garage/lib/savedCarSignal.ts (the store);
 *        src/features/garage/lib/loadGarage.ts (the one shared fetch);
 *        src/features/garage/hooks/useGarageNudgeCard.ts,
 *        src/features/garage/components/SaveYourCarSheet.tsx (consumers);
 *        src/features/garage/hooks/useMyVehicles.ts (primes the same store).
 */

import { useEffect, useSyncExternalStore } from 'react';

import { useSession } from '@/features/auth';

import { loadGarage } from '../lib/loadGarage';
import {
  getSavedCarSnapshot,
  invalidateSavedCarSignal,
  subscribeToSavedCarSignal,
} from '../lib/savedCarSignal';

export type SavedCarState = 'unknown' | 'none' | 'some';

export interface UseHasSavedCarOptions {
  /** Only fetch when the caller actually needs the answer. */
  enabled: boolean;
}

export function useHasSavedCar({ enabled }: UseHasSavedCarOptions): SavedCarState {
  const session = useSession();
  const userId = session.status === 'signedIn' ? session.userId : null;
  // Subscribed so a publish re-renders; keyed by user so another
  // user's cached answer is never an answer. Guests are 'unknown' rather than
  // 'none' (unlike useMyVehicles, which reports them as ready-and-empty) —
  // treating a signed-out user as having no cars would nudge them to save one.
  //
  // ⚠️ READ THE SNAPSHOT THE STORE HANDS BACK — never re-read the module in
  // render. The React Compiler memoises a plain `garageFor(userId)` call on
  // `userId`, so a publish would re-render this hook and still return the old
  // answer: nudges stuck on 'unknown', or a 'none' outliving the car just
  // added (review of #141 — the same trap as a render-time clock).
  const snapshot = useSyncExternalStore(subscribeToSavedCarSignal, getSavedCarSnapshot);
  const known = userId !== null && snapshot?.userId === userId ? snapshot : null;

  useEffect(() => {
    if (!enabled || !userId || known) {
      return;
    }
    void loadGarage(userId);
  }, [enabled, userId, known]);

  // SAFETY: the cache holds plates — drop it the moment the session ends.
  // The tab layout mounts this hook for the whole session, so this is the
  // one place that always sees a sign-out. (The saved report draft is NOT
  // wiped here: it records its owner and is only offered back to them — see
  // postDraftStorage.)
  useEffect(() => {
    if (session.status === 'signedOut') {
      invalidateSavedCarSignal();
    }
  }, [session.status]);

  if (!known) {
    return 'unknown';
  }
  return known.count > 0 ? 'some' : 'none';
}
