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
 *
 *        Bounded and remembered (2026-10-08): the posting wizard awaits this
 *        on the map step's Next, and a geocode can hang with no error — the
 *        button spun for as long as the OS liked. Now a lookup gives up
 *        after LOOKUP_TIMEOUT_MS (labels are best-effort anyway), and an
 *        answer is kept per ~10m point, so the map step can warm it the
 *        moment the pin settles and Next usually resolves at once.
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

/** Longest a lookup may take before it settles for "no label". */
export const LOOKUP_TIMEOUT_MS = 4000;
/** Answers kept, newest last — a handful of pins per session at most. */
const CACHE_SIZE = 20;

/** Rounded to 4 decimal places (~10m): a re-settled pin on the same spot
 *  reuses the answer, and two different streets never share one. */
function cacheKey(coord: GeoCoord): string {
  return `${coord.latitude.toFixed(4)},${coord.longitude.toFixed(4)}`;
}

/** Settled answers AND lookups in flight, so a warm-up and the Next that
 *  follows it share one request. A failed or timed-out lookup is dropped
 *  rather than remembered — the next ask tries again. */
const cache = new Map<string, Promise<PlaceLabels>>();

/**
 * Best-effort: a geocoding failure — or one slower than LOOKUP_TIMEOUT_MS —
 * returns nulls rather than throwing, because every caller runs inside a
 * wizard step that must not be blocked by the network. A missing label
 * degrades the copy, never the report.
 */
export function derivePlaceLabelsForCoord(coord: GeoCoord): Promise<PlaceLabels> {
  const key = cacheKey(coord);
  const known = cache.get(key);
  if (known) {
    return known;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS);
  });
  const lookup: Promise<PlaceLabels> = Promise.race([geocode(coord), timeout]).then((labels) => {
    clearTimeout(timer);
    if (labels === null) {
      cache.delete(key); // timed out or failed: ask again next time
      return EMPTY;
    }
    return labels;
  });
  cache.set(key, lookup);
  if (cache.size > CACHE_SIZE) {
    // Map keeps insertion order: the first key is the oldest.
    cache.delete(cache.keys().next().value as string);
  }
  return lookup;
}

/** Start the lookup for a point the owner is likely to continue with (the map
 *  step's settled pin), so its Next finds the answer waiting. */
export function warmPlaceLabels(coord: GeoCoord): void {
  void derivePlaceLabelsForCoord(coord);
}

/** Test-only: forget every remembered answer. */
export function resetPlaceLabelCache(): void {
  cache.clear();
}

/** One reverse-geocode, or null when it failed (never throws). */
async function geocode(coord: GeoCoord): Promise<PlaceLabels | null> {
  try {
    const results = await Location.reverseGeocodeAsync({
      latitude: coord.latitude,
      longitude: coord.longitude,
    });
    const place = results[0];
    // A real answer of "nothing here" (open sea, a remote moor) is still an
    // answer — remembered like any other.
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
    return null;
  }
}

/** The public grain alone, for callers that must never hold the finer one. */
export async function deriveLocalityForCoord(coord: GeoCoord): Promise<string | null> {
  return (await derivePlaceLabelsForCoord(coord)).locality;
}
