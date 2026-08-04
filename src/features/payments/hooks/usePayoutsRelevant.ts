/**
 * WHAT:  usePayoutsRelevant — one boolean for the Profile row: does this user
 *        have any reason to see a payouts surface?
 * WHY:   Credit-time setup (ADR-0010 amendments, 2026-08-04) made "no setup"
 *        literally true, which turned the always-on Payouts row into an
 *        invitation to a screen about nothing. It now renders only for people
 *        with a payee account or a credited bounty waiting; everyone else's
 *        front door is the `credited` push.
 *
 *        Defaults to HIDDEN and stays hidden on error — the row is a
 *        convenience entrance, and briefly missing one beats briefly showing a
 *        setup surface to someone with nothing to set up. `refresh` exists so
 *        the Profile tab's refocus pass can catch the row appearing after a
 *        first credit without an app restart.
 * LINKS: ../api/payoutsApi.ts (fetchPayoutsRelevant);
 *        supabase/migrations/20260804120000_payouts_relevant.sql;
 *        src/features/profile/screens/ProfileScreen.tsx (the consumer).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchPayoutsRelevant } from '../api/payoutsApi';

export function usePayoutsRelevant(): { relevant: boolean; refresh: () => void } {
  const [relevant, setRelevant] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const refresh = useCallback(() => {
    void fetchPayoutsRelevant().then((value) => {
      if (mounted.current) {
        setRelevant(value);
      }
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { relevant, refresh };
}
