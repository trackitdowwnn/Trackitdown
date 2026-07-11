/**
 * WHAT:  Types owned by the search-map feature — feed sections as the
 *        get_home_feed RPC returns them, the flattened FlashList item union,
 *        and the resolved feed location.
 * WHY:   The feed renders ONE vertical FlashList, so sections must flatten
 *        into a discriminated item union whose `type` doubles as the
 *        FlashList getItemType (recycling pools per row shape). Keeping the
 *        section/location shapes here (not shared/) until a second feature
 *        needs them, per ARCHITECTURE.md.
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
