/**
 * WHAT:  Date/time display formatting — an ISO timestamp rendered as a
 *        friendly local-time label: "Today, 14:30", "Yesterday, 09:00",
 *        "Tomorrow, 10:00", then "Mon 6 Jul, 14:30" beyond a day away.
 * WHY:   Wherever a picked or recorded moment is shown (DateTimeField,
 *        post detail, moderation), the same phrasing must appear. Relative
 *        day names cover the window victims actually reason about ("when
 *        did you last see it?"); the time half follows the DEVICE locale
 *        via toLocaleTimeString (UK phones typically render 14:30, not
 *        2:30 PM) — deliberately not a fixed format and not a date-fns
 *        dependency. The day words (Today/Yesterday/Tomorrow) are English
 *        only: fine for the UK-only launch, but this is NOT localised
 *        output — revisit alongside any i18n work.
 * LINKS: src/shared/ui/DateTimeField.tsx (first consumer);
 *        src/shared/lib/timeAgo.ts (elapsed-time sibling); docs/TESTING.md.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight at the start of the given date, in local time. */
function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
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

  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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
