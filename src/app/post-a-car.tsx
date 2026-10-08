/**
 * WHAT:  Route for reporting a stolen car — THE destination of the + button,
 *        a full-screen flow OUTSIDE the (tabs) group (no tab bar), sliding up
 *        from the bottom. Wrapped in BountyPaymentProvider so the final step
 *        can present Stripe's PaymentSheet to take the bounty into escrow.
 * WHY:   Route files stay thin (docs/ARCHITECTURE.md rule 3): this imports the
 *        feature screen + the payments provider and nothing else. The provider
 *        is scoped here (not the app root) so Stripe's native module is only
 *        engaged for the flows that charge.
 *
 *        Since 2026-10-07 this one route covers EVERY way into a report: the
 *        host screen shows the blank form, the "Which car?" chooser or the
 *        prefilled form in place, so the + button is one slide up, never a
 *        chooser route that then replaced itself with this one. The garage's
 *        exit nudge is wired inside the host, on the blank form only.
 * LINKS: src/features/garage/screens/StartReportScreen.tsx (the host);
 *        src/features/garage/hooks/useStartReport.ts (the + button);
 *        src/features/payments/BountyPaymentProvider.tsx;
 *        src/app/report-stolen/[vehicleId].tsx (the /my-cars entry).
 */

import { StartReportScreen } from '@/features/garage';
import { BountyPaymentProvider } from '@/features/payments';

export default function PostACarRoute() {
  return (
    <BountyPaymentProvider>
      <StartReportScreen />
    </BountyPaymentProvider>
  );
}
