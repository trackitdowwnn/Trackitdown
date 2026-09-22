/**
 * WHAT:  RankedBars — a ranked list drawn as bars: each row a name on the
 *        left, its count on the right, and beneath them a thin bar scaled to
 *        the top row. Plain Views.
 * WHY:   The "Taken most often" card used to be ten label/value rows — five
 *        makes, then five make+model pairs indented in grey beneath the LAST
 *        make, as if they were its children. They are a separate ranking, and
 *        nothing said so; the owner asked for the section redesigned
 *        (2026-09-22). A ranking is a comparison, and a comparison wants a
 *        length to compare: with a bar under each name the order, the gap
 *        between first and second, and a distant fifth are all visible before
 *        a single number is read. The numbers stay — value leading its label
 *        by weight, as everywhere on this page — because "6" is the fact and
 *        the bar is only its shape.
 *
 *        The bar is a `sliderTrack`-height rule in `borderStrong` with a
 *        `primary` fill — RadiusSlider's own anatomy, so the page's two
 *        horizontal bars are the same bar (its note on `borderStrong`: a
 *        hairline track vanishes on this background). No colour per row, no
 *        rank numerals: the length IS the rank, and severity colour on a
 *        theft page is an alarm.
 *
 *        Each row is ONE accessible node ("Ford: 6"), as StatBand reasons — a
 *        name and a bare number swiped separately have to be paired up by
 *        the listener. The bar is decoration to a screen reader.
 *
 *        `growIn`: the fills extend from the left once, over motion.slow — one
 *        scaleX on every fill from a left origin, the same movement the year
 *        chart makes vertically. Under reduced motion they are simply there.
 * LINKS: ../lib/areaInsightsModel.ts (rankedMakes / rankedModels);
 *        ../screens/AreaInsightsScreen.tsx (the consumer);
 *        src/shared/ui/RadiusSlider.tsx (the track anatomy);
 *        ./MonthlyTheftsChart.tsx (the same grow-in, vertically).
 */

import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  ReduceMotion,
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
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { easeOut } from '@/shared/theme/motionEasing';

import type { RankedRow } from '../lib/areaInsightsModel';

export interface RankedBarsProps {
  rows: RankedRow[];
  /** Extend the fills from the left on first render. */
  growIn?: boolean;
  testID?: string;
}

export function RankedBars({ rows, growIn = false, testID }: RankedBarsProps) {
  const styles = useThemedStyles(makeStyles);
  const reducedMotion = useReducedMotion();
  // Starts collapsed only when asked to grow AND motion is on, so a static
  // list never flashes empty. Hooks sit above the early return.
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

  if (rows.length === 0) {
    return null;
  }

  return (
    <View style={styles.list} testID={testID}>
      {rows.map((row) => (
        <View
          key={row.key}
          style={styles.row}
          accessible
          accessibilityLabel={`${row.label}: ${row.count}`}
          testID={testID ? `${testID}-${row.key}` : undefined}
        >
          <View style={styles.line}>
            {/* Two lines, not one: an owner-typed "Mercedes-Benz E-Class
                Estate" at large type is a name lost if it ellipsises. */}
            <Text style={styles.label} numberOfLines={2}>
              {row.label}
            </Text>
            <Text style={styles.count}>{row.count}</Text>
          </View>
          <View style={styles.track}>
            <Animated.View
              style={[styles.fill, { width: `${row.fraction * 100}%` }, extendStyle]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    list: { gap: spacing.md },
    row: { gap: spacing.xs },
    line: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      gap: spacing.md,
    },
    label: { ...typography.body, color: c.textPrimary, flexShrink: 1 },
    // The count is the information and the name beside it is its label, so
    // the emphasis runs value-first — the same way round as StatBand.
    count: { ...typography.cardTitle, color: c.textPrimary },
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
