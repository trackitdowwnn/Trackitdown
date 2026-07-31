/**
 * WHAT:  useAlertNudgeCard — decides whether the Explore feed shows the
 *        set-your-alert-area card, and owns accepting or dismissing it.
 * WHY:   Keeps the whole decision in one testable place rather than scattering
 *        conditions across a screen, mirroring useGarageNudgeCard.
 *        No auth import is needed: useMyAlerts already reports 'signedOut'
 *        for a guest and 'ready' with an empty list for exactly the person
 *        this card is for — a member who has never set one up. That also keeps
 *        this hook light enough to live in the feature's public barrel.
 * LINKS: src/features/garage/hooks/useGarageNudgeCard.ts (the template);
 *        ../lib/alertNudgeStorage.ts (the flag); ../hooks/useMyAlerts.ts;
 *        src/features/search-map/screens/HomeFeedScreen.tsx (the caller).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { createLogger } from '@/shared/lib/logger';

import { hasOfferedAlertNudge, markAlertNudgeOffered } from '../lib/alertNudgeStorage';
import { useMyAlerts } from './useMyAlerts';

const log = createLogger('notifications');

export interface UseAlertNudgeCardResult {
  visible: boolean;
  /** They took the offer — mark it made, so nothing asks again. */
  accept: () => void;
  dismiss: () => void;
}

export function useAlertNudgeCard(): UseAlertNudgeCardResult {
  // null = still reading. Never render on null: a card that appears and then
  // vanishes a frame later is worse than one that appears a beat late.
  const [alreadyOffered, setAlreadyOffered] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void hasOfferedAlertNudge().then((offered) => {
      if (active) setAlreadyOffered(offered);
    });
    return () => {
      active = false;
    };
  }, []);

  const alerts = useMyAlerts();

  // Only for a signed-in user with NO alerts. A guest can't hold one, and
  // someone who already has one does not need inviting to make their first.
  const visible =
    alreadyOffered === false && alerts.status === 'ready' && alerts.alerts.length === 0;

  // One impression per mount, not per render (docs/LOGGING.md: never log in a
  // render path).
  const logged = useRef(false);
  useEffect(() => {
    if (visible && !logged.current) {
      logged.current = true;
      log.info('alert_nudge_shown', { surface: 'feed_card' });
    }
  }, [visible]);

  const settle = useCallback((outcome: 'accepted' | 'dismissed') => {
    setAlreadyOffered(true);
    void markAlertNudgeOffered();
    log.info(`alert_nudge_${outcome}`, { surface: 'feed_card' });
  }, []);

  return {
    visible,
    accept: useCallback(() => settle('accepted'), [settle]),
    dismiss: useCallback(() => settle('dismissed'), [settle]),
  };
}
