/**
 * WHAT:  Tests for the area-insights shaping — the monthly bars, the spoken
 *        summary, and the recovery rate.
 * WHY:   Two of these are the places this screen could most easily mislead
 *        someone: a recovery rate computed over the wrong denominator, and a
 *        percentage stated from too few cars to mean anything. Both are decided
 *        here, so both are pinned here.
 * LINKS: ./areaInsightsModel.ts;
 *        supabase/migrations/20260811160000_area_insights_bucket_floor_owner.sql.
 */

import { monthlySummary, recoveryRateLabel, toMonthlyBars } from './areaInsightsModel';

describe('toMonthlyBars', () => {
  it('scales against the busiest month and keeps the zeros', () => {
    // The server series is DENSE — a quiet month is a real zero, not a gap —
    // so this only scales and must never drop a bucket.
    const bars = toMonthlyBars([
      { month: '2026-01', count: 0 },
      { month: '2026-02', count: 5 },
      { month: '2026-03', count: 10 },
    ]);

    expect(bars).toHaveLength(3);
    expect(bars[0]).toEqual({ day: '2026-01', count: 0, fraction: 0 });
    expect(bars[1].fraction).toBeCloseTo(0.5);
    expect(bars[2].fraction).toBe(1);
  });

  it('does not divide by zero on a year with no thefts', () => {
    // Every fraction would be NaN, which renders as a bar of height NaN and
    // takes the chart down with it.
    const bars = toMonthlyBars([
      { month: '2026-01', count: 0 },
      { month: '2026-02', count: 0 },
    ]);
    expect(bars.every((b) => b.fraction === 0)).toBe(true);
  });

  it('returns nothing for an empty series', () => {
    expect(toMonthlyBars([])).toEqual([]);
  });
});

describe('monthlySummary', () => {
  it('speaks the distribution, not the axis', () => {
    const summary = monthlySummary([
      { month: '2026-01', count: 0 },
      { month: '2026-02', count: 3 },
      { month: '2026-03', count: 7 },
    ]);
    expect(summary).toContain('2 of the last 12 months');
    expect(summary).toContain('Busiest month 7');
  });

  it('says so plainly when nothing happened', () => {
    expect(monthlySummary([{ month: '2026-01', count: 0 }])).toContain('No cars reported stolen');
  });
});

describe('recoveryRateLabel', () => {
  it('is computed over CLOSED listings only', () => {
    // ⚠️ The denominator is the whole point. An ACTIVE listing has not failed to
    // be recovered — it is still out being looked for — so counting it as a miss
    // would drag the rate down by exactly the cars this product is working on.
    // 6 of 10 closed is 60%, whatever the area's total is.
    expect(recoveryRateLabel(6, 10)?.headline).toBe('60% came back');
  });

  it('says nothing when too few listings have finished', () => {
    // Three closed and one recovery is "33%", which reads as a property of the
    // area and is really a property of three cars.
    expect(recoveryRateLabel(1, 3)).toBeNull();
    expect(recoveryRateLabel(0, 0)).toBeNull();
  });

  it('names the denominator in the caveat, so the number cannot be read alone', () => {
    const rate = recoveryRateLabel(4, 8);
    expect(rate?.caveat).toContain('8 nearby listings that have finished');
    expect(rate?.caveat).toContain('still being looked for');
  });

  it('handles the extremes without producing a nonsense percentage', () => {
    expect(recoveryRateLabel(0, 5)?.headline).toBe('0% came back');
    expect(recoveryRateLabel(5, 5)?.headline).toBe('100% came back');
  });
});
