/**
 * WHAT:  usePollWhileChecking — while the screen is in view and `shouldPoll()`
 *        says the answer is still out, call `check` every `everyMs`, at most
 *        `times` times per visit.
 * WHY:   2026-10-14. Payouts asked the server to check with Stripe ONCE on
 *        arrival — seconds too early for a test-mode check that finishes in
 *        seconds — and never again, so "being checked" sat there until the
 *        owner tapped an unrelated button. The v2 account events now reach the
 *        server too; this is the screen's own backstop, bounded so a check that
 *        really does take a day costs a dozen calls, not a battery.
 *
 *        `shouldPoll` is read on every tick, not captured: the status changes
 *        under a running timer, and a tick that finds nothing to wait for is
 *        simply skipped (and not counted). Focus-scoped, as usePostDetail's
 *        live refresh is: leaving the screen stops it, coming back starts a
 *        fresh allowance.
 * LINKS: ../screens/PayoutsScreen.tsx; ./usePollWhileChecking.test.ts.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

/**
 * `spent` turns true once this visit's allowance is used up — the screen's cue
 * to stop SHOWING that it is checking (the "working" marker, "checking now"),
 * because from then on it isn't (2026-10-14). A new visit starts fresh.
 */
export function usePollWhileChecking(
  shouldPoll: () => boolean,
  check: () => void,
  { everyMs = 10_000, times = 12 }: { everyMs?: number; times?: number } = {},
): { spent: boolean } {
  const [spent, setSpent] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let asked = 0;
      // A fresh allowance for this visit; set from a callback, never
      // synchronously in the effect.
      const fresh = setTimeout(() => setSpent(false), 0);
      const timer = setInterval(() => {
        if (!shouldPoll()) return;
        asked += 1;
        if (asked > times) {
          clearInterval(timer);
          setSpent(true);
          return;
        }
        check();
      }, everyMs);
      return () => {
        clearTimeout(fresh);
        clearInterval(timer);
      };
    }, [shouldPoll, check, everyMs, times]),
  );
  return { spent };
}
