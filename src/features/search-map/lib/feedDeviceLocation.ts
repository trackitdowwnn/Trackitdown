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
    // LAST KNOWN FIRST — the order here is the whole startup cost.
    //
    // This used to await a FRESH fix (capped at 10s) and only fall back to the
    // cached one afterwards. Measured on device 2026-08-11: that blocked first
    // paint for 7.2 SECONDS, against 0.45s for the feed query it was gating and
    // 1.1s to render. Three quarters of the wait was this call, on a phone that
    // already knew roughly where it was.
    //
    // The justification was already written into the old comment: "a
    // minutes-old cached fix sorts a 20-mile feed exactly as well". That is
    // true, and it argues for reading the cache FIRST rather than last. A
    // cached fix is wrong only by however far you have moved since it was
    // taken, and the feed asks about a twenty-mile radius.
    //
    // The fresh fix is not abandoned — it is simply no longer on the critical
    // path. When one lands, useFeedLocation's later resolutions pick it up, and
    // a materially different point refetches; a trivially different one does
    // not, because useHomeFeed quantises the origin. So the cache buys the
    // first paint and accuracy arrives without a second full load.
    try {
      const last = await location.getLastKnownPositionAsync();
      if (last) {
        return { latitude: last.coords.latitude, longitude: last.coords.longitude };
      }
    } catch {
      // Fall through to the fresh fix — a cache read failing is not a reason
      // to give up on locating the user.
    }

    // No cache: this phone has not had a fix since boot, so there is nothing to
    // show but the national feed until GPS answers. The cap stays, because
    // expo-location has no timeout of its own and getCurrentPositionAsync can
    // sit unresolved indefinitely indoors. .catch on the fix itself, not on the
    // race, so a rejection landing after the timeout cannot surface as an
    // unhandled rejection.
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
    return null;
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
