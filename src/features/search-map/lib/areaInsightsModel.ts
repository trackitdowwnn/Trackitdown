/**
 * WHAT:  The pure shaping behind AreaInsightsScreen — the 12-month series into
 *        chart bars, its spoken summary, and the recovery rate as a sentence.
 * WHY:   Kept out of the screen so the arithmetic can be tested without
 *        rendering, and so the two places most likely to mislead are decided
 *        once, in the open:
 *          · the recovery rate's DENOMINATOR
 *          · whether a rate should be shown at all
 * LINKS: ../api/areaInsightsApi.ts; ../screens/AreaInsightsScreen.tsx;
 *        supabase/migrations/20260811160000_area_insights_bucket_floor_owner.sql;
 *        src/features/vehicles/lib/postStatsModel.ts (toSparkline — the sibling).
 */

import type { SparklineBar } from '@/features/vehicles';

/**
 * The monthly series as chart bars.
 *
 * The server sends a DENSE series — every month, zeros included — unlike the
 * per-post day series, which is sparse and has to be filled in. So this only
 * scales; it never invents a bucket. `day` carries the month string because that
 * is the bar's key, and the chart is agnostic about what a bucket means.
 */
export function toMonthlyBars(monthly: { month: string; count: number }[]): SparklineBar[] {
  if (monthly.length === 0) return [];
  const busiest = Math.max(...monthly.map((m) => m.count));
  return monthly.map((m) => ({
    day: m.month,
    count: m.count,
    // A month with no thefts is a real 0 and must draw as the empty stub, not
    // as a nub — dividing by a busiest of 0 would otherwise give NaN.
    fraction: busiest > 0 ? m.count / busiest : 0,
  }));
}

/**
 * The spoken summary for the monthly chart.
 *
 * StatsSparkline's own summary is written for sightings-per-day and would tell a
 * screen reader something plainly untrue here. The distribution is the only
 * thing the chart says that the numbers above it do not, so the label has to
 * carry it.
 */
export function monthlySummary(monthly: { month: string; count: number }[]): string {
  const active = monthly.filter((m) => m.count > 0);
  if (active.length === 0) {
    return 'No cars reported stolen here in the last 12 months.';
  }
  const busiest = Math.max(...active.map((m) => m.count));
  return (
    `Cars reported stolen in ${active.length} of the last 12 months. ` +
    `Busiest month ${busiest}.`
  );
}

/**
 * Below this many closed listings, a percentage is noise dressed as a fact.
 *
 * Three closed listings and one recovery is "33%", which reads as a property of
 * the area and is really a property of three cars. The RPC already suppresses
 * the pair below its own floor of five non-owned listings; this is the second
 * guard, on the ratio rather than the disclosure.
 */
const MIN_CLOSED_FOR_RATE = 5;

export interface RecoveryRate {
  headline: string;
  caveat: string;
}

/**
 * The recovery rate as a sentence, or null when it should not be stated.
 *
 * ⚠️ THE DENOMINATOR IS CLOSED LISTINGS, NEVER ALL OF THEM. An active listing
 * has not failed to be recovered — it is still out being looked for — and
 * counting it as a miss would drag the rate down by however many cars are
 * currently in flight, which is exactly the cars this product is working on.
 * The RPC computes `closed_total` for that reason; using `total` here would
 * throw the care away at the last step.
 */
export function recoveryRateLabel(recovered: number, closedTotal: number): RecoveryRate | null {
  if (closedTotal < MIN_CLOSED_FOR_RATE) return null;

  const percent = Math.round((recovered / closedTotal) * 100);
  return {
    headline: `${percent}% came back`,
    caveat:
      `Of the ${closedTotal} nearby listings that have finished. ` +
      `Cars still being looked for aren’t counted either way.`,
  };
}
