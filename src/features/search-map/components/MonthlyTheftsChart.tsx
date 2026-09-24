/**
 * WHAT:  MonthlyTheftsChart — the area theft-stats page's 12-month bar chart:
 *        each bar carrying its own count, the bars on a baseline, month names
 *        under every other bar. Plain Views, no SVG (StatsSparkline's
 *        reasoning).
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
 *          · Each bar CARRIES its count — inside the bar, in textOnPrimary,
 *            when the bar is tall enough to hold a numeral; perched just
 *            above it, in textPrimary, when it is not. A zero month shows
 *            only its stub on the baseline. This replaced a row of counts
 *            above the chart (owner, 2026-09-22: "I don't like the number
 *            above the bar chart, can the numbers be integrated into the bar
 *            itself") — a separate row of twelve numerals read as a table
 *            sitting on a chart; a number in its bar is one mark, not two.
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
 *        one scaleY on the bar row from a bottom origin, not a per-bar race.
 *        The counts are a SEPARATE layer over the bars, faded in over the
 *        same span, so a numeral is never squashed by the scale as its bar
 *        grows. Under reduced motion everything is simply there.
 * LINKS: ../lib/areaInsightsModel.ts (monthlyColumns, monthlySummary);
 *        ../screens/AreaInsightsScreen.tsx (the consumer);
 *        src/features/vehicles/components/StatsSparkline.tsx (the sibling
 *          this replaced here, and the bar-drawing rules it keeps).
 */

import { useEffect, useState } from 'react';
import {
  type LayoutChangeEvent,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  displayFontScaleCap,
  motion,
  radii,
  shrinkToFitMinScale,
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

/** A month with thefts gets at least a visible nub, so "one" never rounds
 *  away into the empty stub. */
const barHeight = (fraction: number) =>
  Math.max(fraction * sizes.monthlyChartHeight, sizes.sparklineMin);

/**
 * The caption's line height AT THE READER'S TEXT SIZE, capped where the
 * numerals are capped.
 *
 * ⚠️ NOT `typography.caption.lineHeight`. The inside/above decision and the
 * numeral's offset are geometry, and geometry measured at the unscaled line
 * height is wrong for everyone who has raised their text size: at 200% the
 * numeral renders ~36pt while this said 18, so a 30pt bar was judged "inside"
 * and the numeral's top half sat ABOVE the fill — `textOnPrimary`, which is
 * white in light mode, on the white card. Half the digit simply vanished.
 * ListRow reads `fontScale` the same way, `?? 1` included (jest's mock omits
 * it).
 */
const scaledCaptionLine = (fontScale: number | undefined) =>
  typography.caption.lineHeight * Math.min(fontScale ?? 1, displayFontScaleCap);

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
  // The counts fade in over the same span the bars rise, in their own layer,
  // so the scale never squashes a numeral.
  const countsStyle = useAnimatedStyle(() => ({ opacity: rise.value }));

  const { fontScale } = useWindowDimensions();
  const captionLine = scaledCaptionLine(fontScale);
  /** The shortest bar that can hold its numeral: the line plus a 4pt breath
   *  above and below. Shorter bars wear theirs on top. */
  const countInsideMin = captionLine + spacing.xs * 2;

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
      <View style={styles.plot}>
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
                  ? [styles.barFilled, { height: barHeight(column.fraction) }]
                  : styles.barEmpty,
              ]}
            />
          ))}
        </Animated.View>

        {/* Counts, a layer over the bars: one flex cell per column mirroring
            the bar row, each numeral bottom-anchored at its bar's height —
            tucked INSIDE the bar's top when the bar can hold it, perched just
            above it when it cannot. Zero shows nothing but its stub. A
            three-digit count shrinks inside its cell rather than spilling
            into its neighbour. */}
        <Animated.View style={[styles.row, styles.counts, countsStyle]} pointerEvents="none">
          {columns.map((column) => {
            if (column.count === 0) {
              return <View key={column.key} style={styles.cell} />;
            }
            const height = barHeight(column.fraction);
            const inside = height >= countInsideMin;
            return (
              <View key={column.key} style={styles.cell}>
                <Text
                  style={[
                    styles.count,
                    inside ? styles.countInside : styles.countAbove,
                    {
                      marginBottom: inside
                        ? height - captionLine - spacing.xs
                        : height + spacing.xs,
                    },
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={shrinkToFitMinScale}
                  maxFontSizeMultiplier={displayFontScaleCap}
                  testID={`chart-count-${column.key}`}
                >
                  {column.count}
                </Text>
              </View>
            );
          })}
        </Animated.View>
      </View>

      {/* Month names, placed from the measured column width. The strip is
          sized from the SCALED line for the same reason the numerals are:
          a fixed 18pt box holding absolutely-positioned text spills into the
          card's padding the moment the reader raises their text size. */}
      <View style={[styles.names, { height: captionLine }]}>
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
                  maxFontSizeMultiplier={displayFontScaleCap}
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
    // The plot is the bar row's height plus headroom for a numeral perched
    // above a short bar near the top — which cannot happen (a bar tall
    // enough to reach the top holds its numeral inside) — so just the row.
    //
    // ⚠️ THE BASELINE BELONGS HERE, NOT ON `bars`. On the bar row it sat
    // inside the grow-in's scaleY, so the axis collapsed to nothing and grew
    // with the bars instead of being the fixed line they rise FROM. And it is
    // `textSecondary`, not `border`: this rule is the axis, i.e. information,
    // and owes the 3:1 graphic floor — `border` is #333 on #1E1E1E in dark
    // (~1.3:1), which is the "twelve bars floating" this file's WHAT block
    // says the chart must never be. Same reasoning, same token as the zero
    // stubs below.
    plot: {
      height: sizes.monthlyChartHeight,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.textSecondary,
    },
    bars: {
      ...StyleSheet.absoluteFill,
      alignItems: 'flex-end',
      transformOrigin: 'bottom',
    },
    counts: {
      ...StyleSheet.absoluteFill,
      alignItems: 'flex-end',
    },
    cell: { flex: 1, alignItems: 'center' },
    count: { ...typography.caption },
    // In its bar: the ink for a `primary` fill (16.5:1 in light; the pair
    // swaps together in dark).
    countInside: { color: c.textOnPrimary },
    // On its bar, too short to hold it.
    countAbove: { color: c.textPrimary },
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
    // Height is set inline from the scaled caption line (see the render).
    names: { marginTop: spacing.xs },
    name: {
      ...typography.caption,
      color: c.textSecondary,
      position: 'absolute',
      textAlign: 'center',
    },
  });
