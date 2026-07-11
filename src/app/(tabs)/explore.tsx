/**
 * WHAT:  Explore tab route — the home feed (features/search-map).
 * WHY:   Thin wrapper per ARCHITECTURE.md — screens live in features.
 * LINKS: src/features/search-map/screens/HomeFeedScreen.tsx.
 */

import { HomeFeedScreen } from '@/features/search-map';

export default function ExploreRoute() {
  return <HomeFeedScreen />;
}
