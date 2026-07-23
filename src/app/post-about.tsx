/**
 * WHAT:  Route /post-about?postId=… — thin wrapper for the full "About this
 *        car" prose page (the detail page's "Show more").
 * WHY:   Route files stay thin (ARCHITECTURE.md rule 3). Flat route, matching
 *        the /post-sightings pattern.
 * LINKS: src/features/vehicles/screens/PostAboutScreen.tsx.
 */

import { useLocalSearchParams } from 'expo-router';

import { PostAboutScreen } from '@/features/vehicles';

export default function PostAboutRoute() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  return <PostAboutScreen postId={postId} />;
}
