/**
 * WHAT:  useEarnings — the signed-in spotter's rewards (my_earnings), read when
 *        the account's status is known and again whenever it changes, with a
 *        manual refresh for pull-to-refresh.
 * WHY:   The Earnings list sits under the payout-account flows on the same
 *        screen, and an account moving to "ready" is exactly when a reward
 *        moves from "add your details" to "on its way" — so the account's
 *        status is the natural key to re-read on. A failed read keeps the last
 *        good list: money that flickers away reads as money that went away.
 * LINKS: ../api/payoutsApi.ts (fetchMyEarnings);
 *        ../components/EarningsList.tsx (the list);
 *        ../screens/PayoutsScreen.tsx (the host).
 */

import { useCallback, useEffect, useState } from 'react';

import { fetchMyEarnings, type Earnings } from '../api/payoutsApi';

export interface UseEarningsResult {
  /** The rewards, or null until the first read lands (or when signed out). */
  earnings: Earnings | null;
  refresh: () => void;
}

/**
 * @param enabled   false for a guest, or while the account status is loading
 * @param refreshKey re-read when this changes (the payout account's status)
 */
export function useEarnings(enabled: boolean, refreshKey?: string): UseEarningsResult {
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration((g) => g + 1), []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    fetchMyEarnings()
      .then((next) => {
        if (!cancelled) setEarnings(next);
      })
      .catch(() => {
        // Keep the last good list; the next status change or pull retries.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, refreshKey, generation]);

  return { earnings: enabled ? earnings : null, refresh };
}
