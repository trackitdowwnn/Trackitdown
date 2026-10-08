/**
 * WHAT:  Mount it above any screen that can take a payment or mint a Stripe
 *        token (/post-a-car, /report-stolen/[vehicleId], /change-reward,
 *        /payouts). It warms Stripe's native SDK AFTER the screen's transition
 *        has finished, and renders its children untouched.
 * WHY:   Until 2026-10-07 this rendered Stripe's <StripeProvider>, which runs
 *        initStripe on every mount — a native re-initialise (and, the first
 *        time on Android, a Compose view attached on the UI thread) right in
 *        the middle of the report form's slide-up. The provider holds no React context (useStripe calls the
 *        native module directly), so this now defers the init to after the
 *        slide (useAfterTransition) and every Stripe call awaits
 *        ensureStripeReady, so nothing can reach an uninitialised SDK.
 *        Scoped to the routes that charge rather than the app root, so the
 *        native module is only engaged where payments actually happen.
 *        Requires a dev build with the @stripe/stripe-react-native config
 *        plugin (app.config.ts).
 * LINKS: src/features/payments/lib/stripeReady.ts (the one init);
 *        src/shared/hooks/useAfterTransition.ts; src/app/post-a-car.tsx,
 *        src/app/payouts.tsx (mount this); .env.example
 *        (EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY); supabase/functions/README.md
 *        (Stripe setup guide).
 */

import type { ReactNode } from 'react';

import { useAfterTransition } from '@/shared/hooks/useAfterTransition';

import { ensureStripeReady } from './lib/stripeReady';

export function BountyPaymentProvider({ children }: { children: ReactNode }) {
  useAfterTransition(() => {
    // Warm-up only: a failure here is retried by the payment call itself,
    // which awaits ensureStripeReady and surfaces its own error.
    ensureStripeReady().catch(() => {});
  });
  return <>{children}</>;
}
