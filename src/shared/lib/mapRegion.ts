/**
 * WHAT:  Radius → map-region geometry: the viewport that frames a circle of a
 *        given radius around a point.
 * WHY:   Lives in shared/ because TWO callers need it and one of them is
 *        `shared/ui/LocationPicker` — a shared component importing from
 *        `features/search-map` would be backwards (ARCHITECTURE.md: when two
 *        features need the same thing, it belongs in shared/). It started in
 *        the search-map feature, which still re-exports it from `regionMath`
 *        so its five existing call sites read in map-screen terms — the same
 *        arrangement `feedConfig` has with `shared/lib/distance`.
 * LINKS: src/features/search-map/lib/regionMath.ts (re-export + the rest of the
 *        map maths); src/shared/ui/LocationPicker.tsx (fitRadiusMiles);
 *        src/shared/types/location.ts (GeoCoord, GeoRegion).
 */

import type { GeoCoord, GeoRegion } from '@/shared/types';

/** Miles per degree of latitude (constant enough for UK purposes). */
const MILES_PER_DEGREE_LAT = 69;

/**
 * A region centred on a point spanning roughly `radiusMiles` each way.
 *
 * ⚠️ The span is the DIAMETER, so a circle of exactly `radiusMiles` touches the
 * top and bottom viewport edges with nothing to spare. Callers that draw the
 * circle should pass an inflated radius for breathing room (see
 * LocationPicker's CIRCLE_FIT_PADDING) rather than changing this — the map
 * screen's callers depend on the exact-fit behaviour.
 */
export function regionAround(coord: GeoCoord, radiusMiles: number): GeoRegion {
  const latitudeDelta = (radiusMiles * 2) / MILES_PER_DEGREE_LAT;
  // Longitude degrees shrink with latitude; correct so the span is
  // roughly square on the ground.
  const longitudeDelta =
    latitudeDelta / Math.max(0.2, Math.cos((coord.latitude * Math.PI) / 180));
  return { ...coord, latitudeDelta, longitudeDelta };
}
