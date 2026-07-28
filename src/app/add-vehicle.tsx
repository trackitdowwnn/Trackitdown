/**
 * WHAT:  Route for the add-a-car wizard — a full-screen flow OUTSIDE the (tabs)
 *        group, so the bottom tab bar is absent for the whole wizard.
 * WHY:   Route files stay thin (docs/ARCHITECTURE.md rule 3). No payments
 *        provider here, unlike post-a-car: saving a car to the garage charges
 *        nothing and touches no money state.
 * LINKS: src/features/garage/screens/AddVehicleScreen.tsx;
 *        src/features/garage/screens/MyCarsScreen.tsx (the CTA that pushes this).
 */

import { AddVehicleScreen } from '@/features/garage';

export default AddVehicleScreen;
