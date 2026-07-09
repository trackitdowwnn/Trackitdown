/**
 * WHAT:  Shared geo/location data types and the injectable LocationServices
 *        contract used by the map-picker UI.
 * WHY:   LocationPicker deliberately does NOT import a map SDK or
 *        `expo-location`; geocoding + current-position come in through the
 *        LocationServices interface, and the real adapter lives in
 *        src/shared/lib/location. Keeping the pure types here (not in the UI
 *        barrel) lets that lib adapter and the UI both depend on them without
 *        a lib -> ui import cycle.
 * LINKS: src/shared/ui/LocationPicker.tsx (consumer),
 *        src/shared/lib/location/expoLocationServices.ts (real adapter),
 *        docs/SECURITY_AND_TRUST.md (location is personal data).
 */

/** A point on the earth. */
export interface GeoCoord {
  latitude: number;
  longitude: number;
}

/** A map viewport: a centre point plus the visible span in degrees. */
export interface GeoRegion extends GeoCoord {
  latitudeDelta: number;
  longitudeDelta: number;
}

/** One forward-geocoding (search) hit: a point with a human label to show. */
export interface ForwardGeocodeResult extends GeoCoord {
  label: string;
}

/**
 * The side-effecting location capabilities LocationPicker needs, injected so
 * the component stays free of native modules (fully unit-testable) and the
 * backing implementation (expo-location today, Google Places later) can change
 * without touching the UI.
 */
export interface LocationServices {
  /** Human address for a point, or null if none could be resolved. */
  reverseGeocode(coord: GeoCoord): Promise<string | null>;
  /** Search: points matching a free-text query (empty array if none). */
  forwardGeocode(query: string): Promise<ForwardGeocodeResult[]>;
  /**
   * The device's current position, or null when unavailable. Implementations
   * request permission internally and MUST resolve null (never throw) when the
   * user declines — a denied prompt should degrade, not crash the picker.
   */
  getCurrentPosition(): Promise<GeoCoord | null>;
}

/**
 * The value LocationPicker emits and a wizard stores in its answers object.
 * `isSettled` is the validity gate: false until the user has actually chosen a
 * point (panned, searched, or located), so a never-touched default map cannot
 * be submitted. `addressLabel` may be '' even when settled (geocode failed or
 * was skipped) — the coordinates are still valid.
 */
export interface LocationValue {
  latitude: number;
  longitude: number;
  addressLabel: string;
  isSettled: boolean;
}
