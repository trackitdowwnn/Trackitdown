/**
 * WHAT:  PayoutSetupScreen — hosts the payout-setup wizard and owns its one
 *        send: the details become two Stripe tokens on the phone, and our
 *        server receives two opaque ids (ADR-0010).
 * WHY:   The wizard replaced PayoutDetailsForm's single page (2026-10-13). This
 *        screen is only the HOST, as ReportBugScreen is: it builds the flow and
 *        submits. Chrome, gating, progress and review belong to shared/wizard.
 *
 *        HOW IT ENDS, with a word left for Payouts in payoutSetupOutcome
 *        (expo-router can't hand the returning screen a param — see that
 *        module), keyed to this user:
 *          - sent → 'submitted', and back: Payouts arms its settling window,
 *            and Stripe usually activates a clean UK individual within seconds;
 *          - Stripe refused the details → the wizard STAYS, answers intact,
 *            saying so, because a mistyped account number reads exactly like a
 *            refusal and is fixed in a second. 'rejected' is left behind all
 *            the same: if they give up and leave, Payouts offers "Continue with
 *            Stripe" for what our fields can't describe (a company, a non-UK
 *            account). Ejecting them on the first refusal discarded eleven
 *            answers and offered the one path that can't be undone (security
 *            review, 2026-10-13);
 *          - an account already existed → the server kept nothing it was sent,
 *            so this says that, plainly, rather than celebrating: "Update bank
 *            details" on Payouts is how a bank changes;
 *          - anything else (no signal, Stripe busy) → stays, for a retry.
 *
 *        No `onSaveAndExit`: leaving discards. These are bank and identity
 *        details, and a draft of them would be the one thing payments promises
 *        never to keep.
 * LINKS: ../lib/payoutSetupFlow.tsx; ../lib/payoutSetupOutcome.ts;
 *        ../api/stripeTokens.ts; ../api/payoutsApi.ts (submitPayoutTokens);
 *        ./PayoutsScreen.tsx (where it returns); src/app/payout-setup.tsx.
 */

import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';

import { useSession } from '@/features/auth';
import { supabase } from '@/shared/api';
import { PaymentError } from '@/shared/lib/functionError';
import { successHaptic } from '@/shared/lib/haptics';
import { createLogger } from '@/shared/lib/logger';
import { useToast } from '@/shared/ui';
import { WizardScreen } from '@/shared/wizard';

import { submitPayoutTokens, type PayoutTokensResult } from '../api/payoutsApi';
import { createBankToken, createIdentityToken } from '../api/stripeTokens';
import { buildPayoutDetailsSchema, digitsOnly, parseUkDate } from '../components/payoutDetailsSchema';
import { EMPTY_PAYOUT_SETUP, type PayoutSetupAnswers } from '../lib/payoutSetupAnswers';
import { buildPayoutSetupFlow } from '../lib/payoutSetupFlow';
import { setPayoutSetupOutcome } from '../lib/payoutSetupOutcome';

const log = createLogger('payments');

const SEND_FAILED = 'We couldn’t send your details. Please try again.';
const REFUSED =
  'Those details couldn’t be accepted. Check them and send again — or go back for another way to set up.';
const ALREADY_SET_UP =
  'Payouts were already set up, so nothing changed. To change your bank, use “Update bank details”.';

/**
 * The payout-setup wizard's host (route `/payout-setup`, pushed from Payouts).
 * Needs a signed-in spotter: a guest who deep-links here is sent to Payouts,
 * which has the log-in state, before typing a single field.
 */
export function PayoutSetupScreen() {
  const router = useRouter();
  const toast = useToast();
  const session = useSession();
  const flow = useMemo(() => buildPayoutSetupFlow(), []);

  // Whether this screen is still on the stack when a send resolves. The X and
  // Android back are held while sending, but a gesture or a deep link could
  // still have taken it away — and `router.back()` from a screen that's gone
  // pops the one beneath it instead (security review, 2026-10-13). Set true IN
  // the effect, not only at creation: a remount (fast refresh, StrictMode)
  // runs the cleanup and then the effect again, and would otherwise leave it
  // false for good (useWizardController's mounted ref, the same trap).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  /** Back to Payouts — or TO it, for a deep link with nothing beneath. With
   *  the edge swipe off, a bare `back()` there would be no way out at all. */
  const leave = () => {
    if (!mounted.current) return;
    if (router.canGoBack()) router.back();
    else router.replace('/payouts');
  };

  // Nothing to set up for a guest — Payouts says so and offers the log-in.
  const signedOut = session.status === 'signedOut';
  useEffect(() => {
    if (signedOut) router.replace('/payouts');
  }, [signedOut, router]);

  /**
   * The final "Send to Stripe".
   * @throws Error with a user-facing message — the wizard shows it above its
   *   button and keeps every answer — for anything short of a send that landed.
   */
  const send = async (answers: Partial<PayoutSetupAnswers>) => {
    // The review gate already re-checked every step; this is the whole-form
    // rule set once more (the account numbers matching) before anything leaves.
    const parsed = buildPayoutDetailsSchema().safeParse({ ...EMPTY_PAYOUT_SETUP, ...answers });
    const date = parsed.success ? parseUkDate(parsed.data.dob) : null;
    if (!parsed.success || !date) {
      throw new Error('Something here isn’t quite right — check your answers above.');
    }
    const details = {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      // Stripe wants YYYY-MM-DD; the person typed DD/MM/YYYY.
      dob: date.toISOString().slice(0, 10),
      phone: parsed.data.phone || undefined,
      addressLine1: parsed.data.addressLine1,
      addressLine2: parsed.data.addressLine2 || undefined,
      city: parsed.data.city,
      postalCode: parsed.data.postalCode,
      sortCode: digitsOnly(parsed.data.sortCode),
      accountNumber: digitsOnly(parsed.data.accountNumber),
    };

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) {
      // Offline reads like this too; "log in again" would send them chasing
      // the wrong fix.
      throw new Error(SEND_FAILED);
    }
    const user = userData.user;
    if (!user?.email) {
      throw new Error('Please log in again, then try once more.');
    }

    let result: PayoutTokensResult;
    try {
      const accountToken = await createIdentityToken(details, user.email);
      const bankToken = await createBankToken(details);
      result = await submitPayoutTokens({ accountToken, bankToken });
    } catch (error) {
      // The code only — never a value they typed (payoutsApi.test.ts holds the
      // line for the API layer; this is the same promise one level up).
      log.warn('payout setup send failed', {
        code: error instanceof PaymentError ? error.code : 'UNKNOWN',
      });
      if (error instanceof PaymentError && error.code === 'DETAILS_REJECTED') {
        // For Payouts, should they leave: "Continue with Stripe" is the way
        // past what these fields can't describe.
        setPayoutSetupOutcome('rejected', user.id);
        throw new Error(REFUSED);
      }
      // The wizard shows a thrown message verbatim above its button and keeps
      // every answer for the retry.
      throw new Error(error instanceof PaymentError ? error.message : SEND_FAILED);
    }

    // Settle either way: Payouts re-reads the account and says where it
    // stands. Only a real send is celebrated.
    setPayoutSetupOutcome('submitted', user.id);
    if (result === 'already_exists') {
      toast.show(ALREADY_SET_UP);
    } else {
      successHaptic();
    }
    leave();
  };

  return (
    <WizardScreen
      flow={flow}
      initialAnswers={EMPTY_PAYOUT_SETUP}
      // The framework asks before discarding typed answers; there is no
      // "save for later" on purpose (see the header).
      onExit={leave}
      onComplete={send}
    />
  );
}
