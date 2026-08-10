/**
 * WHAT:  SeenRangeFields — the search sheet's "From" / "To" last-seen date pair,
 *        two date-only DateTimeFields that keep themselves in order.
 * WHY:   The recency chips ("Last 7 days") can only ever say "recently"; they
 *        cannot express "the week my car went missing", which is the question
 *        an owner following a specific incident actually has. This is the
 *        absolute-window half of the When filter.
 *
 *        Date-only (`mode="date"`): a time-of-day is noise in a range bound and
 *        would imply a precision the filter does not use. Presets are hidden —
 *        DEFAULT_DATE_TIME_PRESETS are moment-shaped ("Just now", "Yesterday")
 *        for "when did you last see your car", not range bounds.
 *
 *        Ordering is enforced HERE, exactly as YearRangeFields does it: an
 *        inverted range is a perfectly valid criteria object that simply
 *        matches nothing, so the user reads "No cars match" as a fact about the
 *        world rather than a broken control.
 * LINKS: src/features/search-map/components/YearRangeFields.tsx (the sibling
 *        this mirrors); src/shared/ui/DateTimeField.tsx;
 *        src/features/search-map/lib/searchCriteria.ts (startOfLocalDayIso —
 *        and why the wire value is half-open).
 */

import { StyleSheet, View } from 'react-native';

import { spacing } from '@/shared/theme';
// Direct module import (not the '@/shared/ui' barrel) keeps this field's graph
// off the heavier UI it doesn't use — same reasoning as YearRangeFields.
import { DateTimeField } from '@/shared/ui/DateTimeField';

import { startOfLocalDayIso } from '../lib/searchCriteria';

export interface SeenRangeFieldsProps {
  /** Start of the picked local day, or null for open-ended. */
  from: string | null;
  to: string | null;
  /** Receives the ORDERED pair — never an inverted range. */
  onChange: (next: { seenFrom: string | null; seenTo: string | null }) => void;
}

export function SeenRangeFields({ from, to, onChange }: SeenRangeFieldsProps) {
  // A car cannot have been seen in the future, so neither bound may be.
  // DateTimeField defaults maxDate to "now" already; passing it explicitly
  // keeps that true for both fields even if that default ever changes.
  const now = new Date();

  return (
    <View style={styles.row}>
      <View style={styles.half}>
        <DateTimeField
          label="From"
          mode="date"
          presets={[]}
          placeholder="Any"
          value={from}
          maxDate={now}
          onChange={(iso) => {
            const seenFrom = startOfLocalDayIso(new Date(iso));
            // Pushing the floor past the ceiling carries the ceiling with it,
            // rather than leaving a range that matches nothing.
            const seenTo = to !== null && to < seenFrom ? seenFrom : to;
            onChange({ seenFrom, seenTo });
          }}
        />
      </View>
      <View style={styles.half}>
        <DateTimeField
          label="To"
          mode="date"
          presets={[]}
          placeholder="Any"
          value={to}
          maxDate={now}
          onChange={(iso) => {
            const seenTo = startOfLocalDayIso(new Date(iso));
            const seenFrom = from !== null && from > seenTo ? seenTo : from;
            onChange({ seenFrom, seenTo });
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  half: {
    flex: 1,
  },
});
