/**
 * WHAT:  The real LocationServices adapter, backed by expo-location. Reverse-
 *        and forward-geocoding plus current-position, wired to the shape
 *        LocationPicker injects.
 * WHY:   LocationPicker stays free of native modules; this is where the actual
 *        device/geocoding calls live so they can be swapped (Google Places
 *        later) without touching the UI. `expo-location` is loaded lazily so
 *        merely importing this module has no side effects, and platforms where
 *        the native module cannot load degrade to nulls/empties, never throws.
 * LINKS: src/shared/types/location.ts (contract);
 *        src/shared/ui/LocationPicker.tsx (consumer);
 *        docs/SECURITY_AND_TRUST.md (location is personal data; no tracking).
 */

import type {
  ForwardGeocodeResult,
  GeoCoord,
  LocationServices,
} from '@/shared/types';

/** The slice of expo-location's surface we use — kept minimal and structural. */
interface ExpoLocationModule {
  reverseGeocodeAsync(coord: GeoCoord): Promise<ExpoAddress[]>;
  geocodeAsync(address: string): Promise<GeoCoord[]>;
  requestForegroundPermissionsAsync(): Promise<{ status: string }>;
  getCurrentPositionAsync(): Promise<{ coords: GeoCoord }>;
}

interface ExpoAddress {
  name?: string | null;
  street?: string | null;
  district?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
}

// Lazy, literal require (not a top-of-file import, not a dynamic `import()`):
// literal so tsc/Metro/Jest can all resolve it statically, lazy so importing
// this module stays side-effect free, and try/caught so environments where the
// native module cannot load degrade to null instead of crashing. A non-literal
// `import(MODULE_NAME)` was used while expo-location wasn't yet installed; it
// happened to bundle under Metro (which constant-folds the specifier) but was
// untestable under Jest, whose CJS sandbox rejects native dynamic import.
function loadExpoLocation(): ExpoLocationModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy load, see above
    return require('expo-location') as ExpoLocationModule;
  } catch {
    return null;
  }
}

/** Build a single-line label from an expo-location address, area-first-ish so a
 *  middle ellipsis keeps both the street and the postcode. */
function formatAddress(address: ExpoAddress): string | null {
  const parts = [
    address.name && address.name !== address.street ? address.name : null,
    address.street,
    address.district ?? address.city,
    address.postalCode,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(', ') : null;
}

export const expoLocationServices: LocationServices = {
  async reverseGeocode(coord) {
    const location = loadExpoLocation();
    if (!location) return null;
    try {
      const [first] = await location.reverseGeocodeAsync(coord);
      return first ? formatAddress(first) : null;
    } catch {
      return null;
    }
  },

  async forwardGeocode(query) {
    const location = loadExpoLocation();
    if (!location) return [];
    try {
      // TODO(oliver): expo-location's geocodeAsync returns coordinates only (no
      // address labels), so results are labelled with the raw query. Replace
      // with Google Places Autocomplete for real, distinct suggestions.
      const hits = await location.geocodeAsync(query);
      return hits.map(
        (hit): ForwardGeocodeResult => ({
          latitude: hit.latitude,
          longitude: hit.longitude,
          label: query,
        }),
      );
    } catch {
      return [];
    }
  },

  async getCurrentPosition() {
    const location = loadExpoLocation();
    if (!location) return null;
    try {
      // SAFETY: never read a position without an explicit granted permission
      // (docs/SECURITY_AND_TRUST.md — location is personal data, opt-in only).
      const permission = await location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') return null;
      const position = await location.getCurrentPositionAsync();
      const coord: GeoCoord = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      return coord;
    } catch {
      return null;
    }
  },
};
