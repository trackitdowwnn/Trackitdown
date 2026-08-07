/**
 * WHAT:  Pure map-region geometry — region↔bbox conversion, the
 *        "moved enough to re-search" test, camera insets for the chrome
 *        floating over the map, framing a region around a point-at-radius or a
 *        set of posts, haversine distance (peek-card ordering), and the
 *        "comfortably visible" test (pan-only-when-needed camera rule).
 * WHY:   The map's behaviour hinges on these numbers being testable without a
 *        map view: "has the viewport moved enough to re-search?" and "would
 *        framing this land it behind the sheet?" are both pure functions of
 *        regions. Kept UK-simple on purpose — no antimeridian handling
 *        (matches the viewport RPC's stance).
 * LINKS: src/features/search-map/hooks/useViewportPosts.ts (consumer);
 *        supabase/migrations (search_posts bbox semantics);
 *        src/shared/types/location.ts (GeoRegion).
 */

import { regionAround } from '@/shared/lib/mapRegion';
import type { GeoCoord, GeoRegion } from '@/shared/types';

/** Framing a circle by radius now lives in shared/ — `shared/ui/LocationPicker`
 *  needs it too, and a shared component cannot import from a feature. Imported
 *  above (entryFrame uses it) and re-exported here so this feature's call sites
 *  keep reading in map-screen terms. */
export { regionAround };

export interface Bbox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** The bbox a region covers — what search_posts takes. */
export function regionToBbox(region: GeoRegion): Bbox {
  return {
    minLat: region.latitude - region.latitudeDelta / 2,
    maxLat: region.latitude + region.latitudeDelta / 2,
    minLng: region.longitude - region.longitudeDelta / 2,
    maxLng: region.longitude + region.longitudeDelta / 2,
  };
}

/**
 * Has the viewport moved enough to be worth re-searching? True when the
 * centre shifted by more than `fraction` of the (smaller) viewport span, or
 * the zoom changed by more than ~40%.
 *
 * This is the FIRST of the three brakes on auto-search (the other two are the
 * debounce and the pause-while-a-card-is-open): a nudge, a momentum tail or a
 * thumb resting on the map must never cost a request.
 */
export function movedEnough(
  searched: GeoRegion,
  current: GeoRegion,
  fraction = 0.3,
): boolean {
  const spanLat = Math.min(searched.latitudeDelta, current.latitudeDelta);
  const spanLng = Math.min(searched.longitudeDelta, current.longitudeDelta);
  const centreMoved =
    Math.abs(current.latitude - searched.latitude) > spanLat * fraction ||
    Math.abs(current.longitude - searched.longitude) > spanLng * fraction;
  const zoomChanged =
    current.latitudeDelta > searched.latitudeDelta * 1.4 ||
    current.latitudeDelta < searched.latitudeDelta / 1.4;
  return centreMoved || zoomChanged;
}

/**
 * The tightest region (plus breathing room) containing all coords — the map's
 * opening frame around the results it just loaded. Falls back to `fallback`
 * when empty, because framing nothing would zoom to a point.
 */
export function frameCoords(coords: GeoCoord[], fallback: GeoRegion): GeoRegion {
  if (coords.length === 0) {
    return fallback;
  }
  const lats = coords.map((c) => c.latitude);
  const lngs = coords.map((c) => c.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  // 40% padding so edge pins don't hug the screen border; minimum spans
  // keep a single-point "cluster" from zooming in absurdly far.
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.4, 0.01),
    longitudeDelta: Math.max((maxLng - minLng) * 1.4, 0.01),
  };
}

/**
 * The widest the map may OPEN, as a radius in miles.
 *
 * WHY: framing every result is honest about where the cars are and useless to
 * look at. Posts scattered nationwide force a ~64km view, which is ~100 metres
 * of ground per screen point — so two cars 800m apart are drawn 8pt apart while
 * the marker itself is 18pt wide. They overlap, their shadows compound, and a
 * knot of three reads as one black blob you have to zoom into. That is what
 * clustering used to hide; with clustering gone (owner's call, 2026-08-06) the
 * only remaining defence is to not open that far out in the first place.
 *
 * A RADIUS, so six here is a twelve-mile span ≈ 19km, ≈ 30 m/pt on a ~640pt
 * map band: the same 800m gap now draws ~27pt apart, comfortably clear of the
 * 18pt marker. Chosen as the widest opening at which two nearby cars still
 * read as two markers rather than one mass.
 */
export const MAX_ENTRY_RADIUS_MILES = 6;

/**
 * Where the map should OPEN once the first results land: framed on the cars
 * near the entry point, never wider than MAX_ENTRY_RADIUS_MILES.
 *
 * Three cases, in order:
 *   1. Results inside the cap — frame those (frameCoords' 40% padding applies).
 *   2. Results, but all further out — centre on the NEAREST one at the cap,
 *      so the map opens on cars rather than on empty ground it happens to
 *      know about. Panning out from there is one gesture; finding the only
 *      pin in a national view is not.
 *   3. No results at all — the entry region unchanged. Framing nothing would
 *      zoom to a point.
 *
 * The cap is applied to the RESULT too, not just the candidate set: three cars
 * at opposite edges of the radius still span more than it once padded.
 */
export function entryFrame(coords: GeoCoord[], entry: GeoRegion): GeoRegion {
  if (coords.length === 0) {
    return entry;
  }
  const centre: GeoCoord = { latitude: entry.latitude, longitude: entry.longitude };
  const near = coords.filter(
    (c) => metersToMiles(distanceMeters(centre, c)) <= MAX_ENTRY_RADIUS_MILES,
  );
  if (near.length === 0) {
    const nearest = coords.reduce((best, c) =>
      distanceMeters(centre, c) < distanceMeters(centre, best) ? c : best,
    );
    return regionAround(nearest, MAX_ENTRY_RADIUS_MILES);
  }
  const framed = frameCoords(near, entry);
  const cap = regionAround(framed, MAX_ENTRY_RADIUS_MILES);
  return {
    ...framed,
    latitudeDelta: Math.min(framed.latitudeDelta, cap.latitudeDelta),
    longitudeDelta: Math.min(framed.longitudeDelta, cap.longitudeDelta),
  };
}

/**
 * How much of the map's HEIGHT is covered by floating chrome — the top bar
 * above, the resting sheet or the card pager below. Fractions of the map rect
 * (0..1), never pixels, so this math is platform-independent and testable
 * without a map view.
 *
 * WHY NOT react-native-maps' `mapPadding`: it changes what
 * onRegionChangeComplete REPORTS, and differently per platform (Android derives
 * the region from a padding-aware getVisibleRegion(), iOS from mapView.region).
 * The map screen feeds that reported region into the search bbox, the pin slice
 * and movedEnough simultaneously — a platform divergence there would mean the
 * area we search differs from the area drawn, on one OS only. Doing it in JS
 * keeps exactly one meaning of "region" everywhere: the full map rect.
 */
export interface MapInsets {
  top: number;
  bottom: number;
}

/** No chrome — the identity inset. */
export const NO_INSETS: MapInsets = { top: 0, bottom: 0 };

/**
 * The fraction of the map still visible, FLOORED. Chrome taller than the map
 * is not a real layout, but it is reachable — a measured card at large text on
 * a short screen — and without the floor `cameraForVisible` divides by zero or
 * a negative and hands the map a NaN or inverted camera.
 */
function visibleFractionOf(insets: MapInsets): number {
  return Math.max(1 - insets.top - insets.bottom, 0.2);
}

/**
 * The slice of `region` the user can actually SEE, given chrome over it.
 * Latitude increases up-screen, so a top inset removes the northernmost band
 * and pushes the visible centre south.
 */
export function visibleRegion(region: GeoRegion, insets: MapInsets): GeoRegion {
  const visibleFraction = visibleFractionOf(insets);
  return {
    latitude: region.latitude + ((insets.bottom - insets.top) * region.latitudeDelta) / 2,
    longitude: region.longitude,
    latitudeDelta: region.latitudeDelta * visibleFraction,
    longitudeDelta: region.longitudeDelta,
  };
}

/**
 * The exact inverse: the camera to set so `target` fills the VISIBLE band
 * rather than the whole map rect. Use at every fly-to, or the thing you framed
 * lands under the sheet.
 */
export function cameraForVisible(target: GeoRegion, insets: MapInsets): GeoRegion {
  const visibleFraction = visibleFractionOf(insets);
  const latitudeDelta = target.latitudeDelta / visibleFraction;
  return {
    latitude: target.latitude - ((insets.bottom - insets.top) * latitudeDelta) / 2,
    longitude: target.longitude,
    latitudeDelta,
    longitudeDelta: target.longitudeDelta,
  };
}

/** The centre of what the user can see — the honest anchor for "nearest first". */
export function visibleCentre(region: GeoRegion, insets: MapInsets): GeoCoord {
  const visible = visibleRegion(region, insets);
  return { latitude: visible.latitude, longitude: visible.longitude };
}

/** Mean Earth radius (metres) for the haversine below. */
const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres — orders the peek-card pager. */
export function distanceMeters(a: GeoCoord, b: GeoCoord): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

const METERS_PER_MILE = 1609.344;

/** Metres → miles (the card's distance line speaks miles, UK-style). */
export function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE;
}

/**
 * Is a coordinate "comfortably" inside a region — far enough from every
 * edge that panning to it would be gratuitous? The region is shrunk by
 * `margin` of its span per edge; a pin inside the shrunk box needs no
 * camera move (the calm-map rule applied to the peek-card pager).
 */
export function isComfortablyVisible(
  coord: GeoCoord,
  region: GeoRegion,
  margin = 0.15,
): boolean {
  const halfLat = (region.latitudeDelta / 2) * (1 - margin * 2);
  const halfLng = (region.longitudeDelta / 2) * (1 - margin * 2);
  return (
    Math.abs(coord.latitude - region.latitude) <= halfLat &&
    Math.abs(coord.longitude - region.longitude) <= halfLng
  );
}
