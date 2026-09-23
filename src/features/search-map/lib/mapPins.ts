/**
 * WHAT:  pinsInView — the posts the search map draws a pill for: the ones
 *        inside the current view, highest bounty first.
 * WHY:   CULLING: `result.posts` only refreshes when a search lands (~600ms
 *        behind the gesture), so without it a pan keeps drawing markers the
 *        user has already moved away from. ORDER: a stable mount order, so
 *        identical results never reshuffle. (Paint order is NOT this position
 *        — Android reads zIndex once, at creation, so MapPins derives it from
 *        the bounty itself.) Pure, so it tests without a map.
 * LINKS: src/features/search-map/components/MapPins.tsx (the renderer);
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
