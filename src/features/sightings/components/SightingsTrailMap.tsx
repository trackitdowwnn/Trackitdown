/**
 * WHAT:  SightingsTrailMap — the interactive map of a post's sighting trail:
 *        each point a sage pin (newest emphasised), connected oldest→newest
 *        by a primary-ink path, the theft origin as an ink dot. Pins are
 *        tappable only when the caller supplies ids + a handler (the owner
 *        face's tap-through to a sighting's detail).
 * WHY:   The timeline reads the story in time; this reads it in SPACE.
 *        // SAFETY (ADR-0008 + ADR-0009): this component draws WHATEVER
 *        points the caller's face legitimately holds — the fence is the
 *        PAYLOAD, as everywhere: the owner face passes exact capture points
 *        from its own get_post_sightings payload; the public face passes
 *        get_public_sighting_entries' snap_lat/snap_lng, which the server
 *        rounded to a ~1km grid before they left the database. No raw
 *        coordinate can reach a public mount because none arrives. Un-located
 *        sightings aren't on the map; hosts say so honestly in copy where it
 *        matters.
 * LINKS: src/features/sightings/lib/timelineModel.ts (locatedTrail /
 *        trailRegion); components/PostSightingsSection.tsx and
 *        screens/PostSightingsScreen.tsx (hosts); src/shared/ui/AppMap.tsx;
 *        docs/decisions/ADR-0009-public-sighting-map.md.
 */

import { StyleSheet, View } from 'react-native';

import { colors, motion, radii, sizes } from '@/shared/theme';
import { AppMap, AppMapMarker, AppMapPolyline } from '@/shared/ui/AppMap';

import { trailRegion } from '../lib/timelineModel';

/** One point on the trail, OLDEST-FIRST. `id` only on faces that may open a
 *  sighting (the public payload has no ids, so its pins can't be tappable). */
export interface TrailMapPoint {
  id?: string;
  lat: number;
  lng: number;
}

export interface SightingsTrailMapProps {
  /** Trail points in TIME order (oldest → newest). */
  points: TrailMapPoint[];
  /** The theft point, when the host's post payload carries it. */
  origin?: { lat: number; lng: number };
  /** Owner-face tap-through; omitted → pins are display-only. */
  onPinPress?: (sightingId: string) => void;
  /** Map card height; the section preview runs shorter than the full screen. */
  height?: number;
}

export function SightingsTrailMap({
  points,
  origin,
  onPinPress,
  height = sizes.mapPreview,
}: SightingsTrailMapProps) {
  const framed = origin ? [origin, ...points] : points;
  const region = trailRegion(framed);
  if (!region || points.length === 0) return null;

  // The path walks forward in time: origin (when known) → oldest → newest.
  const path = (origin ? [origin, ...points] : points).map((point) => ({
    latitude: point.lat,
    longitude: point.lng,
  }));
  const newestIndex = points.length - 1;

  return (
    <View
      style={[styles.card, { height }]}
      // One labelled block; descendants (incl. pin taps) hidden from screen
      // readers — the fully-labelled timeline beside it is the complete,
      // accessible route to every sighting (incl. un-located ones).
      accessible
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      accessibilityLabel={`Map of ${points.length} located ${
        points.length === 1 ? 'sighting' : 'sightings'
      }${origin ? ' and where the car was reported stolen' : ''}. The timeline lists every sighting.`}
    >
      <AppMap
        region={region}
        animateDurationMs={motion.mapPan}
        onRegionChangeStart={() => {}}
        onRegionChangeComplete={() => {}}
      >
        {path.length > 1 ? (
          // The rail, in space — same stroke token as the timeline's line.
          <AppMapPolyline
            coordinates={path}
            strokeColor={colors.primary}
            strokeWidth={sizes.timelineRailStroke}
          />
        ) : null}
        {origin ? (
          <AppMapMarker
            coordinate={{ latitude: origin.lat, longitude: origin.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
          >
            <View style={styles.originPin} />
          </AppMapMarker>
        ) : null}
        {points.map((point, index) => {
          const newest = index === newestIndex;
          const pressable = Boolean(onPinPress && point.id);
          return (
            <AppMapMarker
              key={point.id ?? `snap-${index}`}
              coordinate={{ latitude: point.lat, longitude: point.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              onPress={pressable ? () => onPinPress?.(point.id as string) : undefined}
            >
              {/* A marker's tap area IS its child's bounds — pressable pins
                  pad the drawn dot up to the 44pt target (sliderThumb rule). */}
              <View style={pressable ? styles.pinTarget : undefined}>
                <View style={[styles.pin, newest && styles.pinNewest]} />
              </View>
            </AppMapMarker>
          );
        })}
      </AppMap>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: colors.surfaceSubtle,
  },
  // Invisible 44pt tap pad centring the drawn pin (DESIGN_SYSTEM touch rule).
  pinTarget: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The timeline's node language, map-sized: sage evidence dots on white
  // rings (the DESIGN_SYSTEM sage sanction names this map as the same arc).
  pin: {
    width: sizes.mapPin,
    height: sizes.mapPin,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    borderWidth: sizes.mapPinRing,
    borderColor: colors.success,
  },
  pinNewest: {
    width: sizes.mapPinNewest,
    height: sizes.mapPinNewest,
    backgroundColor: colors.success,
    borderColor: colors.surface,
  },
  // The theft origin: primary INK, unlike the timeline's quiet grey flag —
  // deliberate: a surfaceSubtle dot vanishes on the map canvas. Not a
  // consistency bug.
  originPin: {
    width: sizes.mapPinOrigin,
    height: sizes.mapPinOrigin,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    borderWidth: sizes.mapPinRing,
    borderColor: colors.surface,
  },
});
