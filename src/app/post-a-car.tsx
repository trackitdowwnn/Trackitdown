/**
 * WHAT:  Route for the post-a-car wizard — a full-screen flow OUTSIDE the
 *        (tabs) group, so the bottom tab bar is absent for the whole wizard.
 * WHY:   Route files stay thin (docs/ARCHITECTURE.md rule 3): this imports the
 *        feature screen and nothing else. Entered from the tab bar's centre
 *        "Report a stolen car" action.
 * LINKS: src/features/vehicles/post/screens/PostACarScreen.tsx;
 *        src/app/(tabs)/_layout.tsx (the action that pushes this route).
 */

import { PostACarScreen } from '@/features/vehicles/post';

export default function PostACarRoute() {
  return <PostACarScreen />;
}
