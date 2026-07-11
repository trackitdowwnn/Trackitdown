/**
 * WHAT:  FeedSkeleton — the full-feed loading state: a search-pill
 *        placeholder, an area-header line, and two horizontal rails of
 *        compact skeleton cards (the feed is rails end to end).
 * WHY:   The spec bans spinners for the feed's first load — the skeleton
 *        promises the exact layout that's coming (docs/DESIGN_SYSTEM.md,
 *        loading states), so its block heights come from the same typography
 *        tokens and its rhythm mirrors the real rows' padding, keeping the
 *        content swap-in jump-free.
 * LINKS: src/shared/ui/VehicleCard.tsx (SkeletonVehicleCard);
 *        src/features/search-map/components/{FeedTopBar,FeedAreaHeader,
 *        FeedSectionHeader,FeedCarouselRow}.tsx (the geometry this mirrors).
 */

import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import { SkeletonVehicleCard } from '@/shared/ui';

import { carouselCardWidth } from './FeedCarouselRow';

function Block({
  width,
  height,
  radius,
}: {
  width: number | `${number}%`;
  height: number;
  radius?: number;
}) {
  return (
    <View
      style={{
        width,
        height,
        borderRadius: radius ?? radii.sm,
        backgroundColor: colors.surfaceSubtle,
      }}
    />
  );
}

export function FeedSkeleton() {
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = carouselCardWidth(windowWidth);
  return (
    <View
      accessible
      accessibilityLabel="Loading the feed"
      accessibilityState={{ busy: true }}
      style={styles.container}
    >
      {/* Search pill placeholder first (the reference top layout), then the
          area-header line — its row is stretched to the touch target by the
          real header's area Pressable. */}
      <View style={styles.top}>
        <Block width="100%" height={sizes.control} radius={radii.full} />
      </View>
      <View style={styles.titleRow}>
        <Block width="65%" height={typography.sectionTitle.lineHeight} />
      </View>

      {/* First rail (near_you), then a second header + rail — the whole
          feed is horizontal rails (reference layout). Header rows are
          stretched to the touch target by their real pressables. */}
      <View style={styles.carousel}>
        <View style={{ width: cardWidth }}>
          <SkeletonVehicleCard variant="compact" />
        </View>
        <View style={{ width: cardWidth }}>
          <SkeletonVehicleCard variant="compact" />
        </View>
        <View style={{ width: cardWidth }}>
          <SkeletonVehicleCard variant="compact" />
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <Block width="50%" height={typography.sectionTitle.lineHeight} />
      </View>
      <View style={styles.carousel}>
        <View style={{ width: cardWidth }}>
          <SkeletonVehicleCard variant="compact" />
        </View>
        <View style={{ width: cardWidth }}>
          <SkeletonVehicleCard variant="compact" />
        </View>
        <View style={{ width: cardWidth }}>
          <SkeletonVehicleCard variant="compact" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // Feed gutter: 16 per the DESIGN_SYSTEM feed-surface exception.
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  top: {
    marginBottom: spacing.sm,
  },
  titleRow: {
    // Total row = padding + the area Pressable's 44pt content height,
    // matching FeedAreaHeader exactly (minHeight includes the padding box).
    minHeight: sizes.touchTarget + spacing.xxl + spacing.md,
    justifyContent: 'center',
    paddingTop: spacing.xxl, // FeedAreaHeader's section rhythm
    paddingBottom: spacing.md,
  },
  sectionHeader: {
    paddingTop: spacing.xxl, // mirrors FeedSectionHeader's section spacing
    paddingBottom: spacing.md,
    minHeight: sizes.touchTarget + spacing.xxl + spacing.md, // see-all row height
    justifyContent: 'center',
  },
  carousel: {
    flexDirection: 'row',
    gap: spacing.md, // mirrors FeedCarouselRow's CARD_GAP
    // Full-bleed like the real carousel: cancel the container gutter so the
    // third card's peek reaches the screen edge instead of dying 16px short.
    marginHorizontal: -spacing.lg,
    paddingLeft: spacing.lg,
    overflow: 'hidden',
    marginBottom: spacing.xl,
  },
});
