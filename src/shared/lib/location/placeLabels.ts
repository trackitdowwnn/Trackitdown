/**
 * WHAT:  Reverse-geocode ONE point into the app's two place grains: a
 *        street/district-first `areaLabel` for owner-facing copy, and a
 *        district/city-only `locality` for anything public.
 * WHY:   The two-grain split is a safety rule, not a formatting preference
 *        (ADR-0008): a street name identifies a home, a district does not.
 *        It lives in shared/ because two features now need it — sightings
 *        derives both grains from an evidence photo's fix, and the posting
 *        wizard needs the locality for `posts.last_seen_locality`, which is
 *        what a spotter-alert push is allowed to say. One implementation
 *        means the public grain can't drift apart between them.
 *        // SAFETY: `locality` deliberately EXCLUDES `street`. Widening this
 *        fallback chain leaks a street onto a public timeline entry and into
 *        every alert push within 50 miles.
 * LINKS: src/features/sightings/lib/areaLabel.ts (photo-based caller);
 *        src/features/vehicles/post/postACarFlow.tsx (posting wizard);
 *        supabase/migrations/20260802110000_post_alert_columns.sql;
 *        docs/decisions/ADR-0008 (public sighting face).
 */

import * as Location from 'expo-location';

import type { GeoCoord } from '@/shared/types/location';

/** Owner-facing labels run longer than the public ones; both mirror the
 *  column CHECKs (sightings.area_label ≤ 120, posts.last_seen_locality ≤ 80). */
const MAX_LABEL = 120;
const MAX_LOCALITY = 80;

/** Both place grains from ONE reverse-geocode. */
export interface PlaceLabels {
  /** Street/district-first, owner-facing ("Camden High Street, London"). */
  areaLabel: string | null;
  /** District/city grain ONLY — the public-facing coarse place (ADR-0008). */
  locality: string | null;
}

const EMPTY: PlaceLabels = { areaLabel: null, locality: null };

/**
 * Best-effort: a geocoding failure returns nulls rather than throwing, because
 * every caller runs inside a wizard step that must not be blocked by the
 * network. A missing label degrades the copy, never the report.
 */
export async function derivePlaceLabelsForCoord(coord: GeoCoord): Promise<PlaceLabels> {
  try {
    const results = await Location.reverseGeocodeAsync({
      latitude: coord.latitude,
      longitude: coord.longitude,
    });
    const place = results[0];
    if (!place) return EMPTY;
    // Street/district first (what a spotter would say), city as context.
    // Deliberately NO house number — coarse is the point.
    const primary = place.street ?? place.district ?? place.subregion ?? place.city;
    const context = place.city && place.city !== primary ? place.city : null;
    const label = [primary, context].filter(Boolean).join(', ');
    // SAFETY: no `street` in this chain. See the header.
    const locality = place.district ?? place.city ?? place.subregion ?? null;
    return {
      areaLabel: label ? label.slice(0, MAX_LABEL) : null,
      locality: locality ? locality.slice(0, MAX_LOCALITY) : null,
    };
  } catch {
    return EMPTY;
  }
}

/** The public grain alone, for callers that must never hold the finer one. */
export async function deriveLocalityForCoord(coord: GeoCoord): Promise<string | null> {
  return (await derivePlaceLabelsForCoord(coord)).locality;
}
