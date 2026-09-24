/**
 * WHAT:  The pure shaping behind AreaInsightsScreen — the 12-month series into
 *        chart columns, its spoken summary, the top makes and models into
 *        ranked rows, and the recovery rate as a sentence.
 * WHY:   Kept out of the screen so the arithmetic can be tested without
 *        rendering, and so the two places most likely to mislead are decided
 *        once, in the open:
 *          · the recovery rate's DENOMINATOR
 *          · whether a rate should be shown at all
 * LINKS: ../api/areaInsightsApi.ts; ../screens/AreaInsightsScreen.tsx;
 *        supabase/migrations/20260811160000_area_insights_bucket_floor_owner.sql;
 *        src/features/vehicles/lib/postStatsModel.ts (toSparkline — the sibling).
 */

import { canonicaliseMake } from '@/shared/lib/carMakes';
import { canonicaliseModel } from '@/shared/lib/carModels';

/** One column of the 12-month chart, ready to draw. */
export interface MonthlyColumn {
  /** The `YYYY-MM` string — the column's key. */
  key: string;
  count: number;
  /** 0..1 of the busiest month; 0 for a real zero. */
  fraction: number;
  /** "Sep" under this column, or null when this column goes unlabelled. */
  label: string | null;
}

/**
 * The monthly series as chart columns.
 *
 * The server sends a DENSE series — every month, zeros included — unlike the
 * per-post day series, which is sparse and has to be filled in. So this only
 * scales; it never invents a bucket.
 *
 * Month names go under EVERY OTHER column, counted back from the last: twelve
 * three-letter names do not fit twelve ~20pt columns on a phone, and the most
 * recent month is the one a reader orients by, so it is always the one named.
 * A malformed month string gets no label rather than a wrong one.
 */
export function monthlyColumns(monthly: { month: string; count: number }[]): MonthlyColumn[] {
  if (monthly.length === 0) return [];
  const busiest = Math.max(...monthly.map((m) => m.count));
  const last = monthly.length - 1;
  return monthly.map((m, index) => ({
    key: m.month,
    count: m.count,
    // A month with no thefts is a real 0 and must draw as the empty stub, not
    // as a nub — dividing by a busiest of 0 would otherwise give NaN.
    fraction: busiest > 0 ? m.count / busiest : 0,
    label: (last - index) % 2 === 0 ? monthAbbrev(m.month) : null,
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
  // The busiest month is NAMED, not just counted: "Busiest month 11" under a
  // chart with no axis labels read as either November or eleven cars. The
  // month string is `YYYY-MM`; a malformed one falls back to the count alone.
  const peak = active.reduce((best, m) => (m.count > best.count ? m : best), active[0]);
  const name = monthName(peak.month);
  return (
    `Cars reported stolen in ${active.length} of the last 12 months. ` +
    (name ? `The busiest was ${name}, with ${peak.count}.` : `The busiest month had ${peak.count}.`)
  );
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-03" → "March"; anything else → null. */
function monthName(month: string): string | null {
  const index = Number(month.slice(5, 7)) - 1;
  return /^\d{4}-\d{2}$/.test(month) && index >= 0 && index < 12 ? MONTH_NAMES[index] : null;
}

/** "2026-03" → "Mar"; anything else → null. */
function monthAbbrev(month: string): string | null {
  const name = monthName(month);
  return name ? name.slice(0, 3) : null;
}

/** One row of a ranked list, ready to draw. */
export interface RankedRow {
  key: string;
  label: string;
  count: number;
  /** 0..1 of the top row — the bar's length. */
  fraction: number;
  /** A quiet line beneath the bar — "Fiesta 3 · Focus 2" — or null. */
  detail: string | null;
}

/**
 * The RPC's top makes as display rows: canonical names, same-make spellings
 * merged, re-ranked, each carrying its own models beneath.
 *
 * The RPC folds make with lower(btrim(...)) and does NOT equate "vw" with
 * "volkswagen" — so it can hand back "bmw", "vw" AND "volkswagen" as three
 * rows, and the screen used to render them as typed with a caption apologising
 * for it. `canonicaliseMake` is the app's own answer to that (the make picker
 * runs every stored make through it), so it runs here too: "bmw" → "BMW",
 * "vw" → "Volkswagen", and two rows that land on one name add up. The sum is
 * exact — each row is that spelling's full count — so merging never invents.
 * A spelling the alias table does not know stays as typed, which is the same
 * promise the picker makes.
 *
 * MODELS RIDE ON THEIR MAKE (owner decision 2026-09-22, "add the model as
 * well rather than just the make"). The RPC's top make+model pairs are a
 * separate ranking, and they were drawn as one — a second block the reader
 * had to relate to the first by eye. Now each pair is filed under its make's
 * row as a detail line, "Fiesta 3 · Focus 2", busiest first, the model
 * canonical against its make's own list (canonicaliseModel is keyed by the
 * canonical make label, so the make goes first). A pair whose make is not in
 * the top five is dropped rather than given a row of its own: the list is
 * "which makes", and a model with no make above it has nowhere to sit.
 *
 * ⚠️ Every pair here has already cleared the RPC's per-bucket floor (five
 * thefts of that exact model, from listings the viewer does not own), so in
 * most areas most makes carry NO detail line. That is the privacy floor
 * doing its job — "one Urus stolen near here" points at a person — and this
 * file must never fill the gap from anywhere else.
 */
export function rankedMakes(
  topMakes: { make: string; count: number }[],
  topModels: { make: string; model: string; count: number }[] = [],
): RankedRow[] {
  const makes = rank(topMakes.map((row) => ({ label: canonicaliseMake(row.make), count: row.count })));
  // Models per canonical make, same-spelling pairs merged, busiest first.
  const byMake = new Map<string, Map<string, number>>();
  for (const pair of topModels) {
    const make = canonicaliseMake(pair.make);
    const model = canonicaliseModel(make, pair.model);
    const models = byMake.get(make) ?? new Map<string, number>();
    models.set(model, (models.get(model) ?? 0) + pair.count);
    byMake.set(make, models);
  }
  return makes.map((row) => {
    const models = byMake.get(row.label);
    if (!models) return row;
    const entries = [...models.entries()]
      // ⚠️ A model can only be shown under a make it fits inside. The two
      // top-5s are independent and computed over RAW spellings, so a make
      // that arrives split ("volkswagen" 5) can meet a model that arrived
      // whole ("vw Golf" 6) — and "Golf 6" under a "Volkswagen 5" bar is a
      // detail bigger than the thing it details. Both numbers are true; the
      // pairing is what we cannot vouch for, so the entry is dropped.
      .filter(([, count]) => count <= row.count)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (entries.length === 0) return row;
    return { ...row, detail: entries.map(([model, count]) => `${model} ${count}`).join(' · ') };
  });
}

/** Merge rows sharing a label, sort by count (ties by label), scale to the top. */
function rank(rows: { label: string; count: number }[]): RankedRow[] {
  const merged = new Map<string, number>();
  for (const row of rows) {
    merged.set(row.label, (merged.get(row.label) ?? 0) + row.count);
  }
  const sorted = [...merged.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const top = sorted[0]?.count ?? 0;
  return sorted.map((row) => ({
    key: row.label,
    label: row.label,
    count: row.count,
    fraction: top > 0 ? row.count / top : 0,
    detail: null,
  }));
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
  /** Whole percent, 0–100. */
  percent: number;
  recovered: number;
  /** Closed without the car coming back. */
  notRecovered: number;
  closedTotal: number;
  /** 0..1 — the proportion bar's fill. */
  fraction: number;
  /** What a screen reader hears for the whole figure. */
  spoken: string;
  caveat: string;
}

/**
 * The recovery rate as figures, or null when it should not be stated.
 *
 * ⚠️ THE DENOMINATOR IS CLOSED LISTINGS, NEVER ALL OF THEM. An active listing
 * has not failed to be recovered — it is still out being looked for — and
 * counting it as a miss would drag the rate down by however many cars are
 * currently in flight, which is exactly the cars this product is working on.
 * The RPC computes `closed_total` for that reason; using `total` here would
 * throw the care away at the last step.
 *
 * Figures rather than a finished sentence (2026-09-22, the card's redesign):
 * the screen draws the rate as a percent, a proportion bar and a two-cell
 * band, and each of those wants the numbers, not the prose. The caveat is
 * still authored here, because it is the one sentence that must never be
 * separated from the number.
 */
export function recoveryRate(recovered: number, closedTotal: number): RecoveryRate | null {
  if (closedTotal < MIN_CLOSED_FOR_RATE) return null;

  // ⚠️ Clamped before any arithmetic. `closedTotal - recovered` renders as its
  // own cell in the band, so a payload where recovered somehow exceeds the
  // closed total would print "-2 not recovered" beside a 140% bar. The bar
  // clamps; a numeral cannot. Every figure below is derived from the clamped
  // value so they cannot disagree with each other.
  const safeRecovered = Math.min(Math.max(recovered, 0), closedTotal);
  const fraction = safeRecovered / closedTotal;
  const percent = Math.round(fraction * 100);
  return {
    percent,
    recovered: safeRecovered,
    notRecovered: closedTotal - safeRecovered,
    closedTotal,
    fraction,
    spoken: `${percent}% recovered: ${safeRecovered} of the ${closedTotal} nearby listings that have finished.`,
    caveat: 'Of nearby listings that have finished. Cars still being looked for aren’t counted either way.',
  };
}
