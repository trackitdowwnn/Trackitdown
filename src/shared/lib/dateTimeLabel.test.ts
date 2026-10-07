/**
 * WHAT:  Tests for formatDateTimeLabel — the Today/Yesterday/Tomorrow day
 *        windows, the older-date fallback, local-midnight boundaries, and
 *        the unparseable-input guard; formatLastDay's last whole day of a
 *        stored term end or deadline (20261007120000).
 * WHY:   "When was the car last seen" answers render through this; calling
 *        yesterday evening "Today" would misinform every spotter reading
 *        the post. Time-of-day strings follow the device locale, so tests
 *        assert day words and structure rather than a fixed clock format.
 *        The money dates are a promise ("ends on", "by"): a day late tells
 *        an owner or spotter they have time they don't, so their exact
 *        London day is pinned.
 * LINKS: src/shared/lib/dateTimeLabel.ts.
 */

import {
  formatClock,
  formatDateLabel,
  formatDateLabelCompact,
  formatDateTimeLabel,
  formatLastDay,
  formatListStamp,
  formatMonthYear,
  formatTermDate,
} from './dateTimeLabel';

// A fixed local "now": Wednesday 8 July 2026, 15:00 local time.
const NOW = new Date(2026, 6, 8, 15, 0);
const localIso = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m, d, h, min).toISOString();

describe('formatDateTimeLabel', () => {
  it.each([
    ['same afternoon', localIso(2026, 6, 8, 14, 30), /^Today, /],
    ['just after local midnight', localIso(2026, 6, 8, 0, 5), /^Today, /],
    ['yesterday evening', localIso(2026, 6, 7, 23, 55), /^Yesterday, /],
    ['yesterday morning', localIso(2026, 6, 7, 9, 0), /^Yesterday, /],
    ['tomorrow', localIso(2026, 6, 9, 10, 0), /^Tomorrow, /],
    ['two days ago', localIso(2026, 6, 6, 14, 30), /^Mon[, ]/],
    ['months ago', localIso(2026, 1, 2, 8, 15), /^Mon[, ]/],
  ])('%s → %s', (_name, iso, expected) => {
    expect(formatDateTimeLabel(iso, NOW)).toMatch(expected);
  });

  it('always appends a locale time with minutes', () => {
    expect(formatDateTimeLabel(localIso(2026, 6, 8, 14, 30), NOW)).toMatch(/, \d{1,2}[:.]\d{2}/);
  });

  it('throws on unparseable input', () => {
    expect(() => formatDateTimeLabel('not a date', NOW)).toThrow(/unparseable/);
  });
});

describe('formatClock', () => {
  it('renders the time with minutes, and nothing else', () => {
    const clock = formatClock(localIso(2026, 6, 8, 14, 30));

    expect(clock).toMatch(/^\d{1,2}[:.]\d{2}(\s?[AaPp][Mm])?$/);
    // No day words, no date — that is the whole distinction from
    // formatDateTimeLabel, and the reason the inbox row can use it under a
    // DayHeader that has already said the day.
    expect(clock).not.toMatch(/Today|Yesterday|Jul|2026/);
  });

  it('keeps a leading-zero minute', () => {
    // "14:5" would be wrong and is the obvious way to get this wrong.
    expect(formatClock(localIso(2026, 6, 8, 14, 5))).toMatch(/[:.]05/);
  });

  // ⚠️ The whole point of extracting it: three call sites had hand-rolled this
  // same toLocaleTimeString, and the one thing that must not drift between the
  // screen showing a message and the screen listing it is the time on it.
  it('is the same string formatDateTimeLabel appends', () => {
    const iso = localIso(2026, 6, 8, 14, 30);

    expect(formatDateTimeLabel(iso, NOW)).toBe(`Today, ${formatClock(iso)}`);
  });

  it('throws on unparseable input', () => {
    expect(() => formatClock('not a date')).toThrow(/unparseable/);
  });
});

// ⚠️ THE WHOLE INBOX HANGS ON THIS AND IT SHIPPED UNTESTED. Both faces dropped
// their day headers on 2026-09-04 and handed the job to this ladder; the only
// coverage was `InboxScreen.test.tsx`, which builds its expectation by CALLING
// the function under test — tautological for every branch except the literal
// "Yesterday". Nothing pinned the two branches the JSDoc promises.
describe('formatListStamp', () => {
  it('today is the clock, and nothing else', () => {
    const iso = localIso(2026, 6, 8, 14, 30);
    expect(formatListStamp(iso, NOW)).toBe(formatClock(iso));
  });

  it('yesterday is the word', () => {
    expect(formatListStamp(localIso(2026, 6, 7, 9, 0), NOW)).toBe('Yesterday');
  });

  // ⚠️ THE BRANCH THAT MATTERS MOST. A bare clock on an old thread would be
  // actively misleading — that is the failure the day header used to prevent,
  // and the reason this is a ladder rather than `formatClock`.
  it('older than that is a date, never a time', () => {
    const stamp = formatListStamp(localIso(2026, 6, 6, 9, 0), NOW);

    expect(stamp).toBe('6 Jul');
    expect(stamp).not.toMatch(/\d{1,2}[:.]\d{2}/);
  });

  it('keeps the year when it is not this one', () => {
    expect(formatListStamp(localIso(2025, 6, 6, 9, 0), NOW)).toBe('6 Jul 2025');
  });

  it('throws on unparseable input, like its siblings', () => {
    expect(() => formatListStamp('not a date', NOW)).toThrow(/unparseable/);
  });

  // Local-midnight boundaries, because the ladder is computed from
  // startOfLocalDay differences rather than elapsed hours.
  it.each([
    ['one minute past midnight today', localIso(2026, 6, 8, 0, 1), 'clock'],
    ['one minute to midnight yesterday', localIso(2026, 6, 7, 23, 59), 'Yesterday'],
  ])('%s', (_name, iso, expected) => {
    const stamp = formatListStamp(iso, NOW);
    expect(expected === 'clock' ? formatClock(iso) : expected).toBe(stamp);
  });
});

describe('formatDateLabel', () => {
  it('renders a date-only label with day, short month, and year', () => {
    // Noon UTC never crosses a day boundary in UK time zones.
    expect(formatDateLabel('2026-07-08T12:00:00Z')).toBe('8 Jul 2026');
  });

  it('throws on unparseable input', () => {
    expect(() => formatDateLabel('nope')).toThrow(/unparseable/);
  });
});

describe('formatMonthYear', () => {
  it('renders month and year only', () => {
    expect(formatMonthYear('2025-01-05T00:00:00Z')).toBe('January 2025');
  });

  it('throws on unparseable input', () => {
    expect(() => formatMonthYear('nope')).toThrow(/unparseable/);
  });
});

describe('formatDateLabelCompact', () => {
  it('drops the year in the CURRENT year', () => {
    // The whole point: "3 Aug 2026" truncates to "3 Aug 20…" in a half-width
    // range-bound field, which is worse than showing no year at all.
    expect(formatDateLabelCompact(localIso(2026, 7, 3, 12, 0), new Date(2026, 7, 10))).toBe('3 Aug');
  });

  it('KEEPS the year for any other year — there it is the load-bearing part', () => {
    expect(formatDateLabelCompact(localIso(2025, 7, 3, 12, 0), new Date(2026, 7, 10))).toBe(
      '3 Aug 2025',
    );
    expect(formatDateLabelCompact(localIso(2027, 0, 1, 12, 0), new Date(2026, 7, 10))).toContain('2027');
  });

  it('throws on unparseable input, like its siblings', () => {
    expect(() => formatDateLabelCompact('nope')).toThrow(/unparseable/);
  });
});

// A term or deadline is stored as the midnight AFTER its last day
// (reward_term_end). Showing that midnight's own date told owners and spotters
// a day too late; these pin the last day, in BST and GMT, alongside the
// server's last_day_text checks (supabase/tests/last_day_verification.sql).
describe('formatLastDay', () => {
  it('names the day before a London midnight end, in BST', () => {
    // 00:00 BST on 24 October.
    expect(formatLastDay('2026-10-23T23:00:00Z')).toBe('23 October');
    expect(formatTermDate('2026-10-23T23:00:00Z')).toBe('24 October');
  });

  it('names the day before a London midnight end, in GMT, with the weekday', () => {
    // 00:00 GMT on Sunday 6 December: the last day is Saturday 5 December.
    expect(formatLastDay('2026-12-06T00:00:00Z', true)).toBe('Saturday 5 December');
  });

  it('names the day before an end partway through a day (the 85-day hard line)', () => {
    // Ends at 15:00 on 30 December: the 29th is the last WHOLE day.
    expect(formatLastDay('2026-12-30T15:00:00Z')).toBe('29 December');
  });

  it('names the same last day just after a midnight end, and across a month', () => {
    // A millisecond into 24 October (BST): the 23rd is still the last whole day.
    expect(formatLastDay('2026-10-23T23:00:00.001Z')).toBe('23 October');
    // 00:00 GMT on 1 January: 31 December, the previous month and year.
    expect(formatLastDay('2027-01-01T00:00:00Z')).toBe('31 December');
  });

  it('throws on an unparseable timestamp', () => {
    expect(() => formatLastDay('not a date')).toThrow('formatLastDay got an unparseable timestamp');
  });
});
