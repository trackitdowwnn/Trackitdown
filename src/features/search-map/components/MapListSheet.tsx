/**
 * WHAT:  MapListSheet — the persistent list-over-the-map: a NON-modal
 *        gorhom sheet riding at peek / half / full snap points, its handle
 *        reading "N cars in this area", its body the full VehicleCard list.
 * WHY:   The reference pattern: the list is not a separate screen, it's a
 *        layer of the map. The shared BottomSheet is deliberately NOT used
 *        — that primitive is a dismissable modal with a scrim; this sheet
 *        is permanent chrome (never dismissable, no scrim, map stays
 *        interactive behind it at peek). The body fills with the warm
 *        `background` token (not `surface`) on purpose — the borderless feed
 *        VehicleCards are designed to sit on it (feed-surface exception).
 * LINKS: src/shared/ui/BottomSheet.tsx (the modal sibling, and why not);
 *        docs/DESIGN_SYSTEM.md (feed-surface exception, radii, grabber).
 */

import BottomSheet, {
  BottomSheetFlatList,
  useBottomSheetTimingConfigs,
} from '@gorhom/bottom-sheet';
import { memo, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Easing } from 'react-native-reanimated';

import { colors, motion, radii, sizes, spacing, typography } from '@/shared/theme';
import { EmptyState, ErrorState, SkeletonVehicleCard, VehicleCard } from '@/shared/ui';

import type { MapPost } from '../types';

/** Peek height as a fraction of the screen: shows the handle + label. */
const MAP_SHEET_PEEK_PERCENT = 12;
/** Peek shows the handle + label; half is browsing; full is list mode. */
const SNAP_POINTS = [`${MAP_SHEET_PEEK_PERCENT}%`, '48%', '88%'];
/** Skeleton rows shown while a search runs (no spinners on the list). */
const SKELETON_ROWS = [0, 1, 2];

export interface MapListSheetProps {
  total: number;
  posts: MapPost[];
  status: 'loading' | 'ready' | 'error';
  /** True while a peek card is up: the sheet slides away so the card owns
   *  the bottom of the screen, and returns to peek when the card dismisses. */
  hidden?: boolean;
  onRetry: () => void;
  onPressPost: (post: MapPost) => void;
}

export const MapListSheet = memo(function MapListSheet({
  total,
  posts,
  status,
  hidden = false,
  onRetry,
  onPressPost,
}: MapListSheetProps) {
  const snapPoints = useMemo(() => SNAP_POINTS, []);
  const sheetRef = useRef<BottomSheet>(null);
  // Match the sheet's slide to the design clock (250ms ease-out) so it and
  // the peek card's spring read as one handoff, not two different curves.
  const animationConfigs = useBottomSheetTimingConfigs({
    duration: motion.standard,
    easing: Easing.out(Easing.cubic),
  });

  // Hide/show imperatively via the ref (NOT the `index` prop). gorhom's
  // `index` IS reactive, but with enablePanDownToClose={false} toggling it
  // to -1 does not close a non-dismissable sheet — observed on-device, the
  // sheet stayed at peek. close() forces the off-screen state regardless;
  // snapToIndex(0) brings it home to peek when the card dismisses.
  useEffect(() => {
    if (hidden) {
      sheetRef.current?.close();
    } else {
      sheetRef.current?.snapToIndex(0);
    }
  }, [hidden]);

  const handleLabel =
    status === 'ready'
      ? `${total} ${total === 1 ? 'car' : 'cars'} in this area`
      : status === 'loading'
        ? 'Searching this area…'
        : 'Cars in this area'; // neutral — the ErrorState below owns the message

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      animationConfigs={animationConfigs}
      // Pan-down stays disabled for the USER — this is permanent chrome
      // that only the peek card may displace (see the effect above).
      enablePanDownToClose={false}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.grabber}
      accessibilityLabel="Cars in this area"
      // While hidden (a peek card is up) the sheet is off-screen but still
      // mounted; drop it from the a11y tree so screen-reader focus can't
      // land on the invisible list/header behind the card.
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
    >
      <View style={styles.handleRow}>
        <Text accessibilityRole="header" style={styles.handleLabel}>
          {handleLabel}
        </Text>
      </View>
      {status === 'error' ? (
        <ErrorState body="We couldn't search this area." onRetry={onRetry} />
      ) : status === 'loading' && posts.length === 0 ? (
        // Skeleton rows, never a spinner (DESIGN_SYSTEM loading states).
        <View style={styles.listContent}>
          {SKELETON_ROWS.map((row) => (
            <View key={row} style={styles.card}>
              <SkeletonVehicleCard />
            </View>
          ))}
        </View>
      ) : (
        <BottomSheetFlatList
          data={posts}
          keyExtractor={(post: MapPost) => post.id}
          renderItem={({ item }: { item: MapPost }) => (
            <View style={styles.card}>
              <VehicleCard post={item} onPress={() => onPressPost(item)} />
            </View>
          )}
          ListEmptyComponent={
            status === 'ready' ? (
              <EmptyState
                title="No stolen cars in this area"
                body="That's a good thing. Pan the map, or check back later."
              />
            ) : null
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
  },
  grabber: {
    // borderStrong (not the shared sheet's `border`) for legibility over map
    // tiles; radii.sm rounds the ends to match the shared BottomSheet.
    backgroundColor: colors.borderStrong,
    width: sizes.grabberWidth,
    height: sizes.grabberHeight,
    borderRadius: radii.sm,
  },
  handleRow: {
    alignItems: 'center',
    paddingBottom: spacing.sm,
  },
  handleLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  card: {
    // Feed gutter: 16 per the DESIGN_SYSTEM feed-surface exception.
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  listContent: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
});
