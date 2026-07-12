/**
 * WHAT:  MapPins — the search map's markers: terracotta BOUNTY PILLS for
 *        posts (the reference's price-pin analogue; selected inverts to the
 *        dark surface) and sage COUNT BUBBLES for clusters.
 * WHY:   Markers with custom views are the classic Android jank source. Each
 *        marker TRACKS view changes for a few frames after mount (so the
 *        custom view rasterises AFTER layout — setting tracksViewChanges
 *        false from frame 0 is the blank-marker trap), then stops tracking
 *        so it pans free. Selection re-keys the pin, remounting it so the
 *        inverted style rasterises through that same track-then-stop path.
 * LINKS: src/shared/ui/AppMap.tsx (AppMapMarker re-export — the single
 *        react-native-maps import); src/features/search-map/lib/
 *        mapClustering.ts (MapPinItem); docs/DESIGN_SYSTEM.md (tokens).
 */

import { memo, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatPounds } from '@/shared/lib';
import { colors, radii, shadows, sizes, spacing, typography } from '@/shared/theme';
import { AppMapMarker } from '@/shared/ui/AppMap';

import type { MapPinItem } from '../types';

/** How long a freshly-mounted marker keeps tracking view changes before it
 *  freezes — long enough for the custom view to lay out and rasterise. */
const TRACK_SETTLE_MS = 500;

/** A marker that rasterises its custom child AFTER layout, then freezes. */
function TrackedMarker({
  latitude,
  longitude,
  onPress,
  accessibilityLabel,
  children,
}: {
  latitude: number;
  longitude: number;
  onPress: () => void;
  accessibilityLabel: string;
  children: ReactNode;
}) {
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setTracking(false), TRACK_SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <AppMapMarker
      coordinate={{ latitude, longitude }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracking}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
    >
      {/* Transparent 44pt hit area around the drawn marker — markers don't
          honour hitSlop, so the touch target is this wrapper. */}
      <View style={styles.hitTarget}>{children}</View>
    </AppMapMarker>
  );
}

export interface MapPinsProps {
  pins: MapPinItem[];
  selectedPostId: string | null;
  onPressPost: (id: string) => void;
  onPressCluster: (clusterId: number) => void;
}

export const MapPins = memo(function MapPins({
  pins,
  selectedPostId,
  onPressPost,
  onPressCluster,
}: MapPinsProps) {
  return (
    <>
      {pins.map((pin) => {
        if (pin.type === 'cluster') {
          return (
            <TrackedMarker
              key={pin.key}
              latitude={pin.latitude}
              longitude={pin.longitude}
              onPress={() => onPressCluster(pin.clusterId)}
              accessibilityLabel={`${pin.count} cars — zoom in`}
            >
              <View style={styles.clusterBubble}>
                <Text style={styles.clusterCount}>{pin.count}</Text>
              </View>
            </TrackedMarker>
          );
        }
        const selected = pin.post.id === selectedPostId;
        return (
          <TrackedMarker
            // Re-key on selection: remounts the marker so the inverted style
            // rasterises through the track-then-freeze path.
            key={`${pin.key}_${selected ? 'sel' : 'idle'}`}
            latitude={pin.post.latitude}
            longitude={pin.post.longitude}
            onPress={() => onPressPost(pin.post.id)}
            accessibilityLabel={`${formatPounds(pin.post.bountyPence)} bounty — ${pin.post.make} ${pin.post.model}`}
          >
            <View style={[styles.bountyPill, selected && styles.bountyPillSelected]}>
              <Text style={[styles.bountyText, selected && styles.bountyTextSelected]}>
                {formatPounds(pin.post.bountyPence)}
              </Text>
            </View>
          </TrackedMarker>
        );
      })}
    </>
  );
});

const styles = StyleSheet.create({
  // 44pt minimum touch target wrapping the smaller drawn marker.
  hitTarget: {
    minWidth: sizes.touchTarget,
    minHeight: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bountyPill: {
    backgroundColor: colors.surface,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.soft,
  },
  bountyPillSelected: {
    backgroundColor: colors.surfaceInverse,
    borderColor: colors.surfaceInverse,
  },
  bountyText: {
    ...typography.label,
    color: colors.accentText, // terracotta amount on the light pill
  },
  bountyTextSelected: {
    color: colors.textOnPrimary,
  },
  clusterBubble: {
    minWidth: sizes.icon + spacing.md,
    height: sizes.icon + spacing.md,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.soft,
  },
  clusterCount: {
    ...typography.label,
    color: colors.textOnPrimary,
  },
});
