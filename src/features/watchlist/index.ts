/**
 * WHAT:  Public API of the watchlist feature.
 * WHY:   Other code (routes, the tab config, VehicleCard call sites in
 *        other features) imports ONLY from here (docs/ARCHITECTURE.md
 *        rule 1). The store, api, and tombstone row stay internal.
 * LINKS: src/features/watchlist/README.md.
 */

export { WatchToggle } from './components/WatchToggle';
export { CollectionPickerSheet } from './components/CollectionPickerSheet';
export { CollectionsGridScreen } from './screens/CollectionsGridScreen';
export { CollectionScreen, type CollectionScreenProps } from './screens/CollectionScreen';
// The route needs it to turn the `saved` sentinel back into null.
export { collectionIdFromRoute, SAVED_ROUTE_ID } from './lib/collectionsModel';
export { useWatchToggle } from './hooks/useWatchToggle';
export type { CollectionId, WatchlistEntry, WatchToggleSource } from './types';
