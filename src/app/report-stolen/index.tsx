/**
 * WHAT:  Route for "Which car?" — the chooser shown when someone starts a
 *        report and already has cars saved in their garage.
 * WHY:   Route files stay thin (docs/ARCHITECTURE.md rule 3). It sits beside
 *        report-stolen/[vehicleId] because choosing a car navigates straight
 *        into it — one folder, one journey.
 *
 *        No BountyPaymentProvider here, unlike its sibling: this screen only
 *        picks a car. Stripe's native module is engaged by the screen that
 *        actually charges.
 * LINKS: src/features/garage/screens/ChooseCarToReportScreen.tsx;
 *        src/app/report-stolen/[vehicleId].tsx (where a choice lands);
 *        src/app/(tabs)/_layout.tsx (the action that pushes this route).
 */

import { ChooseCarToReportScreen } from '@/features/garage';

export default ChooseCarToReportScreen;
