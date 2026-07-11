/**
 * WHAT:  Public API of the search-map feature (Explore tab: home feed now,
 *        map search next).
 * WHY:   Other code (route files, later the notifications feature) imports
 *        ONLY from here, never from internal paths — ARCHITECTURE.md rule 1.
 * LINKS: src/features/search-map/README.md.
 */

export { HomeFeedScreen } from './screens/HomeFeedScreen';
export { MapSearchScreen } from './screens/MapSearchScreen';
export type {
  FeedItem,
  FeedItemType,
  FeedLocation,
  FeedSection,
  FeedSectionLayout,
} from './types';
