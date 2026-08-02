/**
 * WHAT:  useGarageNudgeCard — decides whether the Explore feed shows the
 *        save-your-car card, and owns accepting or dismissing it.
 * WHY:   Keeps the whole decision in one testable place instead of scattering
 *        conditions across a screen, and keeps the FETCH behind the cheap
 *        checks: `useHasSavedCar` is only enabled once we already know the
 *        account is old enough and hasn't been offered the garage, so a
 *        day-old user or a dismissed user costs zero network.
 *
 *        DEPENDENCY DIRECTION: `accountCreatedAt` is INJECTED by the caller, not
 *        fetched here. The garage must never import features/profile — profile
 *        already imports the garage (the My cars hint), so fetching tenure here
 *        would close a cycle (ARCHITECTURE.md rule 1).
 * LINKS: src/features/garage/lib/garageNudgeRules.ts (the pure predicate);
 *        src/features/garage/lib/garageNudgeStorage.ts (the shared flag);
 *        src/features/garage/components/SaveYourCarCard.tsx;
 *        src/features/search-map/screens/HomeFeedScreen.tsx (the caller).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { createLogger } from '@/shared/lib/logger';

import { isTenured, shouldShowGarageCard } from '../lib/garageNudgeRules';
import { hasOfferedGarageNudge, markGarageNudgeOffered } from '../lib/garageNudgeStorage';
import { useHasSavedCar } from './useHasSavedCar';

const log = createLogger('garage');

export interface UseGarageNudgeCardOptions {
  /** From the caller's profile — the garage never fetches this itself. */
  accountCreatedAt: string | null | undefined;
  /**
   * False when a higher-priority nudge owns the feed's single card slot.
   * Folded into `visible` rather than checked by the caller so that `visible`
   * means "on screen" and not merely "eligible" — the impression log and the
   * savedCar fetch both hang off it, and an impression for a card nobody saw
   * corrupts the accept rate it exists to measure.
   */
  active?: boolean;
}

export interface UseGarageNudgeCardResult {
  visible: boolean;
  /** The user took the offer — mark it made, so nothing asks again. */
  accept: () => void;
  dismiss: () => void;
}

export function useGarageNudgeCard({
  accountCreatedAt,
  active = true,
}: UseGarageNudgeCardOptions): UseGarageNudgeCardResult {
  // null = still reading. Never render on null: a card that appears and then
  // vanishes a frame later is worse than one that appears a beat late.
  const [alreadyOffered, setAlreadyOffered] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void hasOfferedGarageNudge().then((offered) => {
      if (active) {
        setAlreadyOffered(offered);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // Captured once at mount, not read per render: Date.now() in a render path is
  // impure (react-hooks/purity), and a 3-day threshold does not need to be
  // re-evaluated mid-screen — the next mount picks up the newer clock.
  const [now] = useState(() => Date.now());

  // Only ask the server once the CHEAP conditions already pass — a brand-new or
  // already-offered user never triggers a garage fetch at all.
  // `active` joins the cheap conditions: a card that cannot be shown must not
  // cost a round trip either. It flips true if the higher-priority nudge is
  // dismissed, and the fetch starts then.
  const worthAsking = active && alreadyOffered === false && isTenured(accountCreatedAt, now);
  const savedCar = useHasSavedCar({ enabled: worthAsking });

  const visible =
    active &&
    shouldShowGarageCard({
      savedCar,
      accountCreatedAt,
      alreadyOffered,
      now,
    });

  // One impression per mount, not per render — the same dedup rule the feed's
  // section impressions follow (docs/LOGGING.md: never log in a render path).
  const logged = useRef(false);
  useEffect(() => {
    if (visible && !logged.current) {
      logged.current = true;
      log.info('garage_nudge_shown', { surface: 'feed_card' });
    }
  }, [visible]);

  const settle = useCallback((outcome: 'accepted' | 'dismissed') => {
    setAlreadyOffered(true);
    void markGarageNudgeOffered();
    log.info(`garage_nudge_${outcome}`, { surface: 'feed_card' });
  }, []);

  return {
    visible,
    accept: useCallback(() => settle('accepted'), [settle]),
    dismiss: useCallback(() => settle('dismissed'), [settle]),
  };
}
