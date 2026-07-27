/**
 * WHAT:  Route for the post-a-car wizard — a full-screen flow OUTSIDE the
 *        (tabs) group, so the bottom tab bar is absent for the whole wizard.
 *        Wrapped in BountyPaymentProvider so the final step can present Stripe's
 *        PaymentSheet to take the bounty into escrow.
 * WHY:   Route files stay thin (docs/ARCHITECTURE.md rule 3): this imports the
 *        feature screen + the payments provider and nothing else. The provider
 *        is scoped here (not the app root) so Stripe's native module is only
 *        engaged for the flow that charges. Entered from the tab bar's centre
 *        "Report a stolen car" action.
 * LINKS: src/features/vehicles/post/screens/PostACarScreen.tsx;
 *        src/features/payments/BountyPaymentProvider.tsx;
 *        src/app/(tabs)/_layout.tsx (the action that pushes this route).
 */

import { BountyPaymentProvider } from '@/features/payments';
import { PostACarScreen } from '@/features/vehicles/post';

export default function PostACarRoute() {
  return (
    <BountyPaymentProvider>
      <PostACarScreen />
    </BountyPaymentProvider>
  );
}
