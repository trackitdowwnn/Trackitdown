/**
 * WHAT:  Public API of the watchlist feature.
 * WHY:   Other code (routes, the tab config, VehicleCard call sites in
 *        other features) imports ONLY from here (docs/ARCHITECTURE.md
 *        rule 1). The store, api, and tombstone row stay internal.
 * LINKS: src/features/watchlist/README.md.
 */

export { WatchToggle } from './components/WatchToggle';
export { WatchlistScreen } from './screens/WatchlistScreen';
export { useWatchToggle } from './hooks/useWatchToggle';
export type { WatchlistEntry, WatchToggleSource } from './types';
