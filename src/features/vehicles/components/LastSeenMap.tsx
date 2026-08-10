/**
 * WHAT:  LastSeenMap — a large, NON-interactive map card showing the post's
 *        last-seen point as a single pin, with a floating expand button.
 *        Tapping anywhere on the card opens the full search map centred there.
 * WHY:   The detail screen's "Last seen here" section. Location is the
 *        spotter's working tool, so the card gets headline size
 *        (`sizes.mapPreview`, REFERENCE_SPEC §9) — but stays a preview:
 *        gestures are off (AppMap `interactive={false}`) so it can't be
 *        dragged and never steals the page scroll. The small floating circle
 *        makes the existing whole-card tap DISCOVERABLE (it is not a separate
 *        control — the transparent overlay is still the one tap target).
 * LINKS: src/features/vehicles/components/PostDetailBody.tsx;
 *        src/shared/ui/AppMap.tsx (interactive prop); the /search-map route;
 *        docs/design-refs/post-detail/GAP_ANALYSIS.md A3 + D2.
 */

import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  motion,
  radii,
  shadows,
  sizes,
  spacing,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { AppMap, AppMapMarker } from '@/shared/ui/AppMap';

/** ~1.4-mile span around the point — close enough to place it, calm enough
 *  not to pinpoint a doorstep in the thumbnail. */
const PREVIEW_DELTA = 0.02;
/** Diameter of the single last-seen dot marker. */
const PIN_DIAMETER = 16;

export interface LastSeenMapProps {
  lat: number;
  lng: number;
  onOpenFull: () => void;
}

export function LastSeenMap({ lat, lng, onOpenFull }: LastSeenMapProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const region = {
    latitude: lat,
    longitude: lng,
    latitudeDelta: PREVIEW_DELTA,
    longitudeDelta: PREVIEW_DELTA,
  };

  return (
    <View style={styles.card}>
      <AppMap
        interactive={false}
        region={region}
        animateDurationMs={motion.mapPan}
        onRegionChangeStart={() => {}}
        onRegionChangeComplete={() => {}}
      >
        <AppMapMarker coordinate={{ latitude: lat, longitude: lng }} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={styles.pin} />
        </AppMapMarker>
      </AppMap>
      {/* Expand affordance — decorative twin of the card tap below, so it is
          hidden from accessibility (one target, one announcement). */}
      <View style={styles.expandBadge} pointerEvents="none" importantForAccessibility="no-hide-descendants">
        <Feather name="maximize-2" size={sizes.iconSm} color={palette.textPrimary} />
      </View>
      {/* Whole card is one tap target — the map itself takes no gestures. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel="Open the full map"
        onPress={onOpenFull}
      />
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  card: {
    height: sizes.mapPreview,
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: c.surfaceSubtle,
  },
  pin: {
    width: PIN_DIAMETER,
    height: PIN_DIAMETER,
    borderRadius: radii.full,
    // primary, not accent — accent is reserved for bounty/value.
    backgroundColor: c.primary,
    borderWidth: 2,
    borderColor: c.surface,
  },
  expandBadge: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: sizes.circleButtonSm,
    height: sizes.circleButtonSm,
    borderRadius: radii.full,
    backgroundColor: c.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.lifted,
  },
});
