/**
 * WHAT:  Route for the "My Posts" page — the owner's own listings, one push from
 *        Profile (OUTSIDE the (tabs) group, so no tab bar).
 * WHY:   Route files stay thin (docs/ARCHITECTURE.md rule 3): this imports the
 *        feature screen and nothing else. Editing a post now lives on the opened
 *        post (per-section pencils), so this list is view + open only.
 * LINKS: src/features/vehicles/screens/MyPostsScreen.tsx;
 *        src/features/profile/screens/ProfileScreen.tsx (the push).
 */

import { MyPostsScreen } from '@/features/vehicles';

export default function MyPostsRoute() {
  return <MyPostsScreen />;
}
