/**
 * WHAT:  Types owned by the search-map feature — the home feed (sections as
 *        get_home_feed returns them, the flattened FlashList item union, the
 *        resolved feed location) AND the map search (MapPost with exact pin
 *        coordinates, the viewport result, and the marker draw item).
 * WHY:   The feed renders ONE vertical FlashList, so sections must flatten
 *        into a discriminated item union whose `type` doubles as the
 *        FlashList getItemType (recycling pools per row shape). The map
 *        shapes live here too since both surfaces are one feature. Kept out
 *        of shared/ until a second feature needs them, per ARCHITECTURE.md.
 * LINKS: supabase/migrations/20260711130000_home_feed_location_and_rpcs.sql
 *        (RPC JSON shape); src/shared/types/posts.ts (PostSummary);
 *        src/features/search-map/lib/feedSections.ts (flattening).
 */

import type { GeoCoord, PostSummary } from '@/shared/types';

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
/**
 * A setup offer riding between rails rather than stacked above them. `nudge`
 * travels ON the item because a recycled row keeps no state of its own. Named
 * separately so the screen can hold one without widening it to the union.
 */
export interface FeedNudgeItem {
  type: 'nudgeRow';
  key: string;
  /** Which offer. A union of one today — the alert-area offer moved to a root
   *  sheet — but kept named so a second feed offer stays a data change. */
  nudge: 'garage';
}

export type FeedItem =
  | { type: 'sectionHeader'; key: string; section: FeedSection }
  | { type: 'heroCard'; key: string; sectionId: string; post: PostSummary }
  | { type: 'carouselRow'; key: string; section: FeedSection }
  | FeedNudgeItem;

export type FeedItemType = FeedItem['type'];

/** A post with its exact pin location — only ever ACTIVE posts (the
 *  viewport RPC's safety predicate; active locations are public by design). */
export interface MapPost extends PostSummary {
  latitude: number;
  longitude: number;
}

/** What search_posts returns: the sheet-handle total + one page. */
export interface ViewportResult {
  /** ALL matching active posts in the bbox ("23 cars in this area"). */
  total: number;
  posts: MapPost[];
}

/**
 * One marker on the map. Every post in view gets one — clustering was removed
 * on 2026-08-06, so there is no bubble variant; the pill/mini split below does
 * the de-cluttering a cluster used to. `type` is kept as a discriminant so a
 * second marker kind stays a data change rather than a rewrite.
 */
export interface MapPinItem {
  type: 'post';
  key: string;
  post: MapPost;
  /**
   * Position by bounty among the markers in view — 0 is the highest.
   *
   * EVERY marker draws the same £ pill (2026-08-07). This used to pick pill vs
   * price-less dot, and the dot was the mistake: a marker with no price on it
   * reads as a GROUP, because there is nothing else it could be saying. The
   * ranking survives for two jobs where order still matters — paint order under
   * overlap, and which markers stay in the assistive-tech tree.
   */
  rank: number;
  /**
   * Where to DRAW this marker, when that differs from where the car is.
   *
   * Only set by fanOutOverlaps, and only for markers that would otherwise land
   * on top of each other: at a 19km view, cars 150m apart are ~5pt apart under
   * an 18pt marker, so they stack into one mark and only one is tappable.
   * Absent means "draw it at post.latitude/longitude", which is the normal case.
   *
   * ⚠️ NEVER read this for anything but the marker's coordinate. Distance
   * sorting, the card, the sighting wizard and every RPC use post's own
   * coordinates, which stay exact.
   */
  draw?: GeoCoord;
  /**
   * Where the marker's box sits relative to its coordinate, 0..1 on each axis.
   * Absent means centred, which is the normal case.
   *
   * Only set by keepMarkersOnScreen, and only for markers close enough to a
   * viewport edge to be cut in half by it. A clipped £ pill reads as "£1,3…",
   * which is worse than useless — you cannot tell £1,300 from £13,000.
   */
  anchor?: { x: number; y: number };
}
