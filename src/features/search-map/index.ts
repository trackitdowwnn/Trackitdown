/**
 * WHAT:  Public API of the search-map feature (Explore tab: the home feed
 *        and the map search).
 * WHY:   Other code (route files, later the notifications feature) imports
 *        ONLY from here, never from internal paths — ARCHITECTURE.md rule 1.
 * LINKS: src/features/search-map/README.md.
 */

export { HomeFeedScreen } from './screens/HomeFeedScreen';
export { MapSearchScreen } from './screens/MapSearchScreen';
// The one data export: the post-detail "More stolen cars nearby" rail reuses
// the home-feed RPC centred on a post's last-seen point (vehicles feature).
export { fetchHomeFeed } from './api/feedApi';
export type {
  FeedItem,
  FeedItemType,
  FeedLocation,
  FeedSection,
  FeedSectionLayout,
} from './types';
