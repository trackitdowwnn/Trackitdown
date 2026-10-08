/**
 * WHAT:  "Where" on the owner's sighting page: the exact captured point on a
 *        non-interactive map card, an "Approximate — within about N m" line
 *        when the phone's fix was rough, the safety notice, and — below it —
 *        the quiet "Open in Maps" link. Or one line saying the location
 *        couldn't be captured (the notice still shows).
 * WHY:   The owner needs to know HOW SURE the point is before acting on it,
 *        and used to get a pin with no word on its accuracy (the field was
 *        loaded and never shown). Precision is right here: this is an
 *        owner-only surface; the public face never sees coordinates.
 *
 *        ⚠️ THE NOTICE SITS WITH THE POINT, AND THE LINK BELOW THE NOTICE
 *        (SECURITY_AND_TRUST "Open in Maps"; review of #145). The exact spot
 *        is where an owner is most tempted to act; a notice several sections
 *        further down did not stand beside it. "Open in Maps" stays quiet and
 *        behind the screen's confirm (which repeats the notice): a pin, never
 *        directions — §1 bans pursuit features.
 * LINKS: src/features/sightings/screens/SightingDetailScreen.tsx;
 *        src/shared/ui/AppMap.tsx; src/shared/ui/SafetyNotice.tsx;
 *        docs/SECURITY_AND_TRUST.md.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  motion,
  opacity,
  radii,
  sizes,
  spacing,
  typography,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { SafetyNotice } from '@/shared/ui';
import { AppMap, AppMapMarker } from '@/shared/ui/AppMap';

/** Same ~1.4-mile preview span as the post page's last-seen map. */
const PREVIEW_DELTA = 0.02;
/** Past this, the fix is rough enough to say so (metres). */
const APPROXIMATE_FROM_M = 50;

export interface SightingWhereSectionProps {
  /** The first photo that carried a location, or null. */
  point: { lat: number; lng: number; accuracyM: number | null } | null;
  /** The area, for the map's spoken label. */
  areaLabel: string | null;
  onOpenMaps: () => void;
}

/** "Approximate — within about 120 m": rounded, because a number to the metre
 *  promises a precision the fix doesn't have. Null when the fix is good. */
export function approximateLine(accuracyM: number | null): string | null {
  if (accuracyM === null || accuracyM <= APPROXIMATE_FROM_M) return null;
  const rounded =
    accuracyM < 1000 ? Math.round(accuracyM / 10) * 10 : Math.round(accuracyM / 100) * 100;
  return `Approximate — within about ${rounded.toLocaleString('en-GB')} m`;
}

/** The map, how exact it is, the notice and Open in Maps — see the header. */
export function SightingWhereSection({ point, areaLabel, onOpenMaps }: SightingWhereSectionProps) {
  const styles = useThemedStyles(makeStyles);

  if (!point) {
    return (
      <View style={styles.root}>
        <Text style={styles.missing}>Location couldn’t be captured for this sighting.</Text>
        <SafetyNotice />
      </View>
    );
  }

  const approximate = approximateLine(point.accuracyM);
  return (
    <View style={styles.root}>
      <View
        style={styles.mapCard}
        accessible
        accessibilityRole="image"
        accessibilityLabel={
          areaLabel
            ? `Map of where the car was seen, near ${areaLabel}`
            : 'Map of where the car was seen'
        }
        testID="sighting-map"
      >
        <AppMap
          interactive={false}
          region={{
            latitude: point.lat,
            longitude: point.lng,
            latitudeDelta: PREVIEW_DELTA,
            longitudeDelta: PREVIEW_DELTA,
          }}
          animateDurationMs={motion.mapPan}
          onRegionChangeStart={() => {}}
          onRegionChangeComplete={() => {}}
        >
          <AppMapMarker
            coordinate={{ latitude: point.lat, longitude: point.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.pin} />
          </AppMapMarker>
        </AppMap>
      </View>
      {approximate ? <Text style={styles.approximate}>{approximate}</Text> : null}
      <SafetyNotice />
      <Pressable
        onPress={onOpenMaps}
        accessibilityRole="button"
        accessibilityHint="Shows a safety reminder first"
        style={({ pressed }) => [styles.mapsLink, pressed && styles.pressed]}
        testID="sighting-open-maps"
      >
        <Text style={styles.mapsLinkLabel}>Open in Maps</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      gap: spacing.md,
    },
    mapCard: {
      height: sizes.mapPreview,
      borderRadius: radii.xl,
      overflow: 'hidden',
      backgroundColor: c.surfaceSubtle,
    },
    // No shadow: markers carry none (Android never draws it, and on iOS it
    // adds tappable margin) — the surface ring gives the pin its edge.
    pin: {
      width: sizes.mapPinConfirm,
      height: sizes.mapPinConfirm,
      borderRadius: radii.full,
      backgroundColor: c.primary,
      borderWidth: sizes.mapPinRing,
      borderColor: c.surface,
    },
    // Body size: "how sure is this point" is a fact the owner acts on.
    approximate: {
      ...typography.body,
      color: c.textSecondary,
    },
    missing: {
      ...typography.body,
      color: c.textSecondary,
    },
    // A text link with a real 44pt box.
    mapsLink: {
      alignSelf: 'flex-start',
      justifyContent: 'center',
      minHeight: sizes.touchTarget,
      minWidth: sizes.touchTarget,
    },
    pressed: {
      opacity: opacity.pressed,
    },
    mapsLinkLabel: {
      ...typography.label,
      color: c.textPrimary,
      textDecorationLine: 'underline',
    },
  });
