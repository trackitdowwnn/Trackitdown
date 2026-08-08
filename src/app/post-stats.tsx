/**
 * WHAT:  Route /post-stats?postId=… — thin wrapper rendering the owner's
 *        activity stats for one of their posts.
 * WHY:   Route files stay thin (ARCHITECTURE.md rule 3). Flat route (not
 *        nested under /post/[id]) for the same reason post-sightings is flat:
 *        it keeps the existing post detail route file untouched.
 * LINKS: src/features/vehicles/screens/PostStatsScreen.tsx.
 */

import { useLocalSearchParams } from 'expo-router';

import { PostStatsScreen } from '@/features/vehicles';

export default function PostStatsRoute() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  return <PostStatsScreen postId={postId} />;
}
