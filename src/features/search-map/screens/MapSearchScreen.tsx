/**
 * WHAT:  MapSearchScreen — v1 STUB for the map + list search surface. Reads
 *        the { area?, query? } params the feed already sends so every feed
 *        link is wired for real, and says plainly that search is coming.
 * WHY:   The home feed's search pill, Map pill, and "See all →" links need a
 *        live route today; shipping the stub keeps the navigation contract
 *        stable when the real map search replaces this screen's body.
 * LINKS: src/features/search-map/README.md (map search = next iteration);
 *        src/app/search-map.tsx (route).
 */

import { useLocalSearchParams, useRouter } from 'expo-router';

import { EmptyState, Screen } from '@/shared/ui';

export function MapSearchScreen() {
  const router = useRouter();
  const { area, query } = useLocalSearchParams<{ area?: string; query?: string }>();

  const scope = area ? ` for ${area}` : query ? ` for “${query}”` : '';

  return (
    <Screen edges={['top', 'bottom']}>
      <EmptyState
        illustration={null}
        title="Map search is on its way"
        body={`The map and full search${scope} land here in the next update. The home feed already shows active posts near you.`}
        actionLabel="Back to the feed"
        onAction={() => router.back()}
      />
    </Screen>
  );
}
