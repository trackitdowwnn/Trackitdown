/**
 * WHAT:  Tests for calendarDates — day IDs, day and month arithmetic, the
 *        Monday-first month grid, the labels, and the time-of-day periods and
 *        slots.
 * WHY:   Every date the custom picker shows or stores comes through here. The
 *        failures that matter:
 *          - a grid starting on the wrong weekday (every date sits under the
 *            wrong letter);
 *          - a day step that lands on the wrong day across a DST change;
 *          - a future slot on offer, which could put a false last-seen time
 *            on a live post.
 *        Clocks are fixed local times, so the results don't depend on when or
 *        where the suite runs.
 * LINKS: src/shared/lib/calendarDates.ts.
 */

import {
  addDays,
  addMonths,
  atTime,
  clampDay,
  clampTime,
  compareMonths,
  DAY_PERIODS,
  dayA11yLabel,
  dayNumber,
  dayShortLabel,
  fromDayId,
  jumpToPeriod,
  monthMatrix,
  monthOf,
  monthTitle,
  periodOf,
  stepSlot,
  slotsFor,
  toDayId,
  weekdayInitials,
} from './calendarDates';

/** "02:45": a slot as a string, so lists compare and read easily. */
const hhmm = ({ hour, minute }: { hour: number; minute: number }) =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

/** Tue 29 Sep 2026, 10:07 local. */
const NOW = new Date(2026, 8, 29, 10, 7);
const TODAY = '2026-09-29';

describe('day IDs', () => {
  it('round-trips through local midnight', () => {
    expect(toDayId(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(fromDayId('2026-01-05')).toEqual(new Date(2026, 0, 5));
    expect(toDayId(fromDayId('2028-02-29'))).toBe('2028-02-29');
  });

  it('builds a local instant at a time of day', () => {
    expect(atTime(TODAY, 21, 15)).toEqual(new Date(2026, 8, 29, 21, 15));
  });

  it('steps across month, year and leap-day boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays(TODAY, -29)).toBe('2026-08-31');
  });

  it('is not moved by the UK clock changes', () => {
    // 29 Mar and 25 Oct 2026: 23- and 25-hour days in Europe/London.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2026-10-26', -1)).toBe('2026-10-25');
  });

  it('clamps into a window, either end open', () => {
    expect(clampDay('2026-08-01', '2026-08-31', TODAY)).toBe('2026-08-31');
    expect(clampDay('2026-10-10', '2026-08-31', TODAY)).toBe(TODAY);
    expect(clampDay('1990-01-01', null, TODAY)).toBe('1990-01-01');
  });
});

describe('months', () => {
  it('finds the month of a day and steps across years', () => {
    expect(monthOf(TODAY)).toEqual({ year: 2026, month: 8 });
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
    expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(compareMonths({ year: 2026, month: 8 }, { year: 2026, month: 7 })).toBeGreaterThan(0);
  });

  it('lays September 2026 out Monday first (1 Sep is a Tuesday)', () => {
    const weeks = monthMatrix({ year: 2026, month: 8 });
    expect(weeks[0]).toEqual([null, '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']);
    expect(weeks[weeks.length - 1]).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', null, null, null, null]);
    expect(weeks).toHaveLength(5);
  });

  it('gives a Sunday-first month a full leading week of blanks on Monday start', () => {
    // 1 Nov 2026 is a Sunday.
    expect(monthMatrix({ year: 2026, month: 10 })[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
  });

  it('counts leap-year February', () => {
    const cells = monthMatrix({ year: 2028, month: 1 }).flat().filter(Boolean);
    expect(cells).toHaveLength(29);
    expect(cells[cells.length - 1]).toBe('2028-02-29');
  });

  it('can start weeks on Sunday instead', () => {
    expect(monthMatrix({ year: 2026, month: 10 }, 0)[0][0]).toBe('2026-11-01');
  });
});

describe('labels', () => {
  it('titles a month and heads the columns Monday first', () => {
    expect(monthTitle({ year: 2026, month: 8 })).toBe('September 2026');
    expect(weekdayInitials()).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(weekdayInitials(0)[0]).toBe('S');
  });

  it('speaks a day in full, and shows it short', () => {
    // ICU versions differ on the comma after the weekday; both read the same.
    expect(dayA11yLabel(TODAY)).toMatch(/^Tuesday,? 29 September 2026$/);
    expect(dayNumber('2026-09-05')).toBe('5');
    expect(dayShortLabel('2026-07-11', NOW)).toBe('11 Jul');
    expect(dayShortLabel('2025-12-24', NOW)).toBe('24 Dec 2025');
  });
});

describe('time of day', () => {
  it('splits the day into four six-hour parts, each anchored at its middle', () => {
    expect(DAY_PERIODS.map((period) => [period.label, period.from, period.to, period.anchor])).toEqual([
      ['Night', 0, 6, 3],
      ['Morning', 6, 12, 9],
      ['Afternoon', 12, 18, 15],
      ['Evening', 18, 24, 21],
    ]);
  });

  it('files each hour under its part of the day', () => {
    expect(periodOf(0)).toBe('night');
    expect(periodOf(5)).toBe('night');
    expect(periodOf(6)).toBe('morning');
    expect(periodOf(12)).toBe('afternoon');
    expect(periodOf(18)).toBe('evening');
    expect(periodOf(23)).toBe('evening');
  });

  it('offers every quarter hour of a period on a past day', () => {
    const evening = slotsFor('2026-09-28', 'evening', NOW);
    expect(evening).toHaveLength(24); // 18:00-23:45
    expect(evening[0]).toEqual({ hour: 18, minute: 0 });
    expect(evening[evening.length - 1]).toEqual({ hour: 23, minute: 45 });
  });

  it('stops today at the last slot that has started, and offers nothing ahead', () => {
    const morning = slotsFor(TODAY, 'morning', NOW);
    expect(morning[morning.length - 1]).toEqual({ hour: 10, minute: 0 });
    expect(slotsFor(TODAY, 'afternoon', NOW)).toEqual([]);
    expect(slotsFor('2026-09-30', 'morning', NOW)).toEqual([]);
  });

  it('steps a quarter hour either way, across the hour', () => {
    expect(stepSlot('2026-09-28', { hour: 21, minute: 0 }, 1, NOW)).toEqual({ hour: 21, minute: 15 });
    expect(stepSlot('2026-09-28', { hour: 21, minute: 0 }, -1, NOW)).toEqual({ hour: 20, minute: 45 });
  });

  it('stops at the start of the day, and at the last slot that has passed', () => {
    expect(stepSlot('2026-09-28', { hour: 0, minute: 0 }, -1, NOW)).toBeNull();
    expect(stepSlot('2026-09-28', { hour: 23, minute: 45 }, 1, NOW)).toBeNull();
    // Today at 10:07: 10:00 is the latest, so + stops there.
    expect(stepSlot(TODAY, { hour: 10, minute: 0 }, 1, NOW)).toBeNull();
    expect(stepSlot(TODAY, { hour: 9, minute: 45 }, 1, NOW)).toEqual({ hour: 10, minute: 0 });
  });

  it('jumps to the middle of a part of the day', () => {
    expect(jumpToPeriod('2026-09-28', 'evening', NOW)).toEqual({ hour: 21, minute: 0 });
    expect(jumpToPeriod('2026-09-28', 'night', NOW)).toEqual({ hour: 3, minute: 0 });
  });

  it('jumps no further than now today, and not at all into a part still ahead', () => {
    // 10:07: Morning's anchor (09:00) has passed; at 07:20 it hasn't.
    expect(jumpToPeriod(TODAY, 'morning', NOW)).toEqual({ hour: 9, minute: 0 });
    expect(jumpToPeriod(TODAY, 'morning', new Date(2026, 8, 29, 7, 20))).toEqual({ hour: 7, minute: 15 });
    expect(jumpToPeriod(TODAY, 'afternoon', NOW)).toBeNull();
  });

  it('floors a time to the slot and pulls a future one back', () => {
    expect(clampTime('2026-09-28', { hour: 21, minute: 44 }, NOW)).toEqual({ hour: 21, minute: 30 });
    expect(clampTime(TODAY, { hour: 22, minute: 45 }, NOW)).toEqual({ hour: 10, minute: 0 });
    expect(clampTime(TODAY, { hour: 9, minute: 20 }, NOW)).toEqual({ hour: 9, minute: 15 });
    expect(clampTime('2026-09-30', { hour: 9, minute: 0 }, NOW)).toBeNull();
  });

  describe('on the UK spring-forward day (29 Mar 2026, 01:00-01:59 does not exist)', () => {
    // Node applies a changed TZ at once. Only this block runs in London time;
    // everything else in the file is zone-independent.
    const previousTz = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = 'Europe/London';
    });
    afterAll(() => {
      process.env.TZ = previousTz;
    });

    it('skips the missing hour instead of showing 02:xx twice', () => {
      const early = slotsFor('2026-03-29', 'night', new Date(2026, 2, 29, 12, 0));
      const keys = early.map(hhmm);
      expect(keys).not.toContain('01:00');
      expect(keys).not.toContain('01:45');
      expect(keys).toContain('00:45');
      expect(keys).toContain('02:00');
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('offers nothing still ahead just after the jump, and clamps onto a real slot', () => {
      // 02:10 BST, a few minutes after the clocks went forward.
      const now = new Date(2026, 2, 29, 2, 10);
      const keys = slotsFor('2026-03-29', 'night', now).map(hhmm);
      expect(keys[keys.length - 1]).toBe('02:00');
      expect(keys).not.toContain('02:15');
      expect(clampTime('2026-03-29', { hour: 1, minute: 30 }, now)).toEqual({ hour: 0, minute: 45 });
      expect(clampTime('2026-03-29', { hour: 5, minute: 0 }, now)).toEqual({ hour: 2, minute: 0 });
    });
  });
});
