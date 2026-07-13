/**
 * WHAT:  Tests for formatDateTimeLabel — the Today/Yesterday/Tomorrow day
 *        windows, the older-date fallback, local-midnight boundaries, and
 *        the unparseable-input guard.
 * WHY:   "When was the car last seen" answers render through this; calling
 *        yesterday evening "Today" would misinform every spotter reading
 *        the post. Time-of-day strings follow the device locale, so tests
 *        assert day words and structure rather than a fixed clock format.
 * LINKS: src/shared/lib/dateTimeLabel.ts.
 */

import { formatDateLabel, formatDateTimeLabel, formatMonthYear } from './dateTimeLabel';

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
