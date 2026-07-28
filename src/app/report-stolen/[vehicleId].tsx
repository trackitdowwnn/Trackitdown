/**
 * WHAT:  Route for reporting a SAVED car stolen — the post-a-car wizard with its
 *        vehicle phase prefilled from the garage. Full-screen, outside (tabs).
 * WHY:   Route files stay thin (docs/ARCHITECTURE.md rule 3). Wrapped in
 *        BountyPaymentProvider for the same reason /post-a-car is: this path
 *        ends in Stripe's PaymentSheet taking the bounty into escrow. Scoped
 *        here, not at the app root, so the native module is only engaged by the
 *        flows that charge.
 * LINKS: src/features/garage/screens/ReportSavedCarScreen.tsx;
 *        src/app/post-a-car.tsx (the from-scratch sibling).
 */

import { useLocalSearchParams } from 'expo-router';

import { ReportSavedCarScreen } from '@/features/garage';
import { BountyPaymentProvider } from '@/features/payments';

export default function ReportSavedCarRoute() {
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  return (
    <BountyPaymentProvider>
      <ReportSavedCarScreen vehicleId={vehicleId} />
    </BountyPaymentProvider>
  );
}
