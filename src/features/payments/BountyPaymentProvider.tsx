/**
 * WHAT:  Wraps its children in Stripe's <StripeProvider>, reading the PUBLIC
 *        publishable key from EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY. Mount it above
 *        any screen that presents the bounty PaymentSheet (the post-a-car route).
 * WHY:   useStripe / PaymentSheet only work inside a StripeProvider, and the
 *        provider needs the publishable key. The publishable key is PUBLIC (safe
 *        to bundle — it can only open the sheet, never move money); the secret +
 *        webhook keys are Edge Function secrets, never in the app. Scoped to the
 *        post-a-car route rather than the app root so the native module is only
 *        engaged where payments actually happen. Requires a dev build with the
 *        @stripe/stripe-react-native config plugin (app.config.ts). The Apple Pay
 *        merchant id mirrors the iOS bundle id (com.olliet97.trackitdown); it is
 *        inert until an Apple Pay merchant id is registered in the Apple Developer
 *        account + a matching entitlement is added to the build.
 * LINKS: app.config.ts (the Stripe config plugin); src/app/post-a-car.tsx
 *          (mounts this); .env.example (EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY);
 *        supabase/functions/README.md (Stripe setup guide).
 */

import { StripeProvider } from '@stripe/stripe-react-native';
import type { ReactNode } from 'react';

const publishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

// Apple Pay merchant id (iOS only; inert until an Apple Pay merchant id +
// entitlement are registered). Mirrors the app's bundle id.
const APPLE_PAY_MERCHANT_ID = 'merchant.com.olliet97.trackitdown';

export function BountyPaymentProvider({ children }: { children: ReactNode }) {
  // An empty key leaves PaymentSheet init to fail with a surfaced, retryable
  // error (env not set up yet) rather than crashing — the flow is gated on the
  // Stripe setup guide, but the rest of the wizard still runs.
  return (
    <StripeProvider publishableKey={publishableKey} merchantIdentifier={APPLE_PAY_MERCHANT_ID}>
      {/* Fragment so StripeProvider always receives a single ReactElement child
          (its children prop rejects a bare ReactNode). */}
      <>{children}</>
    </StripeProvider>
  );
}
