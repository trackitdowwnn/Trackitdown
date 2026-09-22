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

import {
  monthlyColumns,
  monthlySummary,
  rankedMakes,
  rankedModels,
  recoveryRateLabel,
} from './areaInsightsModel';

describe('monthlyColumns', () => {
  it('scales against the busiest month and keeps the zeros', () => {
    // The server series is DENSE — a quiet month is a real zero, not a gap —
    // so this only scales and must never drop a bucket.
    const columns = monthlyColumns([
      { month: '2026-01', count: 0 },
      { month: '2026-02', count: 5 },
      { month: '2026-03', count: 10 },
    ]);

    expect(columns).toHaveLength(3);
    expect(columns[0]).toMatchObject({ key: '2026-01', count: 0, fraction: 0 });
    expect(columns[1].fraction).toBeCloseTo(0.5);
    expect(columns[2].fraction).toBe(1);
  });

  it('names every other month, counted back from the most recent', () => {
    const year = Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, '0')}`,
      count: 1,
    }));
    const labels = monthlyColumns(year).map((c) => c.label);
    // The last column is always named — it is the month the reader is in.
    expect(labels).toEqual([
      null, 'Feb', null, 'Apr', null, 'Jun', null, 'Aug', null, 'Oct', null, 'Dec',
    ]);
  });

  it('gives a malformed month no label rather than a wrong one', () => {
    expect(monthlyColumns([{ month: 'bad', count: 1 }])[0].label).toBeNull();
  });

  it('does not divide by zero on a year with no thefts', () => {
    // Every fraction would be NaN, which renders as a bar of height NaN and
    // takes the chart down with it.
    const columns = monthlyColumns([
      { month: '2026-01', count: 0 },
      { month: '2026-02', count: 0 },
    ]);
    expect(columns.every((c) => c.fraction === 0)).toBe(true);
  });

  it('returns nothing for an empty series', () => {
    expect(monthlyColumns([])).toEqual([]);
  });
});

describe('rankedMakes', () => {
  it('canonicalises the lower-cased names the RPC folds to', () => {
    const rows = rankedMakes([
      { make: 'ford', count: 6 },
      { make: 'bmw', count: 4 },
    ]);
    expect(rows.map((r) => r.label)).toEqual(['Ford', 'BMW']);
  });

  it('merges two spellings of one make and re-ranks on the sum', () => {
    // The RPC does not equate "vw" with "volkswagen"; the app's alias table
    // does, and the two full counts add up exactly.
    const rows = rankedMakes([
      { make: 'ford', count: 5 },
      { make: 'vw', count: 3 },
      { make: 'volkswagen', count: 3 },
    ]);
    expect(rows.map((r) => [r.label, r.count])).toEqual([
      ['Volkswagen', 6],
      ['Ford', 5],
    ]);
  });

  it('scales every row to the top one', () => {
    const rows = rankedMakes([
      { make: 'ford', count: 8 },
      { make: 'audi', count: 2 },
    ]);
    expect(rows[0].fraction).toBe(1);
    expect(rows[1].fraction).toBeCloseTo(0.25);
  });

  it('keeps an unknown make as typed rather than guessing', () => {
    expect(rankedMakes([{ make: 'zaporozhets', count: 1 }])[0].label).toBe('zaporozhets');
  });

  it('returns nothing for nothing', () => {
    expect(rankedMakes([])).toEqual([]);
  });
});

describe('rankedModels', () => {
  it('labels "Make Model" with both halves canonical', () => {
    const rows = rankedModels([
      { make: 'ford', model: 'fiesta', count: 3 },
      { make: 'vw', model: 'golf', count: 2 },
    ]);
    expect(rows.map((r) => r.label)).toEqual(['Ford Fiesta', 'Volkswagen Golf']);
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
    // Named, not numbered: "Busiest month 7" under an axis-less chart could
    // be July or seven cars.
    expect(summary).toContain('The busiest was March, with 7.');
  });

  it('falls back to the count alone when a month string is malformed', () => {
    expect(monthlySummary([{ month: 'bad', count: 4 }])).toContain('The busiest month had 4.');
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
