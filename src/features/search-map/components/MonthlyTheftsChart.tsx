/**
 * WHAT:  MonthlyTheftsChart — the area theft-stats page's 12-month bar chart:
 *        a count above every bar, the bars on a baseline, month names under
 *        every other bar. Plain Views, no SVG (StatsSparkline's reasoning).
 * WHY:   The page used to draw this with StatsSparkline, the per-post
 *        sightings-per-day chart — twelve unlabelled bars with no values and
 *        no axis, and a caption underneath doing all the reading. The owner
 *        found it "not very easy to read or understand, there are no labels
 *        or anything" (2026-09-22). That component is right for its own page:
 *        28 days is too many columns to label, and the sightings count is the
 *        headline above it. A year is twelve columns, each wide enough to
 *        carry its own number, and the numbers ARE the information here —
 *        "7 in March" is what a worried owner wants, not the shape of a
 *        silhouette.
 *
 *        WHAT IS LABELLED, AND WHY NOT MORE:
 *          · A count above EVERY bar, "0" included. The empty stub says
 *            "zero" to an eye that already knows the chart; a numeral says it
 *            to everyone. Zero is in textSecondary so the year's quiet months
 *            recede and its busy ones stand out.
 *          · A month name under every OTHER bar, counted back from the last,
 *            so the most recent month is always named (monthlyColumns). Twelve
 *            names at caption size need ~22pt columns; the card interior is
 *            ~280–310pt, so every other is the honest density.
 *          · A hairline baseline. Twelve bars floating in white read as a
 *            decoration; on a line they read as a chart.
 *          · NO y-axis, gridlines or colour coding. The counts make the axis
 *            redundant, and severity colour on a theft chart is an alarm
 *            (owner decision 2026-09-21: calm and factual).
 *
 *        The names are wider than a column, so they are positioned from a
 *        measured column width rather than laid out in flex cells: a Text in a
 *        20pt cell would ellipsise "Sep" to "S…". Until the row has measured
 *        (one frame) the names are simply not drawn.
 *
 *        ONE node to a screen reader, like StatsSparkline: the summary sentence
 *        from monthlySummary carries the distribution, and 36 inner labels
 *        would be noise to swipe through.
 *
 *        `growIn`: the bars rise from the baseline once, over motion.slow —
 *        one scaleY on the bar row from a bottom origin, not a per-bar race —
 *        the labels stay put. Under reduced motion the bars are simply there.
 * LINKS: ../lib/areaInsightsModel.ts (monthlyColumns, monthlySummary);
 *        ../screens/AreaInsightsScreen.tsx (the consumer);
 *        src/features/vehicles/components/StatsSparkline.tsx (the sibling
 *          this replaced here, and the bar-drawing rules it keeps).
 */

import { useEffect, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
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

import type { MonthlyColumn } from '../lib/areaInsightsModel';

export interface MonthlyTheftsChartProps {
  columns: MonthlyColumn[];
  /** What a screen reader hears for the whole chart. */
  summary: string;
  /** Rise from the baseline on first render. */
  growIn?: boolean;
}

export function MonthlyTheftsChart({ columns, summary, growIn = false }: MonthlyTheftsChartProps) {
  const styles = useThemedStyles(makeStyles);
  const reducedMotion = useReducedMotion();
  // Starts collapsed only when asked to grow AND motion is on, so a static
  // chart never flashes flat. Hooks sit above the early return.
  const animateIn = growIn && !reducedMotion;
  const rise = useSharedValue(animateIn ? 0 : 1);
  useEffect(() => {
    if (!animateIn) return;
    rise.value = withTiming(1, {
      duration: motion.slow,
      easing: easeOut,
      reduceMotion: ReduceMotion.System,
    });
  }, [animateIn, rise]);
  const riseStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: rise.value }] }));

  // The row's measured width, for placing the month names (see WHAT).
  const [rowWidth, setRowWidth] = useState(0);
  const onRowLayout = (event: LayoutChangeEvent) => setRowWidth(event.nativeEvent.layout.width);

  if (columns.length === 0) {
    return null;
  }

  const gap = sizes.monthlyChartGap;
  const columnWidth = (rowWidth - gap * (columns.length - 1)) / columns.length;
  // Each name is allowed two columns' width, centred on its own column.
  const labelWidth = columnWidth * 2 + gap;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={summary}
      testID="monthly-thefts-chart"
    >
      {/* Counts: one flex cell per column, mirroring the bar row exactly. A
          three-digit count shrinks inside its cell rather than spilling into
          its neighbour. */}
      <View style={styles.row}>
        {columns.map((column) => (
          <View key={column.key} style={styles.cell}>
            <Text
              style={[styles.count, column.count === 0 && styles.countZero]}
              numberOfLines={1}
              adjustsFontSizeToFit
              testID={`chart-count-${column.key}`}
            >
              {column.count}
            </Text>
          </View>
        ))}
      </View>

      {/* Bars, on a baseline. TOP corners only (StatsSparkline): a rounded
          bottom on a ~20pt bar turns the minimum nub into a floating dot. */}
      <Animated.View
        style={[styles.row, styles.bars, riseStyle]}
        onLayout={onRowLayout}
        testID="monthly-thefts-bars"
      >
        {columns.map((column) => (
          <View
            key={column.key}
            style={[
              styles.bar,
              column.count > 0
                ? [
                    styles.barFilled,
                    // A month with thefts gets at least a visible nub, so "one"
                    // never rounds away into the empty stub.
                    { height: Math.max(column.fraction * sizes.monthlyChartHeight, sizes.sparklineMin) },
                  ]
                : styles.barEmpty,
            ]}
          />
        ))}
      </Animated.View>

      {/* Month names, placed from the measured column width. */}
      <View style={styles.names}>
        {rowWidth > 0
          ? columns.map((column, index) =>
              column.label ? (
                <Text
                  key={column.key}
                  style={[
                    styles.name,
                    {
                      width: labelWidth,
                      left: index * (columnWidth + gap) + columnWidth / 2 - labelWidth / 2,
                    },
                  ]}
                  numberOfLines={1}
                  testID={`chart-month-${column.key}`}
                >
                  {column.label}
                </Text>
              ) : null,
            )
          : null}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: sizes.monthlyChartGap,
    },
    cell: { flex: 1, alignItems: 'center' },
    count: { ...typography.caption, color: c.textPrimary },
    countZero: { color: c.textSecondary },
    bars: {
      alignItems: 'flex-end',
      height: sizes.monthlyChartHeight,
      marginTop: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
      transformOrigin: 'bottom',
    },
    bar: {
      flex: 1,
      borderTopLeftRadius: radii.sm,
      borderTopRightRadius: radii.sm,
    },
    barFilled: { backgroundColor: c.primary },
    // The zero stub is textSecondary, not `border`: it is the axis, i.e.
    // information, and owes the 3:1 graphic floor (StatsSparkline measured
    // this — `border` is ~1.4:1 and simply is not there).
    barEmpty: { height: sizes.sparklineEmpty, backgroundColor: c.textSecondary },
    names: {
      height: typography.caption.lineHeight,
      marginTop: spacing.xs,
    },
    name: {
      ...typography.caption,
      color: c.textSecondary,
      position: 'absolute',
      textAlign: 'center',
    },
  });
