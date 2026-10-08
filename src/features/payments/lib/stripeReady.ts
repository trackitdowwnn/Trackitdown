/**
 * WHAT:  ensureStripeReady — initialises Stripe's native SDK once per app
 *        session (publishable key + Apple Pay merchant id) and returns the
 *        shared promise; every Stripe call awaits it first.
 * WHY:   Stripe's <StripeProvider> runs initStripe on EVERY mount (the first
 *        call on Android also attaches a Compose view on the UI thread), so a
 *        native re-initialise landed in the middle of the report form's
 *        slide-up each time the form opened (2026-10-07). The provider holds no React
 *        context (useStripe calls the native module directly), so it can be
 *        replaced by this: the payment routes warm it AFTER their transition
 *        (BountyPaymentProvider), and the PaymentSheet / bank-token calls
 *        await it, so a fast tap to pay can never reach an uninitialised SDK.
 *
 *        The publishable key is PUBLIC (it can only open the sheet, never move
 *        money); secret and webhook keys are Edge Function secrets, never in
 *        the app. An empty key skips init, leaving the sheet to fail with a
 *        surfaced, retryable error (env not set up yet) rather than crashing.
 * LINKS: src/features/payments/BountyPaymentProvider.tsx (warms it);
 *        src/features/payments/hooks/useBountyPayment.ts,
 *        src/features/payments/api/stripeTokens.ts (await it);
 *        app.config.ts (the Stripe config plugin).
 */

import { initStripe } from '@stripe/stripe-react-native';
import { Platform } from 'react-native';

const publishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

// Apple Pay merchant id (iOS only; inert until an Apple Pay merchant id +
// entitlement are registered). Mirrors the app's bundle id.
const APPLE_PAY_MERCHANT_ID = 'merchant.com.olliet97.trackitdown';

let ready: Promise<void> | null = null;

/** Initialise once; later calls share the same promise. A failure is not
 *  cached — the next call (the user's retry) tries again. */
export function ensureStripeReady(): Promise<void> {
  if (!publishableKey) {
    return Promise.resolve();
  }
  if (!ready) {
    ready = initStripe(
      Platform.OS === 'ios'
        ? { publishableKey, merchantIdentifier: APPLE_PAY_MERCHANT_ID }
        : { publishableKey },
    ).catch((err: unknown) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

/** Test-only: forget the shared promise. */
export function resetStripeReady(): void {
  ready = null;
}
