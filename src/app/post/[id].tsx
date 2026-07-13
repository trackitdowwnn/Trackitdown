/**
 * WHAT:  Route for the post-detail screen — the app's first dynamic route,
 *        `/post/[id]`. Pushed from VehicleCard everywhere (feed, map, my-cars).
 * WHY:   Thin wrapper per ARCHITECTURE.md — the screen lives in the feature.
 * LINKS: src/features/vehicles/screens/PostDetailScreen.tsx.
 */

import { useLocalSearchParams } from 'expo-router';

import { PostDetailScreen } from '@/features/vehicles';

export default function PostDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PostDetailScreen postId={id} />;
}
