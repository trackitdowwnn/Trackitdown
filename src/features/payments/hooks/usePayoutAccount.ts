/**
 * WHAT:  usePayoutAccount — session-aware loader for my own payee account,
 *        plus the short "we just got back from Stripe" settling window.
 * WHY:   The screen needs to say one of five true things, and the difference
 *        between two of them is invisible for a few seconds after onboarding.
 *
 *        THE RACE THIS EXISTS FOR. `stripe-webhook` copies `details_submitted`
 *        and `payouts_enabled` in the SAME upsert, so until `account.updated`
 *        arrives, someone who has just spent five minutes on KYC reads exactly
 *        like someone who abandoned it half way: a row with both flags false.
 *        Deriving naively would greet them with "Pick up where you left off",
 *        which is both wrong and rude. So a return from the browser arms a
 *        `settling` window that outranks the derived state and says "Nearly
 *        there" until we actually know.
 *
 *        BOUNDED, NOT POLLED. Three re-reads at 2s / 4s / 8s, armed only by a
 *        deliberate return, stopping early the moment payouts are enabled.
 *        Then it stops for good and the user is in charge (pull to refresh).
 *        A plain visit never polls. The test that asserts the window
 *        TERMINATES is the one stopping this quietly becoming a poller.
 * LINKS: ../api/payoutsApi.ts; ../screens/PayoutsScreen.tsx;
 *        supabase/functions/stripe-webhook/index.ts (account.updated);
 *        src/features/profile/hooks/useMyProfile.ts (the keyed-fetch pattern).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useSession } from '@/features/auth';

import { fetchMyPayoutAccount, type PayoutAccount } from '../api/payoutsApi';

/** How long after a return we keep looking before handing over to the user. */
const SETTLE_DELAYS_MS = [2000, 4000, 8000] as const;

export type PayoutAccountStatus =
  | 'loading'
  | 'guest'
  | 'error'
  /** No row at all — they have never started. */
  | 'notStarted'
  /** Started, but Stripe still wants something from them. */
  | 'unfinished'
  /** Form finished; Stripe is deciding. Nothing for them to do. */
  | 'verifying'
  /** Money can reach them. */
  | 'ready';

export interface PayoutAccountState {
  status: PayoutAccountStatus;
  account: PayoutAccount | null;
  /** True while a browser return is still being resolved — outranks `status`. */
  settling: boolean;
  /** Re-read now (pull to refresh, focus). */
  refresh: () => void;
  /** Arm the settling window. Idempotent per return — safe to call twice. */
  settleReturn: () => void;
}

interface FetchResult {
  key: string;
  outcome: PayoutAccount | null | 'error';
}

export function usePayoutAccount(): PayoutAccountState {
  const session = useSession();
  const [generation, setGeneration] = useState(0);
  const [result, setResult] = useState<FetchResult | null>(null);
  const [armed, setArmed] = useState(false);
  // The answer, readable from a timer callback that cannot see state. Written
  // only from the fetch's own continuation — never during render.
  const enabledRef = useRef(false);

  // Keyed on the user, like useMyProfile: this is financial data, and a row
  // surviving a user switch is not a flicker, it is the wrong person's money.
  const key = session.status === 'signedIn' ? `${session.userId}:${generation}` : null;

  useEffect(() => {
    if (!key || session.status !== 'signedIn') {
      return;
    }
    let cancelled = false;
    // Reset before every read, including across a user switch. Left stale at
    // `true`, the next `settleReturn()` short-circuits on its first tick and
    // the settling window is silently skipped — which is the one thing this
    // hook exists to provide.
    enabledRef.current = false;
    fetchMyPayoutAccount(session.userId)
      .then((account) => {
        if (!cancelled) {
          enabledRef.current = Boolean(account?.payoutsEnabled);
          setResult({ key, outcome: account });
        }
      })
      .catch(() => {
        if (!cancelled) {
          enabledRef.current = false;
          setResult({ key, outcome: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key, session.status, session.userId]);

  const refresh = useCallback(() => {
    setGeneration((value) => value + 1);
  }, []);

  // Timers for the settling window, cleared on unmount so a backgrounded
  // screen stops reading. Held in a ref because they outlive their render.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const settleReturn = useCallback(() => {
    // Idempotent by construction: a second call while a window is open is a
    // no-op. This is what makes Android safe, where the browser promise AND
    // the deep-link param both fire for the same single return.
    if (timers.current.length > 0) {
      return;
    }
    setArmed(true);
    refresh();
    timers.current = SETTLE_DELAYS_MS.map((delay, index) =>
      setTimeout(() => {
        // The answer arrived on an earlier pass — stop, rather than spending
        // the rest of the window re-reading something we already know.
        if (enabledRef.current) {
          clearTimers();
          setArmed(false);
          return;
        }
        refresh();
        // The last one hands control back to the user for good.
        if (index === SETTLE_DELAYS_MS.length - 1) {
          timers.current = [];
          setArmed(false);
        }
      }, delay),
    );
  }, [clearTimers, refresh]);

  const account = result && result.key === key && result.outcome !== 'error' ? result.outcome : null;

  // DERIVED, not stored: the moment the account reads as payable there is
  // nothing left to settle, so the screen stops saying "nearly there" on the
  // same render the answer lands — without an effect chasing it.
  const settling = armed && !account?.payoutsEnabled;

  const status: PayoutAccountStatus = (() => {
    if (session.status === 'loading') return 'loading';
    if (session.status === 'signedOut') return 'guest';
    if (!result || result.key !== key) return 'loading';
    if (result.outcome === 'error') return 'error';
    if (result.outcome === null) return 'notStarted';
    if (result.outcome.payoutsEnabled) return 'ready';
    // The webhook writes both flags together, so this is the honest split:
    // the form is done and Stripe is deciding, or it genuinely is not done.
    return result.outcome.onboardingComplete ? 'verifying' : 'unfinished';
  })();

  return { status, account, settling, refresh, settleReturn };
}
