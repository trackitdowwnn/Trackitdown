/**
 * WHAT:  deriveAreaLabel — a coarse, human place label ("Camden High Street,
 *        London") reverse-geocoded from the first LOCATED evidence photo.
 * WHY:   The confirm screen says where the report will read as from, and the
 *        server stores the label as display copy for the owner. Coarse by
 *        construction (street/district level, never a house number) and pure
 *        best-effort: geocoding failure or an un-located report returns null —
 *        the report is simply "location unavailable" or shown by pin only.
 * LINKS: src/features/sightings/components/sightingSteps.tsx (photos step
 *        onContinue); src/features/sightings/api/sightingApi.ts (max 120).
 */

import * as Location from 'expo-location';

import type { EvidencePhoto } from '@/shared/ui';

const MAX_LABEL = 120;

/** First photo that carries its own fix, if any. */
export function firstLocatedPhoto(photos: EvidencePhoto[]): EvidencePhoto | null {
  return photos.find((photo) => photo.lat !== undefined && photo.lng !== undefined) ?? null;
}

export async function deriveAreaLabel(photos: EvidencePhoto[]): Promise<string | null> {
  const located = firstLocatedPhoto(photos);
  if (!located) return null;
  try {
    const results = await Location.reverseGeocodeAsync({
      latitude: located.lat as number,
      longitude: located.lng as number,
    });
    const place = results[0];
    if (!place) return null;
    // Street/district first (what a spotter would say), city as context.
    // Deliberately NO house number — coarse is the point.
    const primary = place.street ?? place.district ?? place.subregion ?? place.city;
    const context = place.city && place.city !== primary ? place.city : null;
    const label = [primary, context].filter(Boolean).join(', ');
    return label ? label.slice(0, MAX_LABEL) : null;
  } catch {
    return null;
  }
}
