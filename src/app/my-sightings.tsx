/**
 * WHAT:  Route for "My reports" — every sighting the signed-in spotter has
 *        filed, one push from Profile (OUTSIDE the (tabs) group, so no tab bar).
 * WHY:   Route files stay thin (docs/ARCHITECTURE.md rule 3): this imports the
 *        feature screen and nothing else.
 *
 *        It is also the destination of a `sighting_confirmed` push, which is
 *        why the path is stable and takes no parameters — the screen shows the
 *        whole record, so a notification can land here without needing to
 *        resolve which row it was about.
 * LINKS: src/features/sightings/screens/MySightingsScreen.tsx;
 *        src/features/notifications/lib/pushRoute.ts (the push destination);
 *        src/features/profile/screens/ProfileScreen.tsx (the push).
 */

import { MySightingsScreen } from '@/features/sightings';

export default function MySightingsRoute() {
  return <MySightingsScreen />;
}
