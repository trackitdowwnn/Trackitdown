/**
 * WHAT:  AppMap — the real react-native-maps surface for LocationPicker's
 *        injected `MapComponent` slot (Google Maps on iOS + Android).
 * WHY:   LocationPicker is deliberately map-SDK-agnostic; this adapter is the
 *        one place react-native-maps is used. It follows the library's
 *        recommended pattern — uncontrolled `initialRegion` + imperative
 *        `animateToRegion` for programmatic fly-tos — so user panning stays
 *        smooth (a fully controlled `region` prop fights the gesture). To
 *        honour LocationPicker's contract that programmatic moves don't
 *        re-fire onRegionChange*, we classify every callback with the
 *        library's `details.isGesture` (real finger on the map vs. our own
 *        animateToRegion) rather than a suppress flag — a flag races when a
 *        gesture interrupts a fly-to and can swallow a genuine user settle.
 *        NOT exported from the ui barrel: it imports the native map SDK, so
 *        consumers import it directly and web resolves AppMap.web.tsx (a
 *        search-only fallback) instead.
 * LINKS: src/shared/ui/LocationPicker.tsx (MapComponentProps);
 *        app.config.ts (Google Maps API keys);
 *        https://docs.expo.dev/versions/v57.0.0/sdk/map-view/.
 *
 * Usage:
 *   import { AppMap } from '@/shared/ui/AppMap';
 *   <LocationPicker MapComponent={AppMap} locationServices={expoLocationServices} />
 */

import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';

import type { MapComponentProps } from './LocationPicker';

/** Below this degree delta we treat two regions as the same point (so a prop
 *  update that merely echoes where the user already panned starts no fly-to). */
const SAME_POINT_EPSILON = 1e-6;

export function AppMap({
  region,
  animateDurationMs,
  onRegionChangeStart,
  onRegionChangeComplete,
}: MapComponentProps) {
  const mapRef = useRef<MapView>(null);
  // The region the map currently shows — lets us tell a prop-driven fly-to
  // apart from where the user already is.
  const shownRef = useRef<Region>(region);
  // Whether we've already announced the current pan's start (once per drag).
  const movingRef = useRef(false);

  // Drive programmatic moves (search pick / locate) imperatively.
  useEffect(() => {
    if (!mapRef.current) {
      return; // map not laid out yet — initialRegion already shows this region
    }
    const dLat = Math.abs(region.latitude - shownRef.current.latitude);
    const dLng = Math.abs(region.longitude - shownRef.current.longitude);
    if (dLat < SAME_POINT_EPSILON && dLng < SAME_POINT_EPSILON) {
      return; // already here (e.g. the map echoing back a user settle)
    }
    shownRef.current = region;
    mapRef.current.animateToRegion(region, Math.max(animateDurationMs, 1));
  }, [region, animateDurationMs]);

  return (
    <MapView
      ref={mapRef}
      provider={PROVIDER_GOOGLE}
      style={StyleSheet.absoluteFill}
      initialRegion={region}
      showsMyLocationButton={false}
      toolbarEnabled={false}
      onRegionChange={(_next, details) => {
        if (!details.isGesture) {
          return; // frames from our own fly-to aren't a user pan
        }
        if (!movingRef.current) {
          movingRef.current = true;
          onRegionChangeStart();
        }
      }}
      onRegionChangeComplete={(next, details) => {
        shownRef.current = next;
        movingRef.current = false;
        if (!details.isGesture) {
          return; // our fly-to (or a layout echo) landed — not a user settle
        }
        onRegionChangeComplete({
          latitude: next.latitude,
          longitude: next.longitude,
          latitudeDelta: next.latitudeDelta,
          longitudeDelta: next.longitudeDelta,
        });
      }}
    />
  );
}
