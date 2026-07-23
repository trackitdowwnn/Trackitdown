/**
 * WHAT:  FeedCarouselRow — one horizontal, snap-scrolling row of compact
 *        VehicleCards. Rendered as a SINGLE FlashList item (type
 *        'carouselRow') inside the vertical feed. Card width derives from
 *        the window (2 cards fully visible + the next one peeking) so the
 *        row reads as an endless shelf on every device width.
 * WHY:   Nesting one horizontal FlatList per row is the sanctioned pattern
 *        for carousels inside a recycled vertical list; the row derives all
 *        state from props (no recycling ghosts). A fixed pixel width can't
 *        guarantee the peek — the peek is what tells users the row scrolls,
 *        so it's a ratio of the window instead (reference feed pattern).
 * LINKS: src/features/search-map/README.md (list performance);
 *        src/shared/ui/VehicleCard.tsx (compact variant);
 *        src/features/search-map/components/FeedSkeleton.tsx (mirrors this
 *        geometry via carouselCardWidth).
 */

import { memo, useCallback } from 'react';
import { FlatList, StyleSheet, View, useWindowDimensions } from 'react-native';

import { WatchToggle } from '@/features/watchlist';
import { spacing } from '@/shared/theme';
import type { PostSummary } from '@/shared/types';
import { SkeletonVehicleCard, VehicleCard } from '@/shared/ui';

import type { FeedSection } from '../types';

/** Card width as a fraction of window width: 2 full cards + ~12% peek. */
const CAROUSEL_CARD_FRACTION = 0.44;
const CARD_GAP = spacing.md; // 12 — the reference's tighter in-row gap

/** Shared with FeedSkeleton so the loading row matches the real geometry. */
export function carouselCardWidth(windowWidth: number): number {
  return Math.round(windowWidth * CAROUSEL_CARD_FRACTION);
}

export interface FeedCarouselRowProps {
  section: FeedSection;
  onPressPost: (post: PostSummary) => void;
  /** Fires nearing the rail's end — the near_you rail pages horizontally. */
  onEndReached?: () => void;
  /** Show a skeleton card at the rail's end while the next page loads. */
  loadingMore?: boolean;
}

export const FeedCarouselRow = memo(function FeedCarouselRow({
  section,
  onPressPost,
  onEndReached,
  loadingMore = false,
}: FeedCarouselRowProps) {
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = carouselCardWidth(windowWidth);

  const renderItem = useCallback(
    ({ item }: { item: PostSummary }) => (
      <View style={{ width: cardWidth }}>
        <VehicleCard
          post={item}
          variant="compact"
          onPress={() => onPressPost(item)}
          topRightAction={<WatchToggle postId={item.id} source="feed" />}
        />
      </View>
    ),
    [onPressPost, cardWidth],
  );

  return (
    <FlatList
      horizontal
      data={section.posts}
      keyExtractor={(post) => post.id}
      renderItem={renderItem}
      showsHorizontalScrollIndicator={false}
      snapToInterval={cardWidth + CARD_GAP}
      snapToAlignment="start"
      decelerationRate="fast"
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      // Paging affordance: a skeleton card (never a spinner) at the rail's
      // end while the next page arrives.
      ListFooterComponent={
        loadingMore ? (
          <View style={{ width: cardWidth }}>
            <SkeletonVehicleCard variant="compact" />
          </View>
        ) : null
      }
      contentContainerStyle={styles.content}
      // Carousels hold ≤10 compact cards — cheap enough to keep mounted;
      // recycling happens at the OUTER FlashList level per row.
      initialNumToRender={4}
    />
  );
});

const styles = StyleSheet.create({
  content: {
    // Feed gutter: 16 per the DESIGN_SYSTEM feed-surface exception.
    paddingHorizontal: spacing.lg,
    gap: CARD_GAP,
  },
});
