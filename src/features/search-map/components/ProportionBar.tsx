/**
 * WHAT:  ProportionBar — one full-width track with a fill at a fraction of
 *        it: a share of a whole, drawn. The recovery card's "70% of closed
 *        listings came back".
 * WHY:   A percentage on its own is a number the reader has to picture;
 *        seven-tenths of a bar is the picture. Same anatomy as RankedBars
 *        and the RadiusSlider track — `sliderTrack` height, `borderStrong`
 *        rule, `primary` fill — so every horizontal bar on the page is the
 *        same bar. The unfilled remainder is the other outcome (closed
 *        without recovery), which is why the track is a visible rule and not
 *        a hairline: the remainder is information too.
 *
 *        Decoration to a screen reader (the figure beside it speaks the
 *        numbers), and `growIn` extends the fill from the left once over
 *        motion.slow, like the ranked list.
 * LINKS: ../screens/AreaInsightsScreen.tsx (the recovery card);
 *        ./RankedBars.tsx (the same track, one per row).
 */

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { motion, radii, sizes, useThemedStyles, type Palette } from '@/shared/theme';
import { easeOut } from '@/shared/theme/motionEasing';

export interface ProportionBarProps {
  /** 0..1 of the track. */
  fraction: number;
  growIn?: boolean;
  testID?: string;
}

export function ProportionBar({ fraction, growIn = false, testID }: ProportionBarProps) {
  const styles = useThemedStyles(makeStyles);
  const reducedMotion = useReducedMotion();
  const animateIn = growIn && !reducedMotion;
  const extend = useSharedValue(animateIn ? 0 : 1);
  useEffect(() => {
    if (!animateIn) return;
    extend.value = withTiming(1, {
      duration: motion.slow,
      easing: easeOut,
      reduceMotion: ReduceMotion.System,
    });
  }, [animateIn, extend]);
  const extendStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: extend.value }] }));

  const clamped = Math.min(1, Math.max(0, fraction));
  return (
    <View style={styles.track} importantForAccessibility="no-hide-descendants" testID={testID}>
      <Animated.View style={[styles.fill, { width: `${clamped * 100}%` }, extendStyle]} />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    track: {
      height: sizes.sliderTrack,
      borderRadius: radii.full,
      backgroundColor: c.borderStrong,
      overflow: 'hidden',
    },
    fill: {
      height: '100%',
      borderRadius: radii.full,
      backgroundColor: c.primary,
      transformOrigin: 'left',
    },
  });
