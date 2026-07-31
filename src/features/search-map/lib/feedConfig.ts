/**
 * WHAT:  Named tuning constants for the home feed — radius bounds/default,
 *        hero page size, area-carousel limits, recovered window.
 * WHY:   One place to tune the feed. Several values MIRROR limits baked into
 *        the get_home_feed / get_nearby_posts RPCs — changing those means a
 *        migration, not just an edit here (each constant says which).
 * LINKS: supabase/migrations/20260711130000_home_feed_location_and_rpcs.sql;
 *        docs/DOMAIN.md (alert radius 1–50 miles; recovered 30-day window).
 */

import { RADIUS_MAX_MILES, RADIUS_MIN_MILES } from '@/shared/lib/distance';

/** Default feed radius when the user hasn't set one. */
export const FEED_RADIUS_DEFAULT_MILES = 20;

/** The intermediate "Widen the area" step between the default and the max. */
export const FEED_RADIUS_WIDEN_STEP_MILES = 35;

/** Radius bounds — the SAME 1–50 range DOMAIN.md fixes for the alert radius,
 *  so they live in shared/lib/distance.ts now that the notifications feature
 *  needs them too. Re-exported under the feed's names so feed call sites read
 *  in feed terms. */
export const FEED_RADIUS_MIN_MILES = RADIUS_MIN_MILES;
export const FEED_RADIUS_MAX_MILES = RADIUS_MAX_MILES;

/** Hero-section page size. Mirrors the RPCs' LIMIT 10 first page. */
export const FEED_PAGE_SIZE = 10;

/** Recovered posts stay publicly visible this long (mirrors the RPC + DOMAIN.md). */
export const RECOVERED_WINDOW_DAYS = 30;

/** Max area carousels / min posts per carousel. Mirrors the RPC (LIMIT 3, HAVING >= 2). */
export const MAX_AREA_CAROUSELS = 3;
export const MIN_POSTS_PER_AREA_CAROUSEL = 2;

/** Geography truth, not tuning — now owned by shared/lib/distance.ts, which
 *  the notifications feature shares. Re-exported so feed call sites are
 *  unchanged. */
export { METRES_PER_MILE, milesToMetres } from '@/shared/lib/distance';
