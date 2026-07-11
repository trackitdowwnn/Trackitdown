/**
 * WHAT:  Feature-local device-location adapter for the feed — silent
 *        permission check (no OS prompt), prompting position request, and a
 *        reverse geocode that returns a SHORT area name ("Salford"), not the
 *        shared adapter's full one-line address.
 * WHY:   The feed header says "Cars near <Area>" — a street+postcode label
 *        would be wrong there, so this picks locality-ish fields
 *        (city → district → subregion → region). The silent check matters:
 *        the feed must NEVER cold-fire the OS permission dialog on first
 *        open — the inline primer card asks first, and only its CTA calls
 *        the prompting path. Kept feature-local (not in shared
 *        LocationServices) until a second feature needs an area-level
 *        geocode, per ARCHITECTURE.md.
 * LINKS: src/shared/lib/location/expoLocationServices.ts (lazy-require
 *        pattern this copies); docs/SECURITY_AND_TRUST.md (location is
 *        personal data, opt-in only); Expo v57 SDK location docs.
 */

import type { GeoCoord } from '@/shared/types';

/** Injected into useFeedLocation so the hook is unit-testable. */
export interface FeedDeviceLocation {
  /** Is foreground location ALREADY granted? Never prompts. */
  hasPermission(): Promise<boolean>;
  /** Request permission (may prompt) and read the position; null on denial/failure. */
  getCurrentPosition(): Promise<GeoCoord | null>;
  /** Short area name for a point ("Salford"), or null. */
  reverseGeocodeArea(coord: GeoCoord): Promise<string | null>;
}

interface ExpoLocationModule {
  getForegroundPermissionsAsync(): Promise<{ status: string }>;
  requestForegroundPermissionsAsync(): Promise<{ status: string }>;
  getCurrentPositionAsync(): Promise<{ coords: GeoCoord }>;
  reverseGeocodeAsync(coord: GeoCoord): Promise<
    {
      city?: string | null;
      district?: string | null;
      subregion?: string | null;
      region?: string | null;
    }[]
  >;
}

// Lazy literal require, same rationale as expoLocationServices: side-effect
// free import, statically resolvable, degrades to null where the native
// module can't load.
function loadExpoLocation(): ExpoLocationModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy load
    return require('expo-location') as ExpoLocationModule;
  } catch {
    return null;
  }
}

export const expoFeedDeviceLocation: FeedDeviceLocation = {
  async hasPermission() {
    const location = loadExpoLocation();
    if (!location) return false;
    try {
      const { status } = await location.getForegroundPermissionsAsync();
      return status === 'granted';
    } catch {
      return false;
    }
  },

  async getCurrentPosition() {
    const location = loadExpoLocation();
    if (!location) return null;
    try {
      // SAFETY: never read a position without explicit granted permission.
      const { status } = await location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return null;
      const position = await location.getCurrentPositionAsync();
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
    } catch {
      return null;
    }
  },

  async reverseGeocodeArea(coord) {
    const location = loadExpoLocation();
    if (!location) return null;
    try {
      const [first] = await location.reverseGeocodeAsync(coord);
      if (!first) return null;
      return first.city ?? first.district ?? first.subregion ?? first.region ?? null;
    } catch {
      return null;
    }
  },
};
