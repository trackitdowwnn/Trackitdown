/**
 * WHAT:  Tests for lastSeenTime — the step's presets, the sheet's day / hour /
 *        quarter-hour options, and the draft clamp.
 * WHY:   These decide which moments a victim CAN report. Two ways they could
 *        go wrong:
 *          - offering a future slot, or one outside the window, would let a
 *            false last-seen time onto a live post;
 *          - a preset landing on the wrong day ("Last night" on the wrong
 *            night) would put the alert fan-out in the wrong window.
 *        Every clock here is a fixed local time, so the tests don't depend on
 *        when they run.
 * LINKS: src/features/vehicles/post/lib/lastSeenTime.ts.
 */

import {
  clampDraft,
  dayKey,
  dayOptions,
  draftFromDate,
  draftToDate,
  hourOptions,
  LAST_SEEN_WINDOW_DAYS,
  lastSeenPresets,
  minuteOptions,
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

describe('dayOptions', () => {
  it('covers today back through the window, newest first', () => {
    const days = dayOptions(NOW);
    expect(days).toHaveLength(LAST_SEEN_WINDOW_DAYS);
    expect(days[0]).toEqual(expect.objectContaining({ value: TODAY, label: 'Today' }));
    expect(days[1]).toEqual(expect.objectContaining({ value: YESTERDAY, label: 'Yesterday' }));
    expect(days[2]).toEqual(expect.objectContaining({ value: '2026-09-26', label: 'Sat 26 Sept' }));
    expect(days[days.length - 1].value).toBe('2026-08-30');
  });

  it('tells screen readers which day "Today" and "Yesterday" are', () => {
    const [today, yesterday] = dayOptions(NOW);
    expect(today.accessibilityLabel).toBe('Today, Mon 28 Sept');
    expect(yesterday.accessibilityLabel).toBe('Yesterday, Sun 27 Sept');
  });
});

describe('hourOptions / minuteOptions', () => {
  it('stops today at the current hour', () => {
    const hours = hourOptions(TODAY, NOW).map((option) => option.value);
    expect(hours[0]).toBe('0');
    expect(hours[hours.length - 1]).toBe('14');
  });

  it('offers every hour on an earlier day', () => {
    expect(hourOptions(YESTERDAY, NOW)).toHaveLength(24);
  });

  it('stops the current hour at the last quarter already passed', () => {
    expect(minuteOptions(TODAY, 14, NOW).map((option) => option.value)).toEqual(['0', '15', '30']);
  });

  it('offers all four quarters otherwise', () => {
    expect(minuteOptions(TODAY, 13, NOW)).toHaveLength(4);
    expect(minuteOptions(YESTERDAY, 14, NOW)).toHaveLength(4);
  });

  it('always leaves at least ":00" at the top of the hour', () => {
    const topOfHour = new Date(2026, 8, 28, 9, 0, 30);
    expect(minuteOptions(TODAY, 9, topOfHour).map((option) => option.value)).toEqual(['0']);
  });

  it('labels minutes tersely but reads them out in full', () => {
    const [onTheHour, quarterPast] = minuteOptions(YESTERDAY, 10, NOW);
    expect(onTheHour).toEqual({ value: '0', label: ':00', accessibilityLabel: 'On the hour' });
    expect(quarterPast).toEqual({ value: '15', label: ':15', accessibilityLabel: '15 minutes past' });
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

  it('pulls a future hour back when the day changes to today', () => {
    // 22:45 yesterday, then the user taps "Today" at 14:37.
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

describe('helpers', () => {
  it('dayKey zero-pads, so keys sort as dates', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('toLastSeenIso stores UTC with the seconds zeroed', () => {
    const iso = toLastSeenIso(NOW);
    expect(iso.endsWith('Z')).toBe(true);
    expect(new Date(iso)).toEqual(new Date(2026, 8, 28, 14, 37, 0));
  });
});
