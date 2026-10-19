/**
 * WHAT:  notificationDayGroups — turns the notification feed into the list
 *        the center draws: "Today", "Yesterday" and "Earlier" headers, each
 *        followed by its rows, newest first.
 * WHY:   Added 2026-10-19 (owner: the tab was "hard to read and understand";
 *        chose day groups from mockups). The feed went flat on 2026-09-04
 *        alongside Messages; a notification feed is read as "what happened
 *        today", where a conversation list is read by person, so this face
 *        groups again and Messages stays flat.
 *
 *        THREE BUCKETS, not a header per date: "Earlier" holds everything
 *        older, and each row's own stamp still says its date. Rows are
 *        BUCKETED, not split where the label changes, so out-of-order input
 *        can never print a header twice (the rule `groupByDay` once needed).
 *        A row dated after `now` (clock skew) counts as Today.
 *
 *        `now` is passed in, never read here: on device the React Compiler
 *        freezes a render-time `new Date()` (see shared/hooks/useNow).
 * LINKS: ../screens/NotificationCenterScreen.tsx (the consumer);
 *        src/shared/ui/DayHeader.tsx.
 */

import { formatClock, formatDateLabelCompact } from '@/shared/lib/dateTimeLabel';

import type { NotificationRow } from '../api/notificationsApi';

export type DayGroupLabel = 'Today' | 'Yesterday' | 'Earlier';

const ORDER: DayGroupLabel[] = ['Today', 'Yesterday', 'Earlier'];

export type CenterListItem =
  | { type: 'header'; label: DayGroupLabel }
  /** `firstInGroup`: no divider above it — the header already separates. */
  | { type: 'row'; row: NotificationRow; firstInGroup: boolean };

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Which bucket an ISO timestamp falls in, by LOCAL calendar day. */
export function dayGroupOf(iso: string, now: Date): DayGroupLabel {
  // Rounded: a DST change makes one local day 23 or 25 hours long.
  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(new Date(iso))) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return 'Earlier';
}

/**
 * A grouped row's stamp: the clock under Today AND Yesterday — the header
 * already says the day, so a row repeating "Yesterday" says nothing — and the
 * date under Earlier, which names no day ("6 Oct"; "6 Oct 2025" in another
 * year). Uses the SAME `now` as the grouping, so a row can never disagree with
 * its own header across midnight.
 */
export function groupedRowStamp(iso: string, now: Date): string {
  return dayGroupOf(iso, now) === 'Earlier'
    ? formatDateLabelCompact(iso, now)
    : formatClock(iso);
}

/**
 * The center's list items: up to three groups in the fixed order Today →
 * Yesterday → Earlier, each a header then its rows. Empty groups are left
 * out, input order is kept within a group, and each group's first row has
 * `firstInGroup` (no divider above it). Rows dated after `now` count as Today.
 */
export function notificationDayGroups(rows: NotificationRow[], now: Date): CenterListItem[] {
  const buckets: Record<DayGroupLabel, NotificationRow[]> = {
    Today: [],
    Yesterday: [],
    Earlier: [],
  };
  for (const row of rows) buckets[dayGroupOf(row.createdAt, now)].push(row);

  return ORDER.flatMap((label): CenterListItem[] => {
    const group = buckets[label];
    if (group.length === 0) return [];
    return [
      { type: 'header', label },
      ...group.map((row, i) => ({ type: 'row' as const, row, firstInGroup: i === 0 })),
    ];
  });
}
