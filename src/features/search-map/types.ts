/**
 * WHAT:  Types owned by the search-map feature — the home feed (sections as
 *        get_home_feed returns them, the flattened FlashList item union, the
 *        resolved feed location) AND the map search (MapPost with exact pin
 *        coordinates, the viewport result, and the pin/cluster draw union).
 * WHY:   The feed renders ONE vertical FlashList, so sections must flatten
 *        into a discriminated item union whose `type` doubles as the
 *        FlashList getItemType (recycling pools per row shape). The map
 *        shapes live here too since both surfaces are one feature. Kept out
 *        of shared/ until a second feature needs them, per ARCHITECTURE.md.
 * LINKS: supabase/migrations/20260711130000_home_feed_location_and_rpcs.sql
 *        (RPC JSON shape); src/shared/types/posts.ts (PostSummary);
 *        src/features/search-map/lib/feedSections.ts (flattening).
 */

import type { PostSummary } from '@/shared/types';

export type FeedSectionLayout = 'hero-vertical' | 'carousel';

/** One feed section, as composed server-side by get_home_feed. */
export interface FeedSection {
  /** 'near_you' | 'area_<slug>' | 'highest_bounties' | 'recently_recovered' | 'recent_uk' */
  id: string;
  title: string;
  layout: FeedSectionLayout;
  /** Locality label — present on area carousels only; drives "See all →". */
  area?: string;
  posts: PostSummary[];
}

/** Where the feed is looking. National mode carries no coordinates. */
export type FeedLocation =
  | {
      mode: 'local';
      latitude: number;
      longitude: number;
      /** Human area name for the "Cars near <Area>" header. */
      addressLabel: string;
      radiusMiles: number;
      /** True when this came from the persisted preference (vs a fresh GPS fix). */
      fromPreference: boolean;
    }
  | { mode: 'national' };

/**
 * Flattened FlashList items. `type` is the getItemType key — one recycling
 * pool per row shape. Every field a row renders MUST come from the item
 * itself (recycled rows keep no state).
 */
export type FeedItem =
  | { type: 'sectionHeader'; key: string; section: FeedSection }
  | { type: 'heroCard'; key: string; sectionId: string; post: PostSummary }
  | { type: 'carouselRow'; key: string; section: FeedSection };

export type FeedItemType = FeedItem['type'];

/** A post with its exact pin location — only ever ACTIVE posts (the
 *  viewport RPC's safety predicate; active locations are public by design). */
export interface MapPost extends PostSummary {
  latitude: number;
  longitude: number;
}

/** What get_posts_in_viewport returns: the sheet-handle total + one page. */
export interface ViewportResult {
  /** ALL matching active posts in the bbox ("23 cars in this area"). */
  total: number;
  posts: MapPost[];
}

/** One thing to draw on the map: a bounty pin or a cluster bubble. */
export type MapPinItem =
  | { type: 'post'; key: string; post: MapPost }
  | {
      type: 'cluster';
      key: string;
      clusterId: number;
      count: number;
      latitude: number;
      longitude: number;
    };
