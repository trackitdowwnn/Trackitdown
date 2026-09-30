/**
 * WHAT:  The last-seen RULES behind "When did you last see it?":
 *          - the one-tap presets ("Just now" … "Last night", "Yesterday");
 *          - the 30-day window the exact picker allows;
 *          - the draft the sheet edits (a day plus a quarter-hour slot).
 *        Pure, and `now` is always injected. The calendar maths itself is
 *        shared (src/shared/lib/calendarDates.ts).
 * WHY:   Victims think in "about an hour ago" and "last night", not clock
 *        times, so the step leads with presets and keeps an exact picker one
 *        tap away. The exact picker offers ONLY moments that can be true:
 *          - nothing in the future — future days are struck through, future
 *            slots left out;
 *          - nothing older than LAST_SEEN_WINDOW_DAYS, which also closes the
 *            old native field's "pick 1990" gap.
 *        With every option valid, the sheet never clamps an answer behind the
 *        user's back.
 *        Quarter-hour precision is deliberate: a last-seen time is an
 *        estimate.
 *        Output stays what the rest of the flow already stores: an ISO 8601
 *        UTC string with seconds zeroed (`toLastSeenIso`).
 * LINKS: src/features/vehicles/post/components/LastSeenTimeField.tsx (the UI);
 *        src/shared/lib/calendarDates.ts (days, slots, clampTime);
 *        src/features/vehicles/post/postACarFlow.tsx (the step's schema).
 */

import { addDays, atTime, clampDay, clampTime, toDayId, type DayId } from '@/shared/lib/calendarDates';

/** How far back the exact picker reaches, counting today as day 1. */
export const LAST_SEEN_WINDOW_DAYS = 30;

const HOUR_MS = 60 * 60_000;

/** Midnight at the start of `date`, local time. */
function startOfLocalDay(date: Date): Date {
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

// ── the exact picker ────────────────────────────────────────────────────

/** The days the exact picker offers: today back through the window. */
export function lastSeenWindow(now: Date): { minDay: DayId; maxDay: DayId } {
  const maxDay = toDayId(now);
  return { minDay: addDays(maxDay, -(LAST_SEEN_WINDOW_DAYS - 1)), maxDay };
}

export interface LastSeenDraft {
  day: DayId;
  hour: number;
  minute: number;
}

/**
 * Pull the draft back inside what the picker offers: into the window, then to
 * a slot that has already happened that day. Run it after every change, so
 * picking an earlier day and then today can't leave a future time selected.
 */
export function clampDraft(draft: LastSeenDraft, now: Date): LastSeenDraft {
  const { minDay, maxDay } = lastSeenWindow(now);
  const day = clampDay(draft.day, minDay, maxDay);
  // Every day in the window has at least its 00:00 slot, so this is never null.
  const time = clampTime(day, draft, now) ?? { hour: 0, minute: 0 };
  return { day, ...time };
}

/** Where the sheet opens: the stored value if any, else now, rounded down. */
export function draftFromDate(date: Date, now: Date): LastSeenDraft {
  return clampDraft({ day: toDayId(date), hour: date.getHours(), minute: date.getMinutes() }, now);
}

/** The local instant a draft stands for. */
export function draftToDate(draft: LastSeenDraft): Date {
  return atTime(draft.day, draft.hour, draft.minute);
}
