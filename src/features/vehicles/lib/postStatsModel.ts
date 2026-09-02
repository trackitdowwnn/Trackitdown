/**
 * WHAT:  The pure arithmetic behind the stats screen — how old the listing is,
 *        how long it has left, and turning the server's sparse day series into
 *        a dense, bounded, normalised set of bars.
 * WHY:   Every edge case here is a real listing. A post created ten minutes
 *        ago has an age of zero days; a post whose sightings all landed on one
 *        day has a flat series that must not divide by zero; a post with one
 *        sighting must draw one bar, not a broken line; a post from four months
 *        ago must not try to draw 120 bars on a phone. None of that is visible
 *        in a screenshot until it is wrong, and all of it is cheap to assert —
 *        which is why it lives out here rather than inside the screen.
 * LINKS: src/features/vehicles/api/postStatsApi.ts (PostStats);
 *        src/features/vehicles/screens/PostStatsScreen.tsx (the consumer);
 *        src/features/vehicles/components/StatsSparkline.tsx.
 */

import type { PostStatsDay } from '../api/postStatsApi';

/** How many days the chart shows. Four weeks reads as "recent activity" and
 *  fits as bars on the narrowest phone without becoming hairlines. */
export const SPARKLINE_DAYS = 28;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** ELAPSED whole 24h periods between two instants, floored at 0 — deliberately
 *  NOT calendar days: 23:00 Thursday → 14:00 Friday is 0 here and 1 on the
 *  calendar. Elapsed is the right reading of "live for N days", because a
 *  listing posted last night has not been live for a day.
 *
 *  This is unrelated to the chart's bucketing (see toSparkline), which IS
 *  calendar-based; the two answer different questions and are allowed to
 *  differ. An earlier version of this comment claimed both matched the
 *  server's `date_trunc('day', …)` — wrong twice over, since the server
 *  deliberately does not use date_trunc at all. */
export function wholeDaysBetween(fromIso: string, toMs: number): number {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) {
    return 0;
  }
  return Math.max(0, Math.floor((toMs - from) / MS_PER_DAY));
}

/*
 * ⚠️ `daysRemaining` WAS HERE, AND IS DELETED (2026-09-02, review finding #18).
 *
 * It computed the days left until posts.expires_at, which create_post stamps at
 * +90 days and which NOTHING has ever acted on: passive expiry was cut
 * deliberately ("we are cutting the PROMISE, not building the machine"). So the
 * date never arrives, the listing never closes, and PostStatsScreen counted
 * down to nothing. The Terms already say the true thing — a listing stays live
 * until you cancel it or the car is recovered.
 *
 * It was careful code: rounding up so six hours left still read as a day,
 * flooring at 0 rather than going negative, null for a draft with no clock.
 * That is what made it worth deleting rather than fixing — well-tested
 * arithmetic over a meaningless number reads as maintained, and three passing
 * tests were the strongest evidence that the countdown was real.
 *
 * An owner IS now asked whether the car is still missing, on a schedule, from
 * the listing itself (ADR-0019). That is the honest replacement.
 */

/** One bar: a day, its count, and its height as a 0..1 fraction of the tallest. */
export interface SparklineBar {
  day: string;
  count: number;
  /** 0..1. A day with no sightings is 0; the busiest day is 1. */
  fraction: number;
}

/**
 * Turn the server's SPARSE series (only days that have sightings) into a dense
 * run of `days` bars ending today, each scaled against the busiest day shown.
 *
 * Dense because a gap is the information: three sightings in one week then
 * nothing for a fortnight is the shape an owner needs to see, and a chart that
 * simply omits the quiet days would draw that as steady activity.
 *
 * Returns [] when there is nothing at all — the screen shows a sentence
 * instead of an empty axis.
 */
export function toSparkline(
  byDay: PostStatsDay[],
  nowMs: number,
  days: number = SPARKLINE_DAYS,
): SparklineBar[] {
  if (byDay.length === 0 || days <= 0) {
    return [];
  }
  const counts = new Map(byDay.map((row) => [row.day, row.count]));

  // Anchor on the UTC day, matching the server's `(created_at at time zone
  // 'UTC')::date`, so a bar lines up with the day it was counted in rather than
  // with the phone's timezone.
  //
  // NOT date_trunc — the server avoids it on purpose, because date_trunc over a
  // timestamptz buckets by the SESSION timezone, and a 23:30 UTC sighting would
  // then land on a key this loop never looks up and its bar would silently
  // vanish. Pinned by CHECK 16(d) under Asia/Tokyo.
  const todayUtc = new Date(nowMs);
  todayUtc.setUTCHours(0, 0, 0, 0);

  const bars: SparklineBar[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const dayMs = todayUtc.getTime() - offset * MS_PER_DAY;
    const key = new Date(dayMs).toISOString().slice(0, 10);
    bars.push({ day: key, count: counts.get(key) ?? 0, fraction: 0 });
  }

  const tallest = Math.max(...bars.map((bar) => bar.count));
  if (tallest === 0) {
    // Every sighting is older than the window. Drawing a flat row of nothing
    // would say "no activity ever", which is false — the screen drops the
    // chart and keeps the first/last-sighting line, which is the true story.
    return [];
  }
  // Divide only by a positive tallest: a single-sighting listing and a listing
  // whose days are all equal both end up at fraction 1, not NaN.
  return bars.map((bar) => ({ ...bar, fraction: bar.count / tallest }));
}
