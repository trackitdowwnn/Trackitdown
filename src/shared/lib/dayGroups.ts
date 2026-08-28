/**
 * WHAT:  Day-grouping for the notification feed — turns a newest-first row
 *        list into a flat render list of day headers and rows.
 * WHY:   FlashList wants ONE flat array; nesting sections costs its recycling.
 *        The labels are the calm calendar words a person uses — "Today",
 *        "Yesterday", then "23 July" (year added only when it isn't this
 *        year). Pure and clock-injected so the boundary cases (midnight,
 *        year-end) are unit tests, not device folklore.
 *        Deliberately NOT chat's messageGroups: that groups sender runs
 *        within a thread; this groups calendar days within a feed.
 *
 *        ⚠️ MOVED HERE FROM features/notifications/lib ON 2026-08-28, when
 *        `My reports` became a second consumer (owner request: organise the
 *        cards by date). Two features needing the same thing is
 *        ARCHITECTURE.md's bar for shared/, and the alternative — sightings
 *        importing a notifications internal — breaks rule 1. Nothing about the
 *        grouping changed in the move; the labels a spotter reads on their
 *        report history are deliberately the SAME calendar words the inbox
 *        uses, so the two lists do not each invent a vocabulary for "when".
 * LINKS: src/features/notifications/screens/NotificationCenterScreen.tsx and
 *        src/features/sightings/screens/MySightingsScreen.tsx (the consumers);
 *        src/features/chat/lib/messageGroups.ts (the sibling it is not).
 */

export interface DayGrouped<Row> {
  items: ({ type: 'header'; key: string; label: string } | { type: 'row'; key: string; row: Row })[];
}

const dayLabel = (date: Date, now: Date): string => {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / dayMs);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
};

/**
 * Rows must already be newest-first (the query orders them); grouping only
 * inserts a header whenever the day label changes.
 */
export function groupByDay<Row extends { id: string; createdAt: string }>(
  rows: Row[],
  now: Date = new Date(),
): DayGrouped<Row>['items'] {
  const items: DayGrouped<Row>['items'] = [];
  let currentLabel: string | null = null;
  for (const row of rows) {
    const label = dayLabel(new Date(row.createdAt), now);
    if (label !== currentLabel) {
      currentLabel = label;
      items.push({ type: 'header', key: `header-${label}`, label });
    }
    items.push({ type: 'row', key: row.id, row });
  }
  return items;
}
