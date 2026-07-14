/**
 * WHAT:  useRequireAuth — THE gate. Returns requireAuth(intent): a member runs
 *        the action immediately; anyone else has the intent stored and the
 *        AuthSheet opened, and the action continues after sign-in (new users
 *        complete their profile first) without re-tapping.
 * WHY:   One mechanism for every protected action keeps the pattern honest:
 *        screens never police sessions themselves, they wrap the handler.
 *        'loading' standing is treated like a guest — the sheet resolves
 *        instantly if the restoring session turns out to be a member (the
 *        AuthSheet watches standing and self-closes), so a cold-start tap is
 *        never swallowed.
 * LINKS: gateIntent.ts (store + contexts); components/AuthSheet.tsx (resolver);
 *        docs/LOGGING.md (gate_shown / gate_completed / gate_dismissed funnel).
 */

import { useCallback } from 'react';

import { createLogger } from '@/shared/lib';

import { useAuthStanding } from '../hooks/useAuthStanding';
import { type PendingIntent, setPendingIntent } from './gateIntent';

const log = createLogger('auth');

export function useRequireAuth(): (intent: PendingIntent) => void {
  const standing = useAuthStanding();

  return useCallback(
    (intent: PendingIntent) => {
      if (standing === 'member') {
        intent.run?.();
        return;
      }
      log.info('gate_shown', { context: intent.context, standing });
      setPendingIntent(intent);
    },
    [standing],
  );
}
