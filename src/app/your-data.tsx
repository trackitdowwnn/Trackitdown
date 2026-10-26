/**
 * WHAT:  Route for "Your data" — the data-export PDF, shown in the app, one
 *        push from Profile's "Download your data" (OUTSIDE the (tabs) group,
 *        so no tab bar).
 * WHY:   Route files stay thin (docs/ARCHITECTURE.md rule 3): this imports the
 *        feature screen and nothing else.
 * LINKS: src/features/profile/screens/YourDataScreen.tsx.
 */

import { YourDataScreen } from '@/features/profile';

export default function YourDataRoute() {
  return <YourDataScreen />;
}
