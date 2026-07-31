/**
 * WHAT:  derivePlaceLabels — the coarse place labels ("Camden High Street,
 *        London" for the owner, "Camden" for the public face) reverse-geocoded
 *        from the first LOCATED evidence photo.
 * WHY:   The confirm screen says where the report will read as from, and the
 *        server stores both grains. This file owns only the PHOTO part —
 *        picking which photo carries the fix; the geocode and the two-grain
 *        split live in shared/lib/location/placeLabels.ts, because the posting
 *        wizard needs the same public grain for posts.last_seen_locality and
 *        the two must not drift.
 *        Pure best-effort: geocoding failure or an un-located report returns
 *        null — the report is simply "location unavailable" or pin-only.
 * LINKS: src/shared/lib/location/placeLabels.ts (the geocode + grain rules);
 *        src/features/sightings/components/sightingSteps.tsx (photos step
 *        onContinue); src/features/sightings/api/sightingApi.ts (max 120).
 */

import { derivePlaceLabelsForCoord, type PlaceLabels } from '@/shared/lib/location/placeLabels';
import type { EvidencePhoto } from '@/shared/ui';

export type { PlaceLabels };

/** First photo that carries its own fix, if any. */
export function firstLocatedPhoto(photos: EvidencePhoto[]): EvidencePhoto | null {
  return photos.find((photo) => photo.lat !== undefined && photo.lng !== undefined) ?? null;
}

/** Both place grains from ONE reverse-geocode of the first located photo. */
export async function derivePlaceLabels(photos: EvidencePhoto[]): Promise<PlaceLabels> {
  const located = firstLocatedPhoto(photos);
  if (!located) return { areaLabel: null, locality: null };
  return derivePlaceLabelsForCoord({
    latitude: located.lat as number,
    longitude: located.lng as number,
  });
}

/** Back-compat: the owner-facing label only. */
export async function deriveAreaLabel(photos: EvidencePhoto[]): Promise<string | null> {
  return (await derivePlaceLabels(photos)).areaLabel;
}
