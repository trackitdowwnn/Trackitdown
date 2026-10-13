/**
 * WHAT:  Route file for the payout-setup wizard, pushed from Payouts.
 * WHY:   Thin wrapper per docs/ARCHITECTURE.md rule 3 — everything lives in the
 *        payments feature's PayoutSetupScreen.
 *
 *        BountyPaymentProvider for the same reason as /payouts: the send mints
 *        the BANK token with the SDK's createToken, which needs Stripe
 *        initialised; createBankToken awaits it.
 * LINKS: src/features/payments/screens/PayoutSetupScreen.tsx; ./payouts.tsx.
 */

import { BountyPaymentProvider, PayoutSetupScreen } from '@/features/payments';

export default function PayoutSetupRoute() {
  return (
    <BountyPaymentProvider>
      <PayoutSetupScreen />
    </BountyPaymentProvider>
  );
}
