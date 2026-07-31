/**
 * WHAT:  Distance truth — miles↔metres, and the 1–50 mile radius bounds that
 *        DOMAIN.md fixes for both the Explore feed radius and the spotter's
 *        alert radius.
 * WHY:   These are geography and product rules, not per-feature tuning, and
 *        two features now depend on them (search-map's feed radius,
 *        notifications' alert zone). ARCHITECTURE.md: when two features need
 *        the same thing, it belongs in shared/. Keeping one definition also
 *        keeps the client bounds honest against the server, which clamps the
 *        same range in get_home_feed / get_nearby_posts and in
 *        alert_zones_radius_chk.
 * LINKS: src/features/search-map/lib/feedConfig.ts (re-exports these under
 *        its FEED_* names); src/features/notifications/types.ts;
 *        supabase/migrations/20260711130000_home_feed_location_and_rpcs.sql;
 *        docs/DOMAIN.md (alert radius 1–50 miles).
 */

/** Geography truth, not tuning. */
export const METRES_PER_MILE = 1609.344;

/** Radius bounds shared by the feed area and the alert zone (DOMAIN.md). */
export const RADIUS_MIN_MILES = 1;
export const RADIUS_MAX_MILES = 50;

/** Whole metres — the RPCs and `alert_zones.radius_m` take an integer. */
export function milesToMetres(miles: number): number {
  return Math.round(miles * METRES_PER_MILE);
}

export function metresToMiles(metres: number): number {
  return metres / METRES_PER_MILE;
}
