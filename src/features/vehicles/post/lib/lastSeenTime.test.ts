/**
 * WHAT:  Tests for lastSeenTime — the step's presets, the exact picker's
 *        30-day window, and the draft clamp.
 * WHY:   These decide which moments a victim CAN report:
 *          - a window that reaches into the future, or a draft left on a slot
 *            that hasn't happened, would let a false last-seen time onto a
 *            live post;
 *          - a preset on the wrong day ("Last night" on the wrong night) would
 *            put the alert fan-out in the wrong window.
 *        The calendar maths itself is covered in calendarDates.test.ts. Every
 *        clock here is a fixed local time.
 * LINKS: src/features/vehicles/post/lib/lastSeenTime.ts;
 *        src/shared/lib/calendarDates.test.ts.
 */

import {
  clampDraft,
  draftFromDate,
  draftToDate,
  LAST_SEEN_WINDOW_DAYS,
  lastSeenPresets,
  lastSeenWindow,
  toLastSeenIso,
} from './lastSeenTime';

/** Mon 28 Sep 2026, 14:37:22 local. */
const NOW = new Date(2026, 8, 28, 14, 37, 22);
const TODAY = '2026-09-28';
const YESTERDAY = '2026-09-27';

const presetValue = (now: Date, key: string) =>
  lastSeenPresets(now).find((preset) => preset.key === key)?.value;

describe('lastSeenPresets', () => {
  it('offers the five answers, newest first', () => {
    expect(lastSeenPresets(NOW).map((preset) => preset.label)).toEqual([
      'Just now',
      'About an hour ago',
      'Earlier today',
      'Last night',
      'Yesterday',
    ]);
  });

  it('computes each moment from now', () => {
    expect(presetValue(NOW, 'just-now')).toEqual(NOW);
    expect(presetValue(NOW, 'hour-ago')).toEqual(new Date(2026, 8, 28, 13, 37, 22));
    expect(presetValue(NOW, 'earlier-today')).toEqual(new Date(2026, 8, 28, 11, 37, 22));
    expect(presetValue(NOW, 'last-night')).toEqual(new Date(2026, 8, 27, 22, 0));
    expect(presetValue(NOW, 'yesterday')).toEqual(new Date(2026, 8, 27, 14, 37));
  });

  it('hides "Earlier today" before 04:00, when it would mean midnight', () => {
    const early = new Date(2026, 8, 28, 3, 59);
    expect(lastSeenPresets(early).map((preset) => preset.key)).not.toContain('earlier-today');
    expect(lastSeenPresets(new Date(2026, 8, 28, 4, 0)).map((preset) => preset.key)).toContain(
      'earlier-today',
    );
  });

  it('never lets "Earlier today" slip into yesterday', () => {
    expect(presetValue(new Date(2026, 8, 28, 4, 30), 'earlier-today')).toEqual(
      new Date(2026, 8, 28, 1, 30),
    );
  });

  it('keeps "Last night" on the previous evening, even just after midnight', () => {
    expect(presetValue(new Date(2026, 8, 28, 0, 30), 'last-night')).toEqual(
      new Date(2026, 8, 27, 22, 0),
    );
  });
});

describe('lastSeenWindow', () => {
  it('runs from today back through the window, today counting as day 1', () => {
    expect(LAST_SEEN_WINDOW_DAYS).toBe(30);
    expect(lastSeenWindow(NOW)).toEqual({ minDay: '2026-08-30', maxDay: TODAY });
  });
});

describe('the draft', () => {
  it('opens on the stored moment, rounded down to the quarter hour', () => {
    expect(draftFromDate(new Date(2026, 8, 26, 21, 44), NOW)).toEqual({
      day: '2026-09-26',
      hour: 21,
      minute: 30,
    });
  });

  it('opens on now when there is nothing stored', () => {
    expect(draftFromDate(NOW, NOW)).toEqual({ day: TODAY, hour: 14, minute: 30 });
  });

  it('pulls a future time back when the day changes to today', () => {
    // 22:45 yesterday, then the user taps today at 14:37.
    expect(clampDraft({ day: TODAY, hour: 22, minute: 45 }, NOW)).toEqual({
      day: TODAY,
      hour: 14,
      minute: 30,
    });
  });

  it('keeps a valid draft exactly as it is', () => {
    const draft = { day: YESTERDAY, hour: 22, minute: 45 };
    expect(clampDraft(draft, NOW)).toEqual(draft);
  });

  it('pulls a day outside the window back inside it', () => {
    expect(clampDraft({ day: '2026-01-01', hour: 10, minute: 0 }, NOW).day).toBe('2026-08-30');
    expect(clampDraft({ day: '2026-12-25', hour: 10, minute: 0 }, NOW).day).toBe(TODAY);
  });

  it('turns back into a local date', () => {
    expect(draftToDate({ day: YESTERDAY, hour: 22, minute: 15 })).toEqual(
      new Date(2026, 8, 27, 22, 15),
    );
  });
});

describe('toLastSeenIso', () => {
  it('stores UTC with the seconds zeroed', () => {
    const iso = toLastSeenIso(NOW);
    expect(iso.endsWith('Z')).toBe(true);
    expect(new Date(iso)).toEqual(new Date(2026, 8, 28, 14, 37, 0));
  });
});
