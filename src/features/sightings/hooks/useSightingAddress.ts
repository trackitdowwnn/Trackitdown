/**
 * WHAT:  useSightingAddress — the street address of the point a sighting was
 *        captured at ("Shenley Rd, Hemel Hempstead, HP2 7RJ"), for the owner's
 *        "Where" section; until it arrives, or if it can't be had, the
 *        sighting's stored area ("Shenley Road, Hemel Hempstead").
 * WHY:   The owner asked for the address under "Where", as the listing page
 *        shows one (2026-10-20), and picked the FULL address from the pin:
 *        the stored area is street + town with no postcode, and the page's
 *        title already says it. Looked up through the device (expo-location's
 *        reverse geocode, the same call the listing's last-seen picker uses):
 *        the point goes to the OS geocoder (Google on Android, Apple on iOS)
 *        and nowhere else — nothing is stored, logged or sent to us. The page
 *        is owner-only and already shows the exact point on its map
 *        (SECURITY_AND_TRUST §3).
 *
 *        Best-effort, like every place label in the app: a lookup slower than
 *        LOOKUP_TIMEOUT_MS, or one that fails, keeps the fallback.
 *        ⚠️ AN ADDRESS IS KEPT WITH THE POINT IT CAME FROM and shown only for
 *        that point — a reused screen must never show the last sighting's
 *        street under this one's map.
 * LINKS: src/features/sightings/screens/SightingDetailScreen.tsx;
 *        src/shared/lib/location/expoLocationServices.ts (reverseGeocode);
 *        src/shared/lib/location/placeLabels.ts (LOOKUP_TIMEOUT_MS).
 */

import { useEffect, useState } from 'react';

import { expoLocationServices } from '@/shared/lib/location/expoLocationServices';
import { LOOKUP_TIMEOUT_MS } from '@/shared/lib/location/placeLabels';

/** A point on the map — the sighting's first located photo. */
export interface SightingPoint {
  lat: number;
  lng: number;
}

/** The device lookup, injectable for tests. */
export type ReverseGeocode = (coord: {
  latitude: number;
  longitude: number;
}) => Promise<string | null>;

const deviceReverseGeocode: ReverseGeocode = (coord) => expoLocationServices.reverseGeocode(coord);

/**
 * The point's street address, else `fallback` — see the header.
 *
 * `reverseGeocode` exists for tests; the screen never passes it.
 */
export function useSightingAddress(
  point: SightingPoint | null,
  fallback: string | null,
  reverseGeocode: ReverseGeocode = deviceReverseGeocode,
): string | null {
  const lat = point?.lat ?? null;
  const lng = point?.lng ?? null;
  const key = lat !== null && lng !== null ? `${lat},${lng}` : null;
  const [found, setFound] = useState<{ key: string; address: string | null } | null>(null);

  useEffect(() => {
    if (lat === null || lng === null) return undefined;
    const forKey = `${lat},${lng}`;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS);
    });
    void Promise.race([
      reverseGeocode({ latitude: lat, longitude: lng }).catch(() => null),
      timeout,
    ]).then((address) => {
      clearTimeout(timer); // settled — no timeout left running
      if (!cancelled) setFound({ key: forKey, address });
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [lat, lng, reverseGeocode]);

  const address = found !== null && found.key === key ? found.address : null;
  return address ?? fallback;
}
