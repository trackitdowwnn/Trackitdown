/**
 * WHAT:  Route for the post-detail screen — the app's first dynamic route,
 *        `/post/[id]`. Pushed from VehicleCard everywhere (feed, map, my-cars).
 * WHY:   Thin wrapper per ARCHITECTURE.md — the screen lives in the feature.
 * LINKS: src/features/vehicles/screens/PostDetailScreen.tsx;
 *        src/features/search-map/screens/HomeFeedScreen.tsx (the only caller
 *          that passes ?from=feed).
 */

import { useLocalSearchParams } from 'expo-router';

import { useCountPostViewForAlertNudge } from '@/features/notifications/hooks/useCountPostViewForAlertNudge';
import { isBrowsingSource } from '@/shared/lib/browsingSource';
import { PostDetailScreen } from '@/features/vehicles';

export default function PostDetailRoute() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  // Counted HERE rather than inside the screen so features/vehicles never
  // imports features/notifications — the same reason post-a-car.tsx, not the
  // wizard, raises the garage intent. Bumps on unmount; the third raises the
  // alert-area offer, which the root sheet then decides whether to show.
  //
  // ⚠️ ONLY TAPS FROM THE HOME FEED COUNT. This ran on every view, so an owner
  // working through their own listings in My Posts was raising an offer that
  // means "you seem to be watching cars near you" — at someone whose car has
  // just been stolen, which is the worst audience for it (reported 2026-08-22).
  //
  // The signal the offer rests on is BROWSING. Managing your own theft is not
  // that, and neither is arriving from a chat, a watchlist collection or a
  // recovery flow.
  useCountPostViewForAlertNudge(isBrowsingSource(from));
  return <PostDetailScreen postId={id} />;
}
