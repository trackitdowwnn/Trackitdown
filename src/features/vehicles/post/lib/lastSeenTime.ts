/**
 * WHAT:  The time logic behind the "When did you last see it?" step: the
 *        one-tap presets ("Just now" … "Last night", "Yesterday"), the sheet's
 *        day / hour / quarter-hour options, and the draft that ties them
 *        together. Pure, and `now` is always injected.
 * WHY:   Victims think in "about an hour ago" and "last night", not clock
 *        times, so the step leads with presets and keeps an exact picker one
 *        tap away. The exact picker offers ONLY moments that can be true:
 *          - nothing in the future — future slots are left out, not greyed;
 *          - nothing older than LAST_SEEN_WINDOW_DAYS, which also closes the
 *            old field's "pick 1990" gap.
 *        With every option valid, the sheet never has to clamp an answer
 *        behind the user's back. The old DateTimeField had to, because
 *        Android's time dialog can't enforce a maximum.
 *        Quarter-hour precision is deliberate: a last-seen time is an
 *        estimate, and 96 slots a day beats 1,440.
 *        Output stays what the rest of the flow already stores: an ISO 8601
 *        UTC string with seconds zeroed (`toLastSeenIso`).
 * LINKS: src/features/vehicles/post/components/LastSeenTimeField.tsx (the UI);
 *        src/shared/lib/dateTimeLabel.ts (display format);
 *        src/features/vehicles/post/postACarFlow.tsx (the step's schema).
 */

import { formatClock } from '@/shared/lib';

/** How far back the exact picker reaches, counting today as day 1. */
export const LAST_SEEN_WINDOW_DAYS = 30;

/** The minute choices within an hour. */
export const QUARTER_HOURS = [0, 15, 30, 45] as const;

const HOUR_MS = 60 * 60_000;

/** Midnight at the start of `date`, local time. */
export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** `date` moved by whole calendar days, keeping its clock time across DST. */
function addLocalDays(date: Date, days: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
  );
}

/** A local day as a stable key: "2026-09-28". */
export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function dayFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

/** The stored form: ISO 8601 UTC, minute precision (seconds zeroed). */
export function toLastSeenIso(date: Date): string {
  const minute = new Date(date.getTime());
  minute.setSeconds(0, 0);
  return minute.toISOString();
}

// ── presets ─────────────────────────────────────────────────────────────

export type LastSeenPresetKey = 'just-now' | 'hour-ago' | 'earlier-today' | 'last-night' | 'yesterday';

export interface LastSeenPreset {
  key: LastSeenPresetKey;
  label: string;
  value: Date;
}

/** Before this hour "Earlier today" would mean "around midnight", so it hides. */
const EARLIER_TODAY_FROM_HOUR = 4;
/** "Last night" is yesterday at this local hour. */
const LAST_NIGHT_HOUR = 22;

/** The step's one-tap answers, newest first. Evaluate at tap time. */
export function lastSeenPresets(now: Date): LastSeenPreset[] {
  const presets: LastSeenPreset[] = [
    { key: 'just-now', label: 'Just now', value: now },
    { key: 'hour-ago', label: 'About an hour ago', value: new Date(now.getTime() - HOUR_MS) },
  ];
  if (now.getHours() >= EARLIER_TODAY_FROM_HOUR) {
    // ~3h back, but never before local midnight: "today" must stay honest.
    const candidate = new Date(now.getTime() - 3 * HOUR_MS);
    const midnight = startOfLocalDay(now);
    presets.push({
      key: 'earlier-today',
      label: 'Earlier today',
      value: candidate > midnight ? candidate : midnight,
    });
  }
  const yesterday = startOfLocalDay(addLocalDays(now, -1));
  presets.push(
    {
      key: 'last-night',
      label: 'Last night',
      value: new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), LAST_NIGHT_HOUR),
    },
    // Same clock time yesterday. Calendar arithmetic, so a DST change doesn't
    // shift it by an hour.
    { key: 'yesterday', label: 'Yesterday', value: addLocalDays(now, -1) },
  );
  return presets;
}

// ── the sheet's options ─────────────────────────────────────────────────

export interface TimeOption {
  /** A string for ChoiceChips: a day key, or an hour / minute number. */
  value: string;
  label: string;
  accessibilityLabel?: string;
}

/** Today back through LAST_SEEN_WINDOW_DAYS, newest first. */
export function dayOptions(now: Date, days: number = LAST_SEEN_WINDOW_DAYS): TimeOption[] {
  const today = startOfLocalDay(now);
  return Array.from({ length: days }, (_, index) => {
    const day = addLocalDays(today, -index);
    const date = day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const label = index === 0 ? 'Today' : index === 1 ? 'Yesterday' : date;
    return {
      value: dayKey(day),
      label,
      // "Today" alone doesn't say which day it is to a screen-reader user.
      accessibilityLabel: index < 2 ? `${label}, ${date}` : undefined,
    };
  });
}

/** The hours of `dayKeyValue`, stopping at the current hour when it is today. */
export function hourOptions(dayKeyValue: string, now: Date): TimeOption[] {
  const day = dayFromKey(dayKeyValue);
  const lastHour = isSameLocalDay(day, now) ? now.getHours() : 23;
  return Array.from({ length: lastHour + 1 }, (_, hour) => ({
    value: String(hour),
    // formatClock follows the device's 12- or 24-hour setting.
    label: formatClock(
      new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour).toISOString(),
    ),
  }));
}

/** The quarter hours of that hour, stopping at the last one already passed. */
export function minuteOptions(dayKeyValue: string, hour: number, now: Date): TimeOption[] {
  const day = dayFromKey(dayKeyValue);
  const isCurrentHour = isSameLocalDay(day, now) && hour === now.getHours();
  return QUARTER_HOURS.filter((minute) => !isCurrentHour || minute <= now.getMinutes()).map(
    (minute) => ({
      value: String(minute),
      label: `:${String(minute).padStart(2, '0')}`,
      accessibilityLabel: minute === 0 ? 'On the hour' : `${minute} minutes past`,
    }),
  );
}

// ── the draft the sheet edits ───────────────────────────────────────────

export interface LastSeenDraft {
  day: string;
  hour: number;
  minute: number;
}

/**
 * Pull the draft back inside what the options offer: into the window, then no
 * later than the latest hour and quarter hour available that day. Run it after
 * every change, so picking an earlier day and then today can't leave a future
 * hour selected.
 */
export function clampDraft(draft: LastSeenDraft, now: Date): LastSeenDraft {
  const days = dayOptions(now);
  const oldest = days[days.length - 1].value;
  // Day keys are zero-padded, so string order is date order.
  const day = draft.day > days[0].value ? days[0].value : draft.day < oldest ? oldest : draft.day;

  const hours = hourOptions(day, now);
  const lastHour = Number(hours[hours.length - 1].value);
  const hour = Math.min(draft.hour, lastHour);

  const minutes = minuteOptions(day, hour, now);
  const lastMinute = Number(minutes[minutes.length - 1].value);
  const flooredMinute = QUARTER_HOURS.filter((quarter) => quarter <= draft.minute).pop() ?? 0;
  return { day, hour, minute: Math.min(flooredMinute, lastMinute) };
}

/** Where the sheet opens: the stored value if any, else now, rounded down. */
export function draftFromDate(date: Date, now: Date): LastSeenDraft {
  return clampDraft({ day: dayKey(date), hour: date.getHours(), minute: date.getMinutes() }, now);
}

export function draftToDate(draft: LastSeenDraft): Date {
  const day = dayFromKey(draft.day);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), draft.hour, draft.minute);
}
