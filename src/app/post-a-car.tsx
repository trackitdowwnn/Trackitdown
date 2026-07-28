/**
 * WHAT:  Route for the post-a-car wizard — a full-screen flow OUTSIDE the
 *        (tabs) group, so the bottom tab bar is absent for the whole wizard.
 *        Wrapped in BountyPaymentProvider so the final step can present Stripe's
 *        PaymentSheet to take the bounty into escrow.
 * WHY:   Route files stay thin (docs/ARCHITECTURE.md rule 3): this imports the
 *        feature screen + the payments provider and nothing else. The provider
 *        is scoped here (not the app root) so Stripe's native module is only
 *        engaged for the flow that charges.
 *
 *        This is the BLANK report. Someone with cars in their garage is routed
 *        to /report-stolen first (see src/app/(tabs)/_layout.tsx) and arrives
 *        here only by choosing "It's a different car", so this route never
 *        needs to offer a prefill.
 *
 *        It ALSO wires the garage's exit nudge. Doing it here rather than
 *        inside PostACarScreen is what keeps features/vehicles unaware of the
 *        garage, AND what excludes the from-garage report path:
 *        ReportSavedCarScreen renders the same PostACarScreen but passes no
 *        onAbandon, so someone who already has a saved car is never offered one.
 * LINKS: src/features/vehicles/post/screens/PostACarScreen.tsx;
 *        src/features/payments/BountyPaymentProvider.tsx;
 *        src/features/garage/lib/exitNudgeIntent.ts;
 *        src/app/report-stolen/index.tsx (the chooser that precedes this).
 */

import { requestSaveCarNudge } from '@/features/garage';
import { BountyPaymentProvider } from '@/features/payments';
import { PostACarScreen } from '@/features/vehicles/post';

export default function PostACarRoute() {
  return (
    <BountyPaymentProvider>
      <PostACarScreen onAbandon={requestSaveCarNudge} />
    </BountyPaymentProvider>
  );
}
