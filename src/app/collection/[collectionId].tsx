/**
 * WHAT:  Route file for one watchlist collection.
 * WHY:   Thin wrapper per docs/ARCHITECTURE.md rule 3 — all behaviour lives in
 *        the watchlist feature's CollectionScreen. It sits under `collection/`
 *        rather than `watchlist/`: a `watchlist/` directory beside
 *        (tabs)/watchlist.tsx would make the bare `/watchlist` path ambiguous.
 * LINKS: src/features/watchlist/screens/CollectionScreen.tsx;
 *        src/features/watchlist/lib/collectionsModel.ts (the `saved` sentinel).
 */

import { useLocalSearchParams } from 'expo-router';

import { CollectionScreen, collectionIdFromRoute } from '@/features/watchlist';

export default function CollectionRoute() {
  const { collectionId } = useLocalSearchParams<{ collectionId: string }>();
  return <CollectionScreen collectionId={collectionIdFromRoute(collectionId)} />;
}
