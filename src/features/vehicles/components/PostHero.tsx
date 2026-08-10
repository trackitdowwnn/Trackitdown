/**
 * WHAT:  PostHero — the edge-to-edge, full-bleed photo carousel at the top of
 *        the detail screen: horizontally paged AppImages with a dark "n / m"
 *        counter pill. Falls back to a placeholder when a post has no photos.
 * WHY:   The Airbnb detail hero: the photo owns the top of the screen and
 *        bleeds behind the status bar (the AppHeader floats over it). No inner
 *        rounded corners here — the image runs to every edge.
 * LINKS: src/features/vehicles/screens/PostDetailScreen.tsx;
 *        src/shared/ui/AppImage.tsx; src/shared/ui/AppHeader.tsx (overlay).
 */

import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  motion,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { easeOut } from '@/shared/theme/motionEasing';
import { AppImage } from '@/shared/ui';

import type { PostDetailPhoto } from '../types';

export interface PostHeroProps {
  photos: PostDetailPhoto[];
  width: number;
  height: number;
  /** Alt text for the photos (e.g. "Blue BMW 3 Series"). */
  alt?: string;
}

export function PostHero({ photos, width, height, alt }: PostHeroProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const [index, setIndex] = useState(0);

  // Card→detail continuity: the hero fades + grows from 0.94 on mount, so the
  // detail reads as a continuation of the tapped card (Airbnb's move, without a
  // full shared element). Reduced motion → no scale/fade (starts settled).
  const reduceMotion = useReducedMotion();
  const enter = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    enter.value = withTiming(1, { duration: motion.slow, easing: easeOut });
  }, [enter, reduceMotion]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: 0.94 + enter.value * 0.06 }],
  }));

  if (photos.length === 0) {
    return (
      <Animated.View style={[styles.fallback, { width, height }, enterStyle]}>
        <Feather name="image" size={sizes.avatarSm} color={palette.textSecondary} />
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[{ width, height }, enterStyle]}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => {
          // Clamped: overscroll can round past either end.
          const next = Math.min(
            photos.length - 1,
            Math.max(0, Math.round(event.nativeEvent.contentOffset.x / width)),
          );
          setIndex(next);
        }}
      >
        {photos.map((photo, i) => (
          <AppImage
            key={`${photo.uri}-${i}`}
            uri={photo.uri}
            accessibilityLabel={alt}
            style={{ width, height }}
          />
        ))}
      </ScrollView>
      {photos.length > 1 ? (
        <View
          style={styles.counter}
          pointerEvents="none"
          accessible
          accessibilityRole="text"
          accessibilityLabel={`Photo ${index + 1} of ${photos.length}`}
        >
          <Text style={styles.counterText}>
            {index + 1} / {photos.length}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  // The empty-hero placeholder is PAGE chrome, not chrome over a photo (there
  // is no photo) — so it stays on the themed surface token.
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surfaceSubtle,
  },
  counter: {
    position: 'absolute',
    right: spacing.md,
    // Clear of the content sheet's rounded top edge, which overlaps the
    // hero's last `radii.xl` points (PostDetailScreen `sheet`).
    bottom: spacing.md + radii.xl,
    // surfaceOverMedia, NOT surfaceInverse: this pill sits ON THE PHOTOGRAPHY.
    // surfaceInverse means "the inverse of the page" and flips to near-white on
    // dark, which would put a white pill with white-ish text over a bright
    // photo. A photo is as bright in either theme, so its chrome must not move.
    backgroundColor: c.surfaceOverMedia,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  counterText: {
    ...typography.caption,
    color: c.textOnMedia,
  },
});
