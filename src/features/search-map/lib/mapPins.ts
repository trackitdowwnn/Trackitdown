/**
 * WHAT:  pinsInView — the posts the search map draws a pill for: the ones
 *        inside the current view, highest bounty first. And pinAt — which
 *        drawn pill a tap landed on (MapPins checks Google's marker pick
 *        against it, because Google's enlarged tap areas pick neighbours).
 * WHY:   CULLING: `result.posts` only refreshes when a search lands (~600ms
 *        behind the gesture), so without it a pan keeps drawing markers the
 *        user has already moved away from. ORDER: a stable mount order, so
 *        identical results never reshuffle. (Paint order is NOT this position
 *        — Android reads zIndex once, at creation, so MapPins derives it from
 *        the bounty itself.) Pure, so it tests without a map.
 * LINKS: src/features/search-map/components/MapPins.tsx (the renderer, and
 *        the press handler that calls pinAt);
 *        src/features/search-map/lib/regionMath.ts (regionToBbox).
 */

import type { GeoRegion } from '@/shared/types';

import type { MapPost } from '../types';
import { regionToBbox } from './regionMath';

/** A no-reward listing has a NULL bounty (ADR-0014); -1 sorts it below every
 *  real one without the NaN a null subtraction would make of the comparator. */
function bountyRank(bountyPence: number | null): number {
  return bountyPence ?? -1;
}

/** One drawn pill on screen: its centre and size in dp, and its paint order. */
export interface PinRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

/** A finger is not a pixel: how far outside a pill a tap may land and still be
 *  that pill's. Small on purpose — this exists to stop taps selecting a
 *  NEIGHBOUR, and generous slop is exactly how that happens. */
export const PIN_TAP_SLOP = 4;

/**
 * The pill under a tap: of those whose drawn rect (plus PIN_TAP_SLOP) contains
 * the point, the one painted on top — that is the pill the user can see
 * there — then the nearest centre. Null when the tap is on no pill at all.
 *
 * WHY: Google Maps decides marker taps with enlarged hit areas and gives an
 * overlap to the top marker, so a tap on one of two close pills often selects
 * the other (react-native-maps#4386). This is the drawn truth instead.
 */
export function pinAt(tap: { x: number; y: number }, pins: PinRect[]): string | null {
  const hits = pins.filter(
    (pin) =>
      Math.abs(tap.x - pin.x) <= pin.width / 2 + PIN_TAP_SLOP &&
      Math.abs(tap.y - pin.y) <= pin.height / 2 + PIN_TAP_SLOP,
  );
  if (hits.length === 0) {
    return null;
  }
  const distance = (pin: PinRect) => Math.hypot(tap.x - pin.x, tap.y - pin.y);
  hits.sort((a, b) => b.zIndex - a.zIndex || distance(a) - distance(b));
  return hits[0].id;
}

/**
 * Every post inside `region`, highest bounty first. Ties break on id so the
 * order never changes between two searches that return the same cars in a
 * different order.
 */
export function pinsInView(posts: MapPost[], region: GeoRegion): MapPost[] {
  const bbox = regionToBbox(region);
  return posts
    .filter(
      (post) =>
        post.latitude >= bbox.minLat &&
        post.latitude <= bbox.maxLat &&
        post.longitude >= bbox.minLng &&
        post.longitude <= bbox.maxLng,
    )
    .sort(
      (a, b) =>
        bountyRank(b.bountyPence) - bountyRank(a.bountyPence) || a.id.localeCompare(b.id),
    );
}
