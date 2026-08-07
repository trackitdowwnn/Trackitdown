/**
 * WHAT:  Route for the post-detail screen — the app's first dynamic route,
 *        `/post/[id]`. Pushed from VehicleCard everywhere (feed, map, my-cars).
 * WHY:   Thin wrapper per ARCHITECTURE.md — the screen lives in the feature.
 * LINKS: src/features/vehicles/screens/PostDetailScreen.tsx.
 */

import { useLocalSearchParams } from 'expo-router';

import { useCountPostViewForAlertNudge } from '@/features/notifications/hooks/useCountPostViewForAlertNudge';
import { PostDetailScreen } from '@/features/vehicles';

export default function PostDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Counted HERE rather than inside the screen so features/vehicles never
  // imports features/notifications — the same reason post-a-car.tsx, not the
  // wizard, raises the garage intent. Bumps on unmount; the third raises the
  // alert-area offer, which the root sheet then decides whether to show.
  useCountPostViewForAlertNudge();
  return <PostDetailScreen postId={id} />;
}
