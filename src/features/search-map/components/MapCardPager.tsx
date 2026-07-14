/**
 * WHAT:  MapCardPager — the floating peek card above the sheet: one map-
 *        variant VehicleCard per post, paged horizontally with an ~8px
 *        peek of the neighbouring cards, synced with pin selection both
 *        ways, springing up on selection and sliding away on dismiss.
 * WHY:   The reference's pin↔card mechanic. Sync loops are the hazard: a
 *        programmatic scrollToIndex fires momentum-end too, so the pager
 *        tracks the index it last REPORTED and stays quiet when the settle
 *        matches what selection already says. The card announces itself to
 *        screen readers on selection change — a sighted user SEES the card
 *        rise; TalkBack/VoiceOver users must hear it. Enter/exit runs on
 *        the UI thread (Reanimated shared value) so the map camera and the
 *        card never fight for the JS thread mid-animation; the component
 *        stays mounted while animating out, then unmounts itself.
 * LINKS: src/features/search-map/hooks/useMapSelection.ts;
 *        src/shared/ui/VehicleCard.tsx (map variant);
 *        src/features/search-map/README.md (peek-card spec).
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { AccessibilityInfo, FlatList, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { formatPounds } from '@/shared/lib';
import { createLogger } from '@/shared/lib/logger';
import { motion, spacing } from '@/shared/theme';
import { Button, VehicleCard } from '@/shared/ui';

import type { MapPost } from '../types';

const log = createLogger('search-map');

// Gap doubles as the peek math's third term: with spacing.lg side padding
// and cardWidth = window − 2·spacing.lg, a snapped card sits 16px from
// each screen edge and the neighbour's visible sliver is lg − gap = 8px.
const CARD_GAP = spacing.sm;
/** How far below its resting place the card starts its spring-up. */
const ENTER_OFFSET = spacing.xxxl;

export interface MapCardPagerProps {
  posts: MapPost[];
  /** -1 dismisses the pager (slides down, then unmounts). */
  selectedIndex: number;
  onIndexSettled: (index: number) => void;
  onPressPost: (post: MapPost) => void;
  /** "I've seen this car" on the peek card — the map's direct entry into the
   *  report-sighting flow (the screen supplies the auth-gated handler). */
  onSeenPost?: (post: MapPost) => void;
}

export const MapCardPager = memo(function MapCardPager({
  posts,
  selectedIndex,
  onIndexSettled,
  onPressPost,
  onSeenPost,
}: MapCardPagerProps) {
  const { width: windowWidth } = useWindowDimensions();
  // Full-width-minus-gutters card; snap interval includes the gap.
  const cardWidth = windowWidth - spacing.lg * 2;
  const listRef = useRef<FlatList<MapPost>>(null);
  const lastReportedIndex = useRef(-1);
  const reduceMotion = useReducedMotion();

  // Enter/exit choreography: `shown` keeps the list mounted through the
  // exit animation; `visible` (0..1) drives translateY + fade on the UI
  // thread. Dismiss unmounts only after the slide-down lands.
  const [shown, setShown] = useState(selectedIndex >= 0);
  const visible = useSharedValue(selectedIndex >= 0 ? 1 : 0);
  const wantShown = selectedIndex >= 0 && posts.length > 0;

  // A completed dismissal resets the report guard: the next show of the
  // SAME index is a genuinely new view (fresh log + scroll-into-place).
  const finishHide = useCallback(() => {
    lastReportedIndex.current = -1;
    setShown(false);
  }, []);

  useEffect(() => {
    if (wantShown) {
      setShown(true);
      visible.value = reduceMotion ? 1 : withSpring(1, motion.cardEnterSpring);
      return;
    }
    if (reduceMotion) {
      visible.value = 0;
      finishHide();
      return;
    }
    visible.value = withTiming(
      0,
      { duration: motion.fast, easing: Easing.out(Easing.cubic) },
      (finished) => {
        // finished=false means a re-select interrupted the exit — the
        // enter branch above takes over; the card must stay mounted.
        if (finished) {
          runOnJS(finishHide)();
        }
      },
    );
  }, [wantShown, reduceMotion, visible, finishHide]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: visible.value,
    transform: [{ translateY: interpolate(visible.value, [0, 1], [ENTER_OFFSET, 0]) }],
  }));

  // Pin tap → scroll the pager (quietly: momentum-end after a programmatic
  // scroll must not re-report the same index). Also where a freshly shown
  // card announces itself: pin taps and swipes both land here via selection.
  // The announce guard is a separate ref keyed by POST ID — a re-search
  // rebuilding the posts array must not re-announce the same card, and
  // swipe-driven changes arrive with lastReportedIndex already equal.
  const lastAnnouncedId = useRef<string | null>(null);
  useEffect(() => {
    if (selectedIndex < 0 || selectedIndex >= posts.length) {
      lastAnnouncedId.current = null; // dismissed — next show announces again
      return;
    }
    const post = posts[selectedIndex];
    if (post.id !== lastAnnouncedId.current) {
      lastAnnouncedId.current = post.id;
      AccessibilityInfo.announceForAccessibility(
        `${post.colour} ${post.make} ${post.model}, ${formatPounds(post.bountyPence)} bounty — swipe for more results`,
      );
    }
    if (selectedIndex !== lastReportedIndex.current) {
      lastReportedIndex.current = selectedIndex;
      log.info('map_card_view', { postId: post.id, index: selectedIndex, trigger: 'pin' });
      listRef.current?.scrollToIndex({ index: selectedIndex, animated: true });
    }
  }, [selectedIndex, posts]);

  const onMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      // A fling can still be decelerating when the user dismisses the card
      // (map tap / Android back); its settle must not resurrect the
      // selection the user just cleared.
      if (selectedIndex < 0) {
        return;
      }
      // Clamped: overscroll at either end can round past the last card.
      const index = Math.min(
        posts.length - 1,
        Math.max(0, Math.round(event.nativeEvent.contentOffset.x / (cardWidth + CARD_GAP))),
      );
      if (index !== lastReportedIndex.current) {
        const from = lastReportedIndex.current;
        lastReportedIndex.current = index;
        log.info('map_card_swipe', { fromIndex: from, toIndex: index });
        log.info('map_card_view', { postId: posts[index]?.id, index, trigger: 'swipe' });
        onIndexSettled(index);
      }
    },
    [cardWidth, posts, onIndexSettled, selectedIndex],
  );

  if (!shown || posts.length === 0) {
    return null;
  }

  return (
    // The outgoing card is scenery, not UI: no taps or new drags mid-exit.
    <Animated.View style={animatedStyle} pointerEvents={wantShown ? 'auto' : 'none'}>
      <FlatList
        ref={listRef}
        testID="map-card-pager"
        horizontal
        data={posts}
        keyExtractor={(post) => post.id}
        renderItem={({ item }) => (
          <View style={[styles.cardColumn, { width: cardWidth }]}>
            <VehicleCard post={item} variant="map" onPress={() => onPressPost(item)} />
            {onSeenPost ? (
              <Button label="I’ve seen this car" onPress={() => onSeenPost(item)} />
            ) : null}
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
        initialScrollIndex={selectedIndex >= 0 ? selectedIndex : 0}
      />
    </Animated.View>
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
  cardColumn: {
    gap: spacing.sm,
  },
});
