/**
 * WHAT:  Route for "Delete account" — one push from Profile's Danger zone
 *        (OUTSIDE the (tabs) group, so no tab bar).
 * WHY:   Route files stay thin (docs/ARCHITECTURE.md rule 3): this imports the
 *        feature screen and nothing else.
 * LINKS: src/features/profile/screens/DeleteAccountScreen.tsx.
 */

import { DeleteAccountScreen } from '@/features/profile';

export default function DeleteAccountRoute() {
  return <DeleteAccountScreen />;
}
