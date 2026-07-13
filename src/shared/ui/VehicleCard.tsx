/**
 * WHAT:  VehicleCard — the app's signature card for a stolen car, plus
 *        SkeletonVehicleCard matching its exact geometry. Three variants:
 *        `feed` (full-width: 4:3 swipeable photo carousel + dots, title +
 *        distance, muted identity meta line, PlateChip + bounty anchor row);
 *        `compact` (rail card: SQUARE static photo — no inner carousel,
 *        it would fight the rail's scroll — full-line title, muted
 *        "distance · last seen …" meta, bounty line); `map` (the floating
 *        card over the search map: photo-left row on a real surface with
 *        the lifted shadow — the one variant that isn't borderless).
 * WHY:   Modelled on Airbnb's listing card, and like it deliberately
 *        BORDERLESS — no card surface, border, or shadow; the photo carries
 *        the card directly on the screen background (this is the Airbnb-
 *        style variant, intentionally unlike a boxed Card primitive).
 *        Swiping the carousel cycles photos without firing the card press
 *        (the horizontal ScrollView claims the gesture); tapping anywhere
 *        opens the post with the design system's 0.98 press scale. Badges
 *        only appear when the status isn't plain `active`, so the public
 *        feed stays calm and the owner's list stays informative. `compact`
 *        is the rail card; `map` is the search map's floating peek card
 *        (title, distance-led meta, then plate + bounty — the plate is
 *        VISIBLE, not just spoken: spotters confirm a match by plate).
 *        Memoised for recycled list rows. The top-right image corner is
 *        reserved for a future save/watch toggle — layout leaves it clear.
 * LINKS: docs/DESIGN_SYSTEM.md (Card, Colour rules, Motion, Accessibility);
 *        docs/DOMAIN.md (lifecycle, money); src/shared/types/posts.ts;
 *        src/shared/ui/{AppImage,PlateChip,BountyTag}.tsx;
 *        src/shared/lib/money.ts; src/shared/hooks/useTimeAgo.ts.
 *
 * Usage:
 *   <VehicleCard post={summary} onPress={() => router.push(`/post/${summary.id}`)} />
 *   <SkeletonVehicleCard />            // while the feed loads
 */

import { Feather } from '@expo/vector-icons';
import { memo, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useAnimatedValue,
} from 'react-native';
// RNGH's Pressable, NOT react-native's: the card wraps a horizontal
// ScrollView, and the core Pressable races the native scroll for the
// gesture — on many Android devices a swipe lands as a press (and scrolls
// can misfire presses). The gesture-handler Pressable waits for scrolls.
import { Pressable } from 'react-native-gesture-handler';

import { useTimeAgo } from '../hooks';
import { formatPounds } from '../lib';
import { colors, motion, opacity, radii, shadows, sizes, spacing, typography } from '../theme';
import type { PostSummary } from '../types';
import { AppImage } from './AppImage';
import { BountyTag } from './BountyTag';
import { PlateChip, spellPlate } from './PlateChip';
import { StatusBadge, statusBadgeLabel } from './StatusBadge';

/** Cars are landscape subjects; every card photo is 4:3. */
const PHOTO_ASPECT_RATIO = 4 / 3;
/** Carousel cap — enough to show the car, not a gallery. */
const MAX_PHOTOS = 5;

export interface VehicleCardProps {
  post: PostSummary;
  /** Opens the post detail. Swipes inside the carousel do NOT fire this. */
  onPress: () => void;
  /** feed = full-width stack; compact = square-photo rail card;
   *  map = the wide photo-left floating card over the search map. */
  variant?: 'feed' | 'compact' | 'map';
}

function VehicleCardInner({ post, onPress, variant = 'feed' }: VehicleCardProps) {
  const compact = variant === 'compact';
  const mapCard = variant === 'map';
  const badgeLabel = statusBadgeLabel(post.status);
  // Live-updating recency: the memoised card re-renders itself each minute,
  // so a feed left open never shows a stale "2m ago".
  const lastSeen = useTimeAgo(post.lastSeenAt);

  // Press feedback: 0.98 scale ANIMATED per the motion rules, not snapped.
  // Native-driven — transform animations stay smooth off the JS thread.
  const pressScale = useAnimatedValue(1);
  const animatePress = (pressed: boolean) =>
    Animated.timing(pressScale, {
      toValue: pressed ? motion.pressScale : 1,
      duration: motion.fast,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();

  // Recycled/unmounted cards must not keep a dead animation ticking.
  useEffect(() => () => pressScale.stopAnimation(), [pressScale]);

  const label = [
    `${post.colour} ${post.make} ${post.model}`,
    `plate ${spellPlate(post.plate)}`,
    `${formatPounds(post.bountyPence)} bounty`,
    badgeLabel ? badgeLabel.toLowerCase() : null,
    `last seen ${lastSeen}`,
    post.distanceMiles !== undefined ? `${formatDistance(post.distanceMiles)} away` : null,
  ]
    .filter(Boolean)
    .join(', ');

  // Muted meta line shared by every variant: rails/map lead with distance
  // (what a spotter scans for); the full-width card leads with identity.
  const metaText =
    compact || mapCard
      ? [
          post.distanceMiles !== undefined ? formatDistance(post.distanceMiles) : null,
          `last seen ${lastSeen}`,
        ]
          .filter(Boolean)
          .join(' · ')
      : `${post.colour} · last seen ${lastSeen}${post.lastSeenArea ? ` near ${post.lastSeenArea}` : ''}`;

  if (mapCard) {
    // Photo-left floating card: unlike the borderless feed cards this one
    // rides OVER the map, so it needs a real surface and shadow.
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        onPressIn={() => animatePress(true)}
        onPressOut={() => animatePress(false)}
        onTouchEnd={() => animatePress(false)}
        onTouchCancel={() => animatePress(false)}
        style={styles.card}
      >
        <Animated.View style={[styles.mapCard, { transform: [{ scale: pressScale }] }]}>
          <View style={styles.mapPhoto}>
            <PhotoCarousel post={post} staticOnly />
          </View>
          <View style={styles.mapText}>
            <Text numberOfLines={1} style={styles.title}>
              {post.make} {post.model}
            </Text>
            <Text numberOfLines={1} style={styles.metaLine}>
              {metaText}
            </Text>
            {/* Anchor stack, plate ABOVE bounty: a spotter beside the car
                confirms by PLATE, so the floating card must show it, not
                just speak it. Stacked, not side-by-side — the text column
                is only ~62% of the card and money must never truncate. */}
            <View style={styles.mapPlateBounty}>
              <PlateChip plate={post.plate} />
              <BountyTag bountyPence={post.bountyPence} size="md" />
            </View>
          </View>
        </Animated.View>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onPressIn={() => animatePress(true)}
      onPressOut={() => animatePress(false)}
      // Belt-and-braces: if a swipe cancels an in-flight press without an
      // onPressOut, the touch-end/cancel still resets the scale.
      onTouchEnd={() => animatePress(false)}
      onTouchCancel={() => animatePress(false)}
      style={styles.card}
    >
      <Animated.View style={{ transform: [{ scale: pressScale }] }}>
      {/* accessible Pressable = one screen-reader node; the combined label
          above carries everything, and children (incl. dots) aren't visited. */}
      <View>
        <View style={[styles.photoArea, compact && styles.photoAreaCompact]}>
          {/* Rail cards show ONE static photo: a swipeable carousel inside a
              horizontal rail fights the rail's own scroll gesture. */}
          <PhotoCarousel post={post} staticOnly={compact} />
          {badgeLabel ? (
            <View style={styles.badgePosition} pointerEvents="none">
              <StatusBadge status={post.status} />
            </View>
          ) : null}
          {/* Top-right corner intentionally clear: future save/watch toggle. */}
        </View>

        <View style={styles.textStack}>
          <View style={styles.titleRow}>
            <Text numberOfLines={1} style={styles.title}>
              {post.make} {post.model}
            </Text>
            {/* Rail cards give the title the full line; distance moves into
                the meta line below (reference-card hierarchy). */}
            {!compact && post.distanceMiles !== undefined ? (
              <Text style={styles.distance}>{formatDistance(post.distanceMiles)}</Text>
            ) : null}
          </View>

          {/* One muted meta line (Airbnb-reference anatomy), quiet under the
              semibold title — content varies by variant via metaText. */}
          <Text numberOfLines={1} style={styles.metaLine}>
            {metaText}
          </Text>
          {!compact ? (
            /* Anchor row: rigid PlateChip left, terracotta bounty right —
               our equivalent of the reference card's price line. */
            <View style={styles.plateBountyRow}>
              <PlateChip plate={post.plate} />
              <BountyTag bountyPence={post.bountyPence} size="lg" />
            </View>
          ) : (
            <BountyTag bountyPence={post.bountyPence} size="md" />
          )}
        </View>
      </View>
      </Animated.View>
    </Pressable>
  );
}

/** Memoised for FlashList row recycling — PostSummary rows are stable. */
export const VehicleCard = memo(VehicleCardInner);

/** "2.3 mi", trailing zeros dropped ("3 mi"). */
function formatDistance(miles: number): string {
  const rounded = Math.round(miles * 10) / 10;
  return `${rounded} mi`;
}

function PhotoCarousel({ post, staticOnly = false }: { post: PostSummary; staticOnly?: boolean }) {
  const photos = post.photos.slice(0, staticOnly ? 1 : MAX_PHOTOS);
  const [activeIndex, setActiveIndex] = useState(0);
  // Measured, not assumed: compact map cards and future layouts won't share
  // the feed's width, and paging maths must match the real card width.
  const [photoWidth, setPhotoWidth] = useState(0);

  // Recycled list rows reuse this component for a NEW post; snap the
  // carousel back to the first photo instead of inheriting the old offset.
  const [prevPostId, setPrevPostId] = useState(post.id);
  if (post.id !== prevPostId) {
    setPrevPostId(post.id);
    setActiveIndex(0);
  }

  const scrollRef = useRef<ScrollView>(null);
  // Mirror of activeIndex for the width-change effect (reading state there
  // would make the effect fire on every swipe and fight the user's gesture).
  const activeIndexRef = useRef(0);
  useEffect(() => {
    activeIndexRef.current = 0; // keyed ScrollView remounts at offset 0
  }, [post.id]);

  // If the measured width changes (rotation, split-screen), re-align the
  // scroll offset to the active photo so the dot never points at the wrong one.
  const previousWidthRef = useRef(0);
  useEffect(() => {
    if (previousWidthRef.current > 0 && photoWidth > 0 && previousWidthRef.current !== photoWidth) {
      scrollRef.current?.scrollTo({
        x: activeIndexRef.current * photoWidth,
        animated: false,
      });
    }
    previousWidthRef.current = photoWidth;
  }, [photoWidth]);

  if (photos.length === 0) {
    return (
      <View style={styles.photoFallback}>
        <Feather name="image" size={typography.display.fontSize} color={colors.textSecondary} />
      </View>
    );
  }

  if (photos.length === 1) {
    return (
      <AppImage
        uri={photos[0].uri}
        thumbhash={photos[0].thumbhash}
        recyclingKey={post.id}
        style={styles.photo}
      />
    );
  }

  return (
    <View
      testID="vehicle-card-carousel-frame"
      style={styles.carouselFrame}
      onLayout={(event) => setPhotoWidth(event.nativeEvent.layout.width)}
    >
      {/* Horizontal paging claims swipe gestures, so the wrapping Pressable
          only ever sees taps — swiping photos never opens the post. */}
      <ScrollView
        ref={scrollRef}
        key={post.id} // recycled rows restart at the first photo
        testID="vehicle-card-carousel"
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => {
          if (photoWidth > 0) {
            // Clamped: iOS overscroll can land the offset past either end.
            const index = Math.min(
              photos.length - 1,
              Math.max(0, Math.round(event.nativeEvent.contentOffset.x / photoWidth)),
            );
            activeIndexRef.current = index;
            setActiveIndex(index);
          }
        }}
      >
        {photos.map((photo, index) => (
          <AppImage
            key={`${post.id}-${index}`} // not photo.uri: duplicate photos may share one
            uri={photo.uri}
            thumbhash={photo.thumbhash}
            recyclingKey={`${post.id}-${index}`}
            style={[styles.photo, { width: photoWidth || undefined }]}
          />
        ))}
      </ScrollView>
      <View style={styles.dots} pointerEvents="none">
        {photos.map((photo, index) => (
          <View
            key={`${post.id}-${index}`}
            testID={`carousel-dot-${index}`}
            style={[styles.dot, index === activeIndex && styles.dotActive]}
          />
        ))}
      </View>
    </View>
  );
}

/** Loading placeholder mirroring VehicleCard's geometry, so feeds don't jump. */
export function SkeletonVehicleCard({
  variant = 'feed',
}: {
  variant?: 'feed' | 'compact' | 'map';
}) {
  const compact = variant === 'compact';
  if (variant === 'map') {
    return (
      <View
        accessible
        accessibilityLabel="Loading post"
        accessibilityState={{ busy: true }}
        style={[styles.card, styles.mapCard]}
      >
        <View style={[styles.mapPhoto, styles.skeletonBlock]} />
        <View style={styles.mapText}>
          <View style={[styles.skeletonLine, styles.skeletonTitle]} />
          <View style={[styles.skeletonLine, styles.skeletonMeta]} />
          {/* Mirrors the plate-over-bounty anchor stack. */}
          <View style={[styles.skeletonLine, styles.skeletonMapPlate]} />
          <View style={[styles.skeletonLine, styles.skeletonBountyCompact]} />
        </View>
      </View>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel="Loading post"
      accessibilityState={{ busy: true }}
      style={styles.card}
    >
      <View style={[styles.photoArea, compact && styles.photoAreaCompact, styles.skeletonBlock]} />
      <View style={styles.textStack}>
        {/* Heights mirror the real rows exactly (title, meta caption line,
            then the anchor row) so content swap-in never jumps. */}
        <View style={[styles.skeletonLine, styles.skeletonTitle]} />
        <View style={[styles.skeletonLine, styles.skeletonMeta]} />
        {!compact ? (
          <View style={[styles.skeletonLine, styles.skeletonPlateBounty]} />
        ) : (
          <View style={[styles.skeletonLine, styles.skeletonBountyCompact]} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Borderless by design: no surface, border, or shadow — the photo IS the card.
  card: {
    width: '100%',
  },
  photoArea: {
    aspectRatio: PHOTO_ASPECT_RATIO,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceSubtle,
  },
  photoAreaCompact: {
    // Square-ish, photo-led rail card (reference feed anatomy).
    aspectRatio: 1,
  },
  // The floating map card: photo left, text right, on a real surface —
  // it rides over the map, so it needs elevation the feed cards refuse.
  mapCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    overflow: 'hidden',
    ...shadows.lifted,
  },
  mapPhoto: {
    width: '38%',
    aspectRatio: 1,
    backgroundColor: colors.surfaceSubtle,
  },
  mapText: {
    flex: 1,
    padding: spacing.md,
    justifyContent: 'center',
    gap: spacing.xs,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgePosition: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
  },
  dots: {
    position: 'absolute',
    bottom: spacing.md,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  dot: {
    width: sizes.progressDot,
    height: sizes.progressDot,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    opacity: opacity.inactive,
  },
  dotActive: {
    opacity: 1,
  },
  textStack: {
    // Tight image→text gap and leading, per the Airbnb-reference anatomy:
    // the photo is the hero, the text block hugs it.
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  // caption, not body: the type scale assigns metadata/timestamps to caption,
  // keeping the title and bounty loud and the metadata quiet (Airbnb hierarchy).
  distance: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  metaLine: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  plateBountyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.xs, // a touch more air before the anchor row
  },
  // Map-card anchor stack: plate over bounty, hugging the left edge —
  // the narrow text column can't fit them side by side without clipping.
  mapPlateBounty: {
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  carouselFrame: {
    flex: 1,
  },
  skeletonBlock: {
    backgroundColor: colors.surfaceSubtle,
  },
  skeletonLine: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.sm,
  },
  skeletonTitle: {
    height: typography.cardTitle.lineHeight,
    width: '60%',
  },
  skeletonMeta: {
    height: typography.caption.lineHeight,
    width: '70%',
  },
  // The anchor row's height is set by the PlateChip: plate line + chip
  // padding (taller than the bounty tag beside it), plus its top margin.
  skeletonPlateBounty: {
    height: typography.plate.lineHeight + spacing.xs * 2,
    width: '100%',
    marginTop: spacing.xs,
  },
  skeletonBountyCompact: {
    height: typography.label.lineHeight,
    width: '40%',
  },
  // Mirrors the map card's PlateChip line (chip height, chip-ish width).
  skeletonMapPlate: {
    height: typography.plate.lineHeight + spacing.xs * 2,
    width: '60%',
  },
});
