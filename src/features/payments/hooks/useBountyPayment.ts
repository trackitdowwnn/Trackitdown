/**
 * WHAT:  A hook that drives Stripe's PaymentSheet for a bounty escrow charge.
 *        Given a PaymentIntent client secret it initialises and presents the
 *        native sheet and reports a single, coarse outcome: 'paid', 'cancelled'
 *        (the user dismissed the sheet), or 'failed' (a decline / error).
 * WHY:   The screen shouldn't know Stripe's SDK shape. This wraps
 *        useStripe().initPaymentSheet + presentPaymentSheet into one call with a
 *        three-way result the wizard maps cleanly: 'paid' routes on, 'cancelled'
 *        keeps the wizard intact (the screen shows a calm retry line), 'failed'
 *        surfaces a retry message. The authoritative state change is the webhook,
 *        NOT this result — 'paid' here only means the sheet reported success and
 *        it's safe to route away.
 * LINKS: @stripe/stripe-react-native (useStripe); src/features/payments/api/
 *          paymentsApi.ts (supplies the client secret); src/features/vehicles/
 *          post/screens/PostACarScreen.tsx (consumer);
 *        supabase/functions/stripe-webhook/index.ts (the real state change).
 */

import { PaymentSheetError, useStripe } from '@stripe/stripe-react-native';
import { useCallback } from 'react';

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

import { paymentSheetAppearance } from '../lib/paymentSheetAppearance';
import { ensureStripeReady } from '../lib/stripeReady';

const log = createLogger('payments');

export type BountyPaymentOutcome = 'paid' | 'cancelled' | 'failed';

export interface BountyPaymentResult {
  outcome: BountyPaymentOutcome;
  /** A user-facing message for the 'failed' outcome (null otherwise). */
  message: string | null;
}

const PAYMENT_FAILED_MESSAGE = 'Your payment didn’t go through. Please try again.';
/** Built once: the tokens are constants, so there is nothing to recompute. */
const APPEARANCE = paymentSheetAppearance();

/**
 * The signed-in email, for the sheet's billing details (2026-10-16) — the same
 * address the receipt goes to (#211), and it lets Link recognise them. Read
 * from the local session, never the network; no email simply means no prefill.
 */
async function sessionEmail(): Promise<string | undefined> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.email || undefined;
  } catch {
    return undefined;
  }
}

/**
 * GOOGLE PAY, FIRST (2026-10-14, payments plan PR7): one tap, the phone's own
 * authentication instead of a bank's 3D Secure step, and no card typed in.
 * Google's TEST environment until Google grants production access — tied to
 * the key, so a live key (pk_live_…) is the only thing that leaves it, and a
 * test key can never reach a real wallet.
 */
const GOOGLE_PAY = {
  merchantCountryCode: 'GB',
  currencyCode: 'GBP',
  testEnv: !(process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '').startsWith('pk_live_'),
} as const;

export function useBountyPayment() {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  /**
   * Initialise + present the PaymentSheet for a client secret. Resolves with a
   * coarse outcome; never throws (the caller branches on `outcome`).
   */
  const payBounty = useCallback(
    async (clientSecret: string): Promise<BountyPaymentResult> => {
      // Stripe is initialised after the screen's transition, not on mount
      // (2026-10-07) — a fast tap to pay waits for it here.
      try {
        await ensureStripeReady();
      } catch {
        log.warn('Stripe init failed');
        return { outcome: 'failed', message: PAYMENT_FAILED_MESSAGE };
      }
      const email = await sessionEmail();
      const initResult = await initPaymentSheet({
        paymentIntentClientSecret: clientSecret,
        merchantDisplayName: 'Trackitdown',
        // Escrow is captured immediately; no delayed methods (BACS/SEPA) — the
        // bounty must be funds-in before the post enters verification.
        allowsDelayedPaymentMethods: false,
        returnURL: 'trackitdown://stripe-redirect',
        googlePay: GOOGLE_PAY,
        appearance: APPEARANCE,
        // The postcode field stays as the sheet decides: it feeds the bank's
        // fraud check, and the first live payment showed it is used.
        ...(email ? { defaultBillingDetails: { email } } : {}),
      });
      if (initResult.error) {
        log.warn('PaymentSheet init failed', { code: initResult.error.code });
        return { outcome: 'failed', message: PAYMENT_FAILED_MESSAGE };
      }

      const { error } = await presentPaymentSheet();
      if (error) {
        if (error.code === PaymentSheetError.Canceled) {
          log.info('PaymentSheet cancelled by user');
          return { outcome: 'cancelled', message: null };
        }
        log.warn('PaymentSheet failed', { code: error.code });
        return { outcome: 'failed', message: PAYMENT_FAILED_MESSAGE };
      }

      log.info('PaymentSheet reported success');
      return { outcome: 'paid', message: null };
    },
    [initPaymentSheet, presentPaymentSheet],
  );

  return { payBounty };
}
