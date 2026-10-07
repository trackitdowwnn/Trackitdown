/**
 * WHAT:  Date/time display formatting — an ISO timestamp rendered as a
 *        friendly local-time label: "Today, 14:30", "Yesterday, 09:00",
 *        "Tomorrow, 10:00", then "Mon 6 Jul, 14:30" beyond a day away. Also
 *        the money dates, always in EUROPE/LONDON: formatTermDate (the day
 *        something happened) and formatLastDay (the last whole day of a
 *        reward term or payout deadline, stored as the midnight after it).
 * WHY:   Wherever a picked or recorded moment is shown (the last-seen field,
 *        post detail, moderation), the same phrasing must appear. Relative
 *        day names cover the window victims actually reason about ("when
 *        did you last see it?"); the time half follows the DEVICE locale
 *        via toLocaleTimeString (UK phones typically render 14:30, not
 *        2:30 PM) — deliberately not a fixed format and not a date-fns
 *        dependency. The day words (Today/Yesterday/Tomorrow) are English
 *        only: fine for the UK-only launch, but this is NOT localised
 *        output — revisit alongside any i18n work. The money dates ignore the
 *        device's zone on purpose: the server's pushes word the same dates
 *        in Europe/London, and an owner abroad must not read a different
 *        last day in the app than in the notification.
 * LINKS: src/features/vehicles/post/components/LastSeenTimeField.tsx (consumer);
 *        src/features/payments/components/RewardTermBanner.tsx,
 *        src/features/payments/lib/rewardTerm.ts,
 *        src/features/payments/screens/ChangeRewardScreen.tsx,
 *        src/features/vehicles/screens/MyPostsScreen.tsx (money-date consumers);
 *        src/shared/lib/calendarDates.ts (the picker's own day labels);
 *        src/shared/lib/timeAgo.ts (elapsed-time sibling); docs/TESTING.md;
 *        supabase/migrations/20261007120000_a_deadline_names_its_last_day.sql
 *          (last_day_text — formatLastDay's server twin; they must agree).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight at the start of the given date, in local time. */
function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Clock time alone: "14:30" (device locale — a UK phone renders 24-hour, a US
 * one renders "2:30 PM"; deliberately not a fixed format).
 *
 * ⚠️ EXTRACTED 2026-09-04 BECAUSE IT WAS ABOUT TO BE WRITTEN A THIRD TIME.
 * `formatDateTimeLabel` below and `chatThreadItems.timeCaption` had each
 * hand-rolled this exact `toLocaleTimeString` call, and the inbox row needed
 * it too. Three copies of one format string is where the locale behaviour
 * starts drifting between the screen that shows a message and the screen that
 * lists it.
 *
 * @throws If `iso` is not a parseable timestamp.
 */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`formatClock got an unparseable timestamp: ${iso}`);
  }
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * "Today, 14:30" / "Yesterday, 09:00" / "Mon 6 Jul, 14:30" (device locale).
 *
 * @throws If `iso` is not a parseable timestamp.
 */
export function formatDateTimeLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`formatDateTimeLabel got an unparseable timestamp: ${iso}`);
  }

  const time = formatClock(iso);
  const dayDelta = Math.round((startOfLocalDay(now) - startOfLocalDay(date)) / DAY_MS);

  if (dayDelta === 0) {
    return `Today, ${time}`;
  }
  if (dayDelta === 1) {
    return `Yesterday, ${time}`;
  }
  if (dayDelta === -1) {
    return `Tomorrow, ${time}`;
  }
  const day = date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return `${day}, ${time}`;
}

/**
 * A LIST ROW'S stamp: "14:32" today, "Yesterday" yesterday, "6 Jul" before
 * that, "6 Jul 2025" in another year.
 *
 * ⚠️ IT CARRIES THE DAY BECAUSE NOTHING ELSE DOES ANY MORE (2026-09-04). Both
 * inbox faces used to group their rows under `DayHeader`s, so a row only had to
 * say the time and the header above it supplied the day. The lists are flat
 * now, which is why one value has to answer both questions at once — and why
 * this is a single formatter shared by both faces rather than each inventing
 * its own ladder.
 *
 * ⚠️ IT DEGRADES BY PRECISION, not by format. Today you want the time; a week
 * ago the time is noise and the date is the answer. "Yesterday" gets a word
 * because it is the one boundary people reason about by name. That ladder is
 * the reason this is not just `formatClock` — a bare "14:32" on a thread from
 * March is actively misleading.
 *
 * @throws If `iso` is not a parseable timestamp.
 */
export function formatListStamp(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`formatListStamp got an unparseable timestamp: ${iso}`);
  }

  const dayDelta = Math.round((startOfLocalDay(now) - startOfLocalDay(date)) / DAY_MS);
  if (dayDelta === 0) return formatClock(iso);
  if (dayDelta === 1) return 'Yesterday';
  return formatDateLabelCompact(iso, now);
}

/** Date only, no time: "8 Jul 2026" — for record-style labels (post detail's
 *  "Posted" / "Active until"). @throws on an unparseable timestamp. */
export function formatDateLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`formatDateLabel got an unparseable timestamp: ${iso}`);
  }
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Date only, dropping the year when it is the CURRENT year: "8 Jul", but
 * "8 Jul 2025" for any other. @throws on an unparseable timestamp.
 *
 * For labels in TIGHT space where the year is usually noise — a half-width
 * range-bound field, or a one-line summary pill. "8 Jul 2026" truncates to
 * "8 Jul 20…" in a half-width field, which is worse than no year at all; a
 * different year is the load-bearing part and is always kept.
 *
 * `now` is injectable so tests don't depend on the wall clock.
 */
export function formatDateLabelCompact(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`formatDateLabelCompact got an unparseable timestamp: ${iso}`);
  }
  return date.getFullYear() === now.getFullYear()
    ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : formatDateLabel(iso);
}

/**
 * The day something HAPPENED: "4 December" — day and month in full, in
 * EUROPE/LONDON regardless of the device's zone, so it matches the server's
 * pushes (`at time zone 'Europe/London'`). For an instant that is an event (a
 * refund sent) or a plain day count ("now + 60 days"). NOT for a stored term
 * end or deadline — use formatLastDay. `withWeekday` gives "Thursday
 * 4 December". @throws on an unparseable timestamp.
 */
export function formatTermDate(iso: string, withWeekday = false): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`formatTermDate got an unparseable timestamp: ${iso}`);
  }
  return date.toLocaleDateString('en-GB', {
    ...(withWeekday ? { weekday: 'long' as const } : {}),
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/London',
  });
}

/**
 * The last WHOLE day of something that ends at `endIso`: a reward term
 * (`termEndsAt`) or a payout deadline — the London calendar day before the one
 * the end falls on. Those are stored as the instant they end, normally
 * midnight at the START of the next London day (reward_term_end), so their own
 * date is one day late: an end of 7 December 00:00 has 6 December as its last
 * day. An end the capture + 85 hard line cuts partway through a day (15:00 on
 * 30 December) names the day before too (29 December): never a day that is
 * not wholly theirs. Calendar arithmetic, no epsilon — the server's
 * last_day_text is the same rule, and the two must never disagree
 * (20261007120000). @throws on an unparseable timestamp.
 */
export function formatLastDay(endIso: string, withWeekday = false): string {
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) {
    throw new Error(`formatLastDay got an unparseable timestamp: ${endIso}`);
  }
  // The London calendar date the end falls on. en-GB numeric is DD/MM/YYYY —
  // the same toLocaleDateString-with-timeZone the app already relies on, so
  // nothing newer is asked of Hermes' Intl.
  const [day, month, year] = end
    .toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'numeric', year: 'numeric' })
    .split('/')
    .map(Number);
  // Noon UTC on the day before is that same date in London, whatever its
  // offset; Date.UTC rolls day 0 back into the previous month.
  return formatTermDate(new Date(Date.UTC(year, month - 1, day - 1, 12)).toISOString(), withWeekday);
}

/** Month + year: "July 2026" — for "member since" style labels. @throws on
 *  an unparseable timestamp. */
export function formatMonthYear(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`formatMonthYear got an unparseable timestamp: ${iso}`);
  }
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}
