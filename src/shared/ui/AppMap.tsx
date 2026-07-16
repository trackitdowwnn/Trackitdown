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

import { useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';

import { mapStyle } from '@/shared/theme';

import type { MapComponentProps } from './LocationPicker';

// The search map renders markers; re-exporting keeps react-native-maps
// imported in exactly one native module (this file). Web resolves the
// AppMap.web.tsx stub instead.
export { Marker as AppMapMarker } from 'react-native-maps';

/** Below this degree delta we treat two regions as the same VIEW (point and
 *  zoom) — a prop update merely echoing where the user already is starts no
 *  fly-to, but a zoom change at the same centre (cluster tap) still animates. */
const SAME_POINT_EPSILON = 1e-6;

export interface AppMapExtraProps {
  /** Markers/overlays (the search map's pins). */
  children?: ReactNode;
  /** Tap on the map background (not a marker) — deselect, close cards. */
  onPress?: () => void;
  /** false = a static preview: all gestures off (pan/zoom/rotate/pitch), so
   *  the map can't be dragged and doesn't fight a parent ScrollView. Default
   *  true (the fully interactive picker/search map). */
  interactive?: boolean;
}

export function AppMap({
  region,
  animateDurationMs,
  onRegionChangeStart,
  onRegionChangeComplete,
  children,
  onPress,
  interactive = true,
}: MapComponentProps & AppMapExtraProps) {
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
    const dSpan = Math.abs(region.latitudeDelta - shownRef.current.latitudeDelta);
    if (dLat < SAME_POINT_EPSILON && dLng < SAME_POINT_EPSILON && dSpan < SAME_POINT_EPSILON) {
      return; // already showing this view (e.g. the map echoing a user settle)
    }
    shownRef.current = region;
    mapRef.current.animateToRegion(region, Math.max(animateDurationMs, 1));
  }, [region, animateDurationMs]);

  return (
    <MapView
      ref={mapRef}
      provider={PROVIDER_GOOGLE}
      // Custom light style harmonised with the cool palette (ADR-0005).
      customMapStyle={mapStyle as unknown as MapView['props']['customMapStyle']}
      style={StyleSheet.absoluteFill}
      initialRegion={region}
      showsMyLocationButton={false}
      toolbarEnabled={false}
      // Static-preview mode (post-detail "Last seen here"): every gesture off
      // so the card can't be panned and doesn't steal the page's scroll.
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      rotateEnabled={interactive}
      pitchEnabled={interactive}
      // Android quirk pair: marker taps ALSO fire the map's onPress (tagged
      // 'marker-press'), which would instantly clear the selection the
      // marker tap just made — and the default marker-press camera recentre
      // fights our own selection→camera logic.
      moveOnMarkerPress={false}
      onPress={(event) => {
        if (event.nativeEvent.action === 'marker-press') {
          return; // not a background tap — the marker handles it
        }
        onPress?.();
      }}
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
    >
      {children}
    </MapView>
  );
}
