/**
 * WHAT:  Feature-local device-location adapter for the feed — silent
 *        permission check (no OS prompt), a separate prompting request, a
 *        position read that is silent-guarded and time-capped, and a reverse
 *        geocode that returns a SHORT area name ("Salford"), not the shared
 *        adapter's full one-line address.
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
  /**
   * Ask for foreground permission (MAY prompt) and report the answer. Split
   * from getCurrentPosition so the caller learns the ANSWER immediately —
   * the fix that follows can take seconds or never land, and the primer card
   * must retire on the "Allow", not on the coordinates.
   */
  requestPermission(): Promise<boolean>;
  /** Read the position with permission already granted; null on failure. */
  getCurrentPosition(): Promise<GeoCoord | null>;
  /** Short area name for a point ("Salford"), or null. */
  reverseGeocodeArea(coord: GeoCoord): Promise<string | null>;
}

/**
 * How long to wait for a FRESH fix before settling for the last known one.
 * expo-location has no timeout of its own: getCurrentPositionAsync can sit
 * unresolved indefinitely indoors, and everything awaiting it sits there too.
 */
const FRESH_FIX_TIMEOUT_MS = 10_000;

interface ExpoLocationModule {
  getForegroundPermissionsAsync(): Promise<{ status: string }>;
  requestForegroundPermissionsAsync(): Promise<{ status: string }>;
  getCurrentPositionAsync(): Promise<{ coords: GeoCoord }>;
  getLastKnownPositionAsync(): Promise<{ coords: GeoCoord } | null>;
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

  async requestPermission() {
    const location = loadExpoLocation();
    if (!location) return false;
    try {
      const { status } = await location.requestForegroundPermissionsAsync();
      return status === 'granted';
    } catch {
      return false;
    }
  },

  async getCurrentPosition() {
    const location = loadExpoLocation();
    if (!location) return null;
    // SAFETY: never read a position without explicit granted permission. The
    // SILENT check, deliberately — asking is requestPermission's job, and a
    // second request here would re-prompt a user who already said no.
    try {
      const { status } = await location.getForegroundPermissionsAsync();
      if (status !== 'granted') return null;
    } catch {
      return null;
    }
    // A fresh fix first; the LAST KNOWN one as fallback, and a hard cap on the
    // wait. A cold GPS failing, or hanging, right after the first-ever grant is
    // the common case, and it made "I allowed location and nothing changed"
    // literally true — a minutes-old cached fix sorts a 20-mile feed exactly
    // as well. .catch on the fix itself, not on the race, so a rejection that
    // lands after the timeout can't surface as an unhandled rejection.
    const fresh = location.getCurrentPositionAsync().catch(() => null);
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), FRESH_FIX_TIMEOUT_MS);
    });
    const position = await Promise.race([fresh, timeout]);
    if (position) {
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
    }
    try {
      const last = await location.getLastKnownPositionAsync();
      if (!last) return null;
      return { latitude: last.coords.latitude, longitude: last.coords.longitude };
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
