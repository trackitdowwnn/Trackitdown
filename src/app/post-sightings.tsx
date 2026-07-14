/**
 * WHAT:  Route /post-sightings?postId=… — thin wrapper rendering the owner's
 *        read-only sighting list for one of their posts.
 * WHY:   Route files stay thin (ARCHITECTURE.md rule 3). Flat route (not
 *        nested under /post/[id]) to keep the existing post detail route file
 *        untouched.
 * LINKS: src/features/sightings/screens/PostSightingsScreen.tsx.
 */

import { useLocalSearchParams } from 'expo-router';

import { PostSightingsScreen } from '@/features/sightings';

export default function PostSightingsRoute() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  return <PostSightingsScreen postId={postId} />;
}
