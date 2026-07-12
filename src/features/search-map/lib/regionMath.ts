/**
 * WHAT:  Pure map-region geometry — region↔bbox conversion, the
 *        "moved enough to offer Search-this-area" test, framing a region
 *        around a point-at-radius or a set of posts, and the slippy-map
 *        zoom level a region corresponds to (for clustering).
 * WHY:   The map screen's calm-search model hinges on these numbers being
 *        testable without a map view: results only refresh when the user
 *        explicitly asks, and "has the viewport moved enough to ask?" is a
 *        pure function of two regions. Kept UK-simple on purpose — no
 *        antimeridian handling (matches the viewport RPC's stance).
 * LINKS: src/features/search-map/hooks/useViewportPosts.ts (consumer);
 *        supabase/migrations (get_posts_in_viewport bbox semantics);
 *        src/shared/types/location.ts (GeoRegion).
 */

import type { GeoCoord, GeoRegion } from '@/shared/types';

/** Miles per degree of latitude (constant enough for UK purposes). */
const MILES_PER_DEGREE_LAT = 69;

export interface Bbox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** The bbox a region covers — what get_posts_in_viewport takes. */
export function regionToBbox(region: GeoRegion): Bbox {
  return {
    minLat: region.latitude - region.latitudeDelta / 2,
    maxLat: region.latitude + region.latitudeDelta / 2,
    minLng: region.longitude - region.longitudeDelta / 2,
    maxLng: region.longitude + region.longitudeDelta / 2,
  };
}

/**
 * Has the viewport moved enough that offering "Search this area" makes
 * sense? True when the centre shifted by more than `fraction` of the
 * (smaller) viewport span, or the zoom changed by more than ~40%.
 * Small nudges and momentum drift stay quiet — the calm-map rule.
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

/** A region centred on a point spanning roughly `radiusMiles` each way. */
export function regionAround(coord: GeoCoord, radiusMiles: number): GeoRegion {
  const latitudeDelta = (radiusMiles * 2) / MILES_PER_DEGREE_LAT;
  // Longitude degrees shrink with latitude; correct so the span is
  // roughly square on the ground.
  const longitudeDelta =
    latitudeDelta / Math.max(0.2, Math.cos((coord.latitude * Math.PI) / 180));
  return { ...coord, latitudeDelta, longitudeDelta };
}

/**
 * The tightest region (plus breathing room) containing all coords — used
 * to zoom into a tapped cluster. Falls back to `fallback` when empty.
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

/** Slippy-map zoom level for a region — what supercluster clusters by. */
export function regionZoom(region: GeoRegion): number {
  return Math.round(Math.log2(360 / region.longitudeDelta));
}
