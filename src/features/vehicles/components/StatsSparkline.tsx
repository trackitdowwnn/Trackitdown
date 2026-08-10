/**
 * WHAT:  StatsSparkline — the sightings-per-day bars on the stats screen.
 *        Plain Views, no SVG: 28 rounded columns is a job for flexbox.
 * WHY:   react-native-svg is already a dependency (SightingTimeline draws a
 *        real curve with it), but reaching for it here would be ceremony — a
 *        bar chart of fixed-width columns needs no path maths, and Views cost
 *        no bridge traffic and inherit the theme's radii directly.
 *
 *        EVERY day is drawn, including the empty ones, and the empty stub has
 *        to be VISIBLE. The gap is the information: a burst of reports then a
 *        fortnight of silence is the shape an owner needs, and without a legible
 *        axis the busy days float and read as steady activity — the exact
 *        misreading drawing them was meant to prevent.
 *
 *        The stub is `textSecondary`, and the journey there is the point.
 *        `border` (#DDDDDD) is ~1.36:1 and simply is not there. `borderStrong`
 *        replaced it, justified as "3.03:1 on a white card" — borrowing
 *        RadiusSlider's and MoneySlider's reasoning along with the value. Then
 *        the Airbnb pass removed the cards, and the chart moved onto the
 *        `background` token (#F7F7F7), where #949494 measures 2.83:1 — under the
 *        3:1 graphic minimum. The number never changed; the surface underneath
 *        it did, and the comment kept asserting a card that was gone. These
 *        stubs are the axis, i.e. information, so they owe the full 3:1;
 *        textSecondary is 5.05:1 on background and 5.4:1 on surface, so it holds
 *        wherever this component is later placed. The dark palette keeps the
 *        floor by construction — #A3A3A3 is ~7:1 on #141414 and ~6.4:1 on
 *        #1E1E1E — and the tokens are now read at RENDER time, so the bars
 *        follow whichever palette is in effect rather than the one that
 *        happened to be loaded first.
 *
 *        NOT memo()-wrapped, deliberately: `bars` is rebuilt by toSparkline on
 *        every render of the screen, so a memo could never hit — and a memo
 *        that cannot fire is a false claim that this render is worth
 *        protecting. Twenty-eight Views on a screen that re-renders only when
 *        a fetch lands is not.
 * LINKS: src/features/vehicles/lib/postStatsModel.ts (toSparkline — the
 *          bucketing and the 0..1 scaling this only renders);
 *        src/features/vehicles/screens/PostStatsScreen.tsx;
 *        src/shared/ui/RadiusSlider.tsx (the borderStrong precedent).
 */

import { StyleSheet, View } from 'react-native';

import { timeAgo } from '@/shared/lib';
import { radii, sizes, usePalette } from '@/shared/theme';

import type { SparklineBar } from '../lib/postStatsModel';

export interface StatsSparklineProps {
  bars: SparklineBar[];
  /** Drawn height of the tallest bar. */
  height?: number;
}

/**
 * What the chart says that the numbers above it do not: WHEN the reports came.
 * A label naming only the axis ("sightings per day over 28 days") describes the
 * frame and omits the picture — the distribution is the chart's whole reason to
 * exist and is spoken nowhere else on the page.
 */
function spokenSummary(bars: SparklineBar[]): string {
  const active = bars.filter((bar) => bar.count > 0);
  // Not reachable through toSparkline, which returns [] rather than an all-zero
  // row — but that invariant lives in another file and this component's props
  // permit the array. Without this, Math.max(...[]) is -Infinity and the
  // `latest` lookup below is undefined, so the label throws and takes the
  // screen down with it.
  if (active.length === 0) {
    return `No sightings in the last ${bars.length} days.`;
  }
  const busiest = Math.max(...active.map((bar) => bar.count));
  const latest = active[active.length - 1];
  return (
    `Sightings on ${active.length} of the last ${bars.length} days. ` +
    `Busiest day ${busiest}. Most recent ${timeAgo(`${latest.day}T12:00:00Z`)}.`
  );
}

export function StatsSparkline({
  bars,
  height = sizes.sparklineHeight,
}: StatsSparklineProps) {
  const palette = usePalette();
  if (bars.length === 0) {
    return null;
  }
  return (
    <View
      style={[styles.row, { height }]}
      // ONE object to a screen reader. The individual columns are deliberately
      // not focusable: 28 stubs is noise to swipe through, and the counts above
      // already carry the totals — so the label has to carry the DISTRIBUTION,
      // which is the part only this chart says.
      accessible
      accessibilityRole="image"
      accessibilityLabel={spokenSummary(bars)}
      // The hook the "chart is dropped when it would mislead" tests hang on.
      // They matched the a11y label until 2026-08-08 and silently stopped
      // testing anything when the label's wording changed — a testID cannot
      // drift with copy.
      testID="stats-sparkline"
    >
      {bars.map((bar) => (
        <View
          key={bar.day}
          style={[
            styles.bar,
            {
              // A day with sightings gets at least a visible nub, so "one
              // sighting" never rounds away into the empty-day stub.
              height:
                bar.count > 0
                  ? Math.max(bar.fraction * height, sizes.sparklineMin)
                  : sizes.sparklineEmpty,
              backgroundColor: bar.count > 0 ? palette.primary : palette.textSecondary,
            },
          ]}
        />
      ))}
    </View>
  );
}

// Stays a module-level sheet: geometry only. Both bar colours are inline
// because they are a per-bar DECISION, not a static style.
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: sizes.sparklineGap,
  },
  bar: {
    flex: 1,
    // TOP corners only. RN clamps a radius to half the shorter side, so a
    // rounded bottom on an ~8pt-wide bar turns the minimum nub into a floating
    // dot and lifts every bar off the axis.
    borderTopLeftRadius: radii.sm,
    borderTopRightRadius: radii.sm,
  },
});
