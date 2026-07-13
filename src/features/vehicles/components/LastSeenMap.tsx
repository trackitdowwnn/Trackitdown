/**
 * WHAT:  LastSeenMap — a small, NON-interactive map card showing the post's
 *        last-seen point as a single pin. Tapping the whole card opens the
 *        full search map centred there.
 * WHY:   The detail screen's "Last seen here" section. It's a preview, not a
 *        map to explore: gestures are off (AppMap `interactive={false}`) so it
 *        can't be dragged and never steals the page scroll, and a transparent
 *        Pressable overlay turns the whole card into one "open the map" target.
 * LINKS: src/features/vehicles/components/PostDetailBody.tsx;
 *        src/shared/ui/AppMap.tsx (interactive prop); the /search-map route.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { colors, motion, radii } from '@/shared/theme';
import { AppMap, AppMapMarker } from '@/shared/ui/AppMap';

/** Preview card height. */
const PREVIEW_HEIGHT = 180;
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

const styles = StyleSheet.create({
  card: {
    height: PREVIEW_HEIGHT,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceSubtle,
  },
  pin: {
    width: PIN_DIAMETER,
    height: PIN_DIAMETER,
    borderRadius: radii.full,
    // Sage (primary), not terracotta — terracotta is reserved for bounty/value.
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.surface,
  },
});
