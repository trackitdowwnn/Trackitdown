/**
 * WHAT:  SeenRangeFields — the search sheet's "Dates seen" range. A thin
 *        adapter: it shows the shared DateRangeField and converts between its
 *        day IDs and the start-of-local-day instants that SearchCriteria
 *        stores.
 * WHY:   The recency chips ("Last 7 days") can only ever say "recently"; they
 *        cannot express "the week my car went missing", which is the question
 *        an owner following a specific incident actually has. This is the
 *        absolute-window half of the When filter.
 *        Since 2026-09-29 it's one custom calendar range, not two native
 *        From / To dialogs:
 *          - the calendar can't produce an inverted range, so the old
 *            "keep them in order" code is gone;
 *          - "Clear dates" is a real way back to no range. Picking a recency
 *            chip still also clears it, through setWhen.
 *        A range bound is a DATE, not a moment, so there's no time-of-day
 *        here. The wire value stays half-open (exclusiveEndIso).
 * LINKS: src/shared/ui/DateRangeField.tsx (the field and its sheet);
 *        src/shared/lib/calendarDates.ts (day IDs);
 *        src/features/search-map/lib/searchCriteria.ts (startOfLocalDayIso —
 *        and why the wire value is half-open).
 */

import { fromDayId, toDayId } from '@/shared/lib/calendarDates';
// Direct module import (not the '@/shared/ui' barrel) keeps this field's graph
// off the heavier UI it doesn't use — same reasoning as YearRangeFields.
import { DateRangeField } from '@/shared/ui/DateRangeField';

import { startOfLocalDayIso } from '../lib/searchCriteria';

export interface SeenRangeFieldsProps {
  /** Start of the picked local day, or null for open-ended. */
  from: string | null;
  to: string | null;
  /** Receives the ORDERED pair — never an inverted range. */
  onChange: (next: { seenFrom: string | null; seenTo: string | null }) => void;
}

const toDay = (iso: string | null) => (iso === null ? null : toDayId(new Date(iso)));
const toIso = (day: string | null) => (day === null ? null : startOfLocalDayIso(fromDayId(day)));

/** "Dates seen": DateRangeField, converted to and from SearchCriteria's
 *  start-of-local-day ISO bounds. */
export function SeenRangeFields({ from, to, onChange }: SeenRangeFieldsProps) {
  return (
    <DateRangeField
      label="Dates seen"
      placeholder="Any dates"
      sheetTitle="Pick dates"
      value={{ from: toDay(from), to: toDay(to) }}
      // A car cannot have been seen in the future. "Today" is read when the
      // sheet opens, so a search left open past midnight still offers today.
      noFuture
      onChange={(range) => onChange({ seenFrom: toIso(range.from), seenTo: toIso(range.to) })}
      testID="seen-range"
    />
  );
}
