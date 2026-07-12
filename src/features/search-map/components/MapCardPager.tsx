/**
 * WHAT:  MapCardPager — the floating card strip above the sheet: one map-
 *        variant VehicleCard per post, paged horizontally, synced with pin
 *        selection both ways (pin tap scrolls the pager; swiping the pager
 *        moves the selection).
 * WHY:   The reference's pin↔card mechanic. Sync loops are the hazard: a
 *        programmatic scrollToIndex fires momentum-end too, so the pager
 *        tracks the index it last REPORTED and stays quiet when the settle
 *        matches what selection already says.
 * LINKS: src/features/search-map/hooks/useMapSelection.ts;
 *        src/shared/ui/VehicleCard.tsx (map variant).
 */

import { memo, useCallback, useEffect, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { FlatList, StyleSheet, View, useWindowDimensions } from 'react-native';

import { spacing } from '@/shared/theme';
import { VehicleCard } from '@/shared/ui';

import type { MapPost } from '../types';

const CARD_GAP = spacing.md;

export interface MapCardPagerProps {
  posts: MapPost[];
  /** -1 hides the pager (nothing selected). */
  selectedIndex: number;
  onIndexSettled: (index: number) => void;
  onPressPost: (post: MapPost) => void;
}

export const MapCardPager = memo(function MapCardPager({
  posts,
  selectedIndex,
  onIndexSettled,
  onPressPost,
}: MapCardPagerProps) {
  const { width: windowWidth } = useWindowDimensions();
  // Full-width-minus-gutters card; snap interval includes the gap.
  const cardWidth = windowWidth - spacing.lg * 2;
  const listRef = useRef<FlatList<MapPost>>(null);
  const lastReportedIndex = useRef(-1);

  // Pin tap → scroll the pager (quietly: momentum-end after a programmatic
  // scroll must not re-report the same index).
  useEffect(() => {
    if (selectedIndex >= 0 && selectedIndex !== lastReportedIndex.current) {
      lastReportedIndex.current = selectedIndex;
      listRef.current?.scrollToIndex({ index: selectedIndex, animated: true });
    }
  }, [selectedIndex]);

  const onMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(event.nativeEvent.contentOffset.x / (cardWidth + CARD_GAP));
      if (index !== lastReportedIndex.current) {
        lastReportedIndex.current = index;
        onIndexSettled(index);
      }
    },
    [cardWidth, onIndexSettled],
  );

  if (selectedIndex < 0 || posts.length === 0) {
    return null;
  }

  return (
    <FlatList
      ref={listRef}
      horizontal
      data={posts}
      keyExtractor={(post) => post.id}
      renderItem={({ item }) => (
        <View style={{ width: cardWidth }}>
          <VehicleCard post={item} variant="map" onPress={() => onPressPost(item)} />
        </View>
      )}
      style={styles.list}
      contentContainerStyle={styles.content}
      showsHorizontalScrollIndicator={false}
      snapToInterval={cardWidth + CARD_GAP}
      snapToAlignment="start"
      decelerationRate="fast"
      onMomentumScrollEnd={onMomentumEnd}
      getItemLayout={(_, index) => ({
        length: cardWidth + CARD_GAP,
        offset: (cardWidth + CARD_GAP) * index,
        index,
      })}
      initialScrollIndex={selectedIndex}
    />
  );
});

const styles = StyleSheet.create({
  list: {
    flexGrow: 0,
  },
  content: {
    paddingHorizontal: spacing.lg,
    gap: CARD_GAP,
  },
});
