/**
 * WHAT:  PostHero — the edge-to-edge, full-bleed photo carousel at the top of
 *        the detail screen: the shared PhotoPager at the screen's width and
 *        height, its counter lifted clear of the content sheet, growing in on
 *        mount. Falls back to a placeholder when a post has no photos.
 * WHY:   The Airbnb detail hero: the photo owns the top of the screen and
 *        bleeds behind the status bar (the AppHeader floats over it). No inner
 *        rounded corners here — the image runs to every edge. The paging
 *        itself lives in PhotoPager (2026-10-08), shared with the garage's
 *        "Your car" sheet; this keeps only what is about THIS screen — its
 *        size, the counter's clearance and the entrance.
 * LINKS: src/features/vehicles/screens/PostDetailScreen.tsx;
 *        src/shared/ui/PhotoPager.tsx; src/shared/ui/AppHeader.tsx (overlay).
 */

import { Feather } from '@expo/vector-icons';
import { useEffect } from 'react';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { motion, radii, sizes, usePalette } from '@/shared/theme';
import { easeOut } from '@/shared/theme/motionEasing';
import { PhotoPager } from '@/shared/ui';

import type { PostDetailPhoto } from '../types';

export interface PostHeroProps {
  photos: PostDetailPhoto[];
  width: number;
  height: number;
  /** Alt text for the photos (e.g. "Blue BMW 3 Series"). */
  alt?: string;
}

export function PostHero({ photos, width, height, alt }: PostHeroProps) {
  const palette = usePalette();

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

  return (
    <Animated.View style={[{ width, height }, enterStyle]}>
      <PhotoPager
        photos={photos}
        height={height}
        estimatedWidth={width}
        alt={alt}
        // Clear of the content sheet's rounded top edge, which overlaps the
        // hero's last `radii.xl` points (PostDetailScreen `sheet`).
        counterBottomInset={radii.xl}
        placeholder={<Feather name="image" size={sizes.avatarSm} color={palette.textSecondary} />}
      />
    </Animated.View>
  );
}
