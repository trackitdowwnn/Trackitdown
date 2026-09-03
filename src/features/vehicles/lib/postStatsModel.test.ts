/**
 * WHAT:  Tests the stats arithmetic — listing age and the
 *        sparse→dense→normalised sparkline.
 * WHY:   Every case here is a real listing, and all of them are invisible
 *        until they are wrong. A listing posted this morning (age 0), one
 *        whose sightings all landed on one day (a flat series that must not
 *        divide by zero), one with a single sighting (one bar, not a broken
 *        line), one four months old (must not try to draw 120 bars), and one
 *        whose activity is entirely older than the window (a flat row of
 *        nothing would say "never any activity", which is false).
 * LINKS: src/features/vehicles/lib/postStatsModel.ts.
 */

import {
  SPARKLINE_DAYS,
  toSparkline,
  wholeDaysBetween,
} from './postStatsModel';

/** A fixed "now" so nothing here depends on the wall clock. */
const NOW = Date.parse('2026-08-07T14:00:00Z');
const day = (iso: string, count: number) => ({ day: iso, count });

describe('wholeDaysBetween', () => {
  it('is 0 for a listing posted this morning', () => {
    expect(wholeDaysBetween('2026-08-07T06:00:00Z', NOW)).toBe(0);
  });

  it('counts whole days only', () => {
    expect(wholeDaysBetween('2026-08-05T14:00:00Z', NOW)).toBe(2);
    // 47 hours is one whole day, not two.
    expect(wholeDaysBetween('2026-08-05T15:00:00Z', NOW)).toBe(1);
  });

  // Clock skew between device and server is real; a negative age would render
  // as "-1 days live".
  it('never goes negative for a future timestamp', () => {
    expect(wholeDaysBetween('2026-08-09T00:00:00Z', NOW)).toBe(0);
  });

  it('survives an unparseable date rather than rendering NaN', () => {
    expect(wholeDaysBetween('not a date', NOW)).toBe(0);
  });
});

// `daysRemaining` and its three tests were deleted on 2026-09-02 with the
// countdown they served (review finding #18): expires_at is stamped at +90
// days and nothing has ever acted on it, so the line counted down to a date
// that never arrives. Well-tested arithmetic over a number that means nothing
// is still a lie, and the tests made it look maintained.

describe('toSparkline', () => {
  it('returns nothing at all when there are no sightings', () => {
    expect(toSparkline([], NOW)).toEqual([]);
  });

  it('draws a full window of bars ending today', () => {
    const bars = toSparkline([day('2026-08-07', 1)], NOW);

    expect(bars).toHaveLength(SPARKLINE_DAYS);
    expect(bars[bars.length - 1].day).toBe('2026-08-07');
    expect(bars[0].day).toBe('2026-07-11'); // 27 days earlier
  });

  // The gap IS the information: a burst then silence must not draw as steady
  // activity, which is what omitting the quiet days would do.
  it('fills quiet days with zeros rather than closing the gap', () => {
    const bars = toSparkline([day('2026-07-20', 3), day('2026-08-07', 1)], NOW);

    expect(bars.filter((bar) => bar.count === 0)).toHaveLength(SPARKLINE_DAYS - 2);
    expect(bars.find((bar) => bar.day === '2026-08-06')?.count).toBe(0);
  });

  // One sighting is the common case for a listing that has had any luck at all.
  it('gives a single sighting one full-height bar, not a broken chart', () => {
    const bars = toSparkline([day('2026-08-07', 1)], NOW);

    const busiest = bars.filter((bar) => bar.count > 0);
    expect(busiest).toHaveLength(1);
    expect(busiest[0].fraction).toBe(1);
  });

  // The divide-by-zero case, and the one a reviewer would never think to try.
  it('handles identical counts without producing NaN', () => {
    const bars = toSparkline([day('2026-08-05', 2), day('2026-08-06', 2)], NOW);

    for (const bar of bars) {
      expect(Number.isNaN(bar.fraction)).toBe(false);
    }
    expect(bars.filter((bar) => bar.fraction === 1)).toHaveLength(2);
  });

  it('scales every bar against the busiest day shown', () => {
    const bars = toSparkline([day('2026-08-05', 1), day('2026-08-06', 4)], NOW);

    expect(bars.find((bar) => bar.day === '2026-08-06')?.fraction).toBe(1);
    expect(bars.find((bar) => bar.day === '2026-08-05')?.fraction).toBe(0.25);
  });

  // A four-month-old listing whose activity was all in month one. A flat row
  // of empty bars would claim there was never any activity, which is false —
  // the screen drops the chart and keeps the first/last-sighting line.
  it('returns nothing when every sighting predates the window', () => {
    expect(toSparkline([day('2026-05-01', 9)], NOW)).toEqual([]);
  });

  it('never draws more bars than the window, however long the listing has run', () => {
    const oneHundred = Array.from({ length: 100 }, (_, i) =>
      day(new Date(NOW - i * 86_400_000).toISOString().slice(0, 10), 1),
    );

    expect(toSparkline(oneHundred, NOW)).toHaveLength(SPARKLINE_DAYS);
  });
});
