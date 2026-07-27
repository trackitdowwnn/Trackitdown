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

import { createLogger } from '@/shared/lib/logger';

const log = createLogger('payments');

export type BountyPaymentOutcome = 'paid' | 'cancelled' | 'failed';

export interface BountyPaymentResult {
  outcome: BountyPaymentOutcome;
  /** A user-facing message for the 'failed' outcome (null otherwise). */
  message: string | null;
}

const PAYMENT_FAILED_MESSAGE = 'Your payment didn’t go through. Please try again.';

export function useBountyPayment() {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  /**
   * Initialise + present the PaymentSheet for a client secret. Resolves with a
   * coarse outcome; never throws (the caller branches on `outcome`).
   */
  const payBounty = useCallback(
    async (clientSecret: string): Promise<BountyPaymentResult> => {
      const initResult = await initPaymentSheet({
        paymentIntentClientSecret: clientSecret,
        merchantDisplayName: 'Trackitdown',
        // Escrow is captured immediately; no delayed methods (BACS/SEPA) — the
        // bounty must be funds-in before the post enters verification.
        allowsDelayedPaymentMethods: false,
        returnURL: 'trackitdown://stripe-redirect',
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
