/**
 * WHAT:  Calendar maths for the app's custom date & time picker. Covers:
 *          - day IDs ("2026-09-29");
 *          - month grids (Monday first);
 *          - the labels a calendar speaks and shows;
 *          - the time-of-day periods and 15-minute slots a past moment can
 *            take.
 *        Pure; `now` is always injected.
 * WHY:   Replaces the platform pickers (2026-09-29). Two rules make it safe:
 *          - DAYS ARE STRINGS, NOT INSTANTS. A calendar picks a calendar day,
 *            so day arithmetic runs on y/m/d in UTC and never on local-time
 *            setHours. Local-time day stepping breaks across DST, and RN
 *            0.86's Hermes has an open bug there (facebook/hermes#2159). A day
 *            becomes an instant only at the edge (`atTime`), in local time,
 *            where it belongs.
 *          - NEVER `new Date('2026-09-29')`. That parses as UTC midnight, the
 *            previous evening west of Greenwich. Day IDs are parsed by hand.
 *        Labels are en-GB with a Monday week start, like dateTimeLabel.ts's day
 *        words: fine for the UK-only launch, not localised. Revisit with i18n.
 *        No date library, deliberately (dateTimeLabel.ts says why).
 * LINKS: src/shared/ui/CalendarMonth.tsx, src/shared/ui/TimeSlotPicker.tsx,
 *        src/shared/ui/DateRangeField.tsx (the consumers);
 *        src/shared/lib/dateTimeLabel.ts (formatClock and the display labels).
 */

/** A local calendar day, "YYYY-MM-DD". Zero-padded, so string order is date order. */
export type DayId = string;

/** A calendar month; `month` is 0-11, as in Date. */
export interface CalendarMonthRef {
  year: number;
  month: number;
}

/** Monday. The UK convention (Smashing: a region's own week start avoids mis-picks). */
export const WEEK_STARTS_ON = 1;

const pad = (value: number) => String(value).padStart(2, '0');

function partsOf(id: DayId): [number, number, number] {
  const [year, month, day] = id.split('-').map(Number);
  return [year, month, day];
}

function fromUtcParts(date: Date): DayId {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** The local calendar day `date` falls on. */
export function toDayId(date: Date): DayId {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight at the start of the day. */
export function fromDayId(id: DayId): Date {
  const [year, month, day] = partsOf(id);
  return new Date(year, month - 1, day);
}

/** The local instant at `hour:minute` on that day. */
export function atTime(id: DayId, hour: number, minute: number): Date {
  const [year, month, day] = partsOf(id);
  return new Date(year, month - 1, day, hour, minute);
}

/** `id` moved by whole days. UTC arithmetic, so DST can't shift it. */
export function addDays(id: DayId, days: number): DayId {
  const [year, month, day] = partsOf(id);
  return fromUtcParts(new Date(Date.UTC(year, month - 1, day + days)));
}

/** `id` pulled inside [min, max]; either bound may be open (null). */
export function clampDay(id: DayId, min: DayId | null, max: DayId | null): DayId {
  if (min !== null && id < min) return min;
  if (max !== null && id > max) return max;
  return id;
}

// ── months ──────────────────────────────────────────────────────────────

/** The month a day falls in. */
export function monthOf(id: DayId): CalendarMonthRef {
  const [year, month] = partsOf(id);
  return { year, month: month - 1 };
}

/** A month moved by whole months, across year ends. */
export function addMonths({ year, month }: CalendarMonthRef, months: number): CalendarMonthRef {
  const total = year * 12 + month + months;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/** Negative, zero or positive, like a sort comparator: the months apart. */
export function compareMonths(a: CalendarMonthRef, b: CalendarMonthRef): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

/** A stable key for a month: "2026-09". */
export function monthKey({ year, month }: CalendarMonthRef): string {
  return `${year}-${pad(month + 1)}`;
}

/**
 * The month as weeks of seven cells, starting on `weekStartsOn` (0 = Sunday,
 * 1 = Monday). Days outside the month are `null`, since the calendar shows
 * no spill-over days, as Airbnb's doesn't.
 */
export function monthMatrix(
  { year, month }: CalendarMonthRef,
  weekStartsOn: number = WEEK_STARTS_ON,
): (DayId | null)[][] {
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const lead = (firstWeekday - weekStartsOn + 7) % 7;

  const cells: (DayId | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${pad(month + 1)}-${pad(day)}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (DayId | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

// ── labels ──────────────────────────────────────────────────────────────

/** Noon, so no DST shift can move a label onto the neighbouring day. */
const labelDate = (id: DayId) => atTime(id, 12, 0);

/** "September 2026". */
export function monthTitle({ year, month }: CalendarMonthRef): string {
  return new Date(year, month, 15).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/** The seven column heads, week-start first: M T W T F S S. */
export function weekdayInitials(weekStartsOn: number = WEEK_STARTS_ON): string[] {
  // 4 Jan 2026 was a Sunday: day 0 of a known week.
  return Array.from({ length: 7 }, (_, index) =>
    new Date(2026, 0, 4 + ((weekStartsOn + index) % 7), 12).toLocaleDateString('en-GB', {
      weekday: 'narrow',
    }),
  );
}

/** "Tuesday 29 September 2026": what a screen reader says for a day. */
export function dayA11yLabel(id: DayId): string {
  return labelDate(id).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * "Tuesday 29 September": a picked day as a heading. No year, since the
 * pickers only reach recent days. Pair it with dayA11yLabel as the spoken
 * name.
 */
export function dayHeading(id: DayId): string {
  return labelDate(id).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** "29 Sept", or "29 Sept 2025" outside `now`'s year: a range summary's half. */
export function dayShortLabel(id: DayId, now: Date): string {
  const [year] = partsOf(id);
  return labelDate(id).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(year === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/**
 * "29 September", or "29 September 2025" outside `now`'s year: the SPOKEN
 * form of dayShortLabel. Screen readers vary on "Sept" and on an en dash, so
 * spoken ranges use full month names and " to ".
 */
export function daySpokenLabel(id: DayId, now: Date): string {
  const [year] = partsOf(id);
  return labelDate(id).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    ...(year === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** The day of the month, for a cell: "29". */
export const dayNumber = (id: DayId) => String(partsOf(id)[2]);

// ── time of day ─────────────────────────────────────────────────────────

export type DayPeriod = 'night' | 'morning' | 'afternoon' | 'evening';

/**
 * The parts of a day, in order: four blocks of six hours. They are the time
 * picker's jump chips, because people remember a past time by the part of
 * the day first (Friedman 1993).
 * - `from`/`to` are hours, `to` exclusive.
 * - `anchor` is where a jump lands: the block's middle, so the steppers are
 *   never more than three hours from any time in it.
 * - "Night" is 00-05 of the PICKED date, its small hours. 23:00 the evening
 *   before is the previous day's Evening, and the day heading says which day
 *   is which.
 */
export const DAY_PERIODS: { key: DayPeriod; label: string; from: number; to: number; anchor: number }[] = [
  { key: 'night', label: 'Night', from: 0, to: 6, anchor: 3 },
  { key: 'morning', label: 'Morning', from: 6, to: 12, anchor: 9 },
  { key: 'afternoon', label: 'Afternoon', from: 12, to: 18, anchor: 15 },
  { key: 'evening', label: 'Evening', from: 18, to: 24, anchor: 21 },
];

/** The part of the day an hour belongs to. */
export function periodOf(hour: number): DayPeriod {
  return (DAY_PERIODS.find((period) => hour >= period.from && hour < period.to) ?? DAY_PERIODS[0]).key;
}

export interface TimeOfDay {
  hour: number;
  minute: number;
}

/** The step every slot uses: a last-seen time is an estimate. */
export const SLOT_MINUTES = 15;

/** Minutes since midnight: slot comparisons without building a Date. */
const minutesOf = ({ hour, minute }: TimeOfDay) => hour * 60 + minute;

/**
 * The slots of `period` on `day` that have already happened by `now`. A
 * future day has none; today stops at the last slot that has started.
 *
 * Each slot is checked as a REAL INSTANT, not as minutes past midnight.
 * On the spring-forward day (UK: last Sunday in March) 01:00-01:59 doesn't
 * exist, and `atTime` rolls it on to 02:xx. Counting minutes would then show
 * 02:00-02:45 twice, and offer "02:15" at 02:10 while it's still in the
 * future. Non-existent times are skipped, and anything after `now` stops the
 * list.
 */
export function slotsFor(
  day: DayId,
  period: DayPeriod,
  now: Date,
  step: number = SLOT_MINUTES,
): TimeOfDay[] {
  if (day > toDayId(now)) return [];
  const { from, to } = DAY_PERIODS.find((candidate) => candidate.key === period) ?? DAY_PERIODS[0];

  const slots: TimeOfDay[] = [];
  for (let minutes = from * 60; minutes < to * 60; minutes += step) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const at = atTime(day, hour, minute);
    if (at.getHours() !== hour || at.getMinutes() !== minute) continue; // doesn't exist today
    if (at.getTime() > now.getTime()) break;
    slots.push({ hour, minute });
  }
  return slots;
}

/** Every slot of `day` that has already happened, earliest first. */
export function slotsOn(day: DayId, now: Date, step: number = SLOT_MINUTES): TimeOfDay[] {
  return DAY_PERIODS.flatMap((period) => slotsFor(day, period.key, now, step));
}

/**
 * The offered slot one step before (-1) or after (+1) `time` on `day`, or
 * null at the day's first slot, or at the latest one that has passed. Steps
 * walk the offered slots rather than adding 15 minutes, so a DST-missing
 * hour is stepped over and the future is never reached.
 */
export function stepSlot(
  day: DayId,
  time: TimeOfDay,
  direction: -1 | 1,
  now: Date,
  step: number = SLOT_MINUTES,
): TimeOfDay | null {
  const offered = slotsOn(day, now, step);
  const current = minutesOf(time);
  if (direction === 1) return offered.find((slot) => minutesOf(slot) > current) ?? null;
  return offered.filter((slot) => minutesOf(slot) < current).pop() ?? null;
}

/**
 * Where a part-of-day chip lands: its anchor, or the latest slot of that part
 * that has passed if the anchor is still ahead (today). Null if none of the
 * part has happened yet, which is when its segment is hidden.
 */
export function jumpToPeriod(
  day: DayId,
  period: DayPeriod,
  now: Date,
  step: number = SLOT_MINUTES,
): TimeOfDay | null {
  const slots = slotsFor(day, period, now, step);
  if (slots.length === 0) return null;
  const anchor = (DAY_PERIODS.find((candidate) => candidate.key === period) ?? DAY_PERIODS[0]).anchor * 60;
  return slots.filter((slot) => minutesOf(slot) <= anchor).pop() ?? slots[0];
}

/**
 * The slot `day` actually offers at or before `time`: floored to the step,
 * pulled back to the latest slot that has passed if `time` is still ahead, and
 * off a non-existent DST time. Null only for a day with no slots at all (a
 * future day).
 */
export function clampTime(
  day: DayId,
  time: TimeOfDay,
  now: Date,
  step: number = SLOT_MINUTES,
): TimeOfDay | null {
  const offered = slotsOn(day, now, step);
  if (offered.length === 0) return null;
  const wanted = minutesOf(time);
  // The last offered slot not after the wanted time. The first slot if
  // `time` is before them all (it can't be, as 00:00 always exists, but
  // don't depend on that).
  return offered.filter((slot) => minutesOf(slot) <= wanted).pop() ?? offered[0];
}

