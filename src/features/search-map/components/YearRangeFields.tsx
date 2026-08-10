/**
 * WHAT:  YearRangeFields — the search sheet's "From" / "To" model-year pair,
 *        two shared searchable SelectFields over the same year list, with an
 *        "Any" row on each side that clears that bound.
 * WHY:   Year is a RANGE on search ("a 2019-ish Golf"), not the single value
 *        the posting wizard captures — so YearField can't be reused directly,
 *        but its list and its picker can. Two SelectFields rather than a
 *        dual-thumb slider: 120 years on a ~300pt track is ~2.5pt each, so a
 *        slider physically cannot hit a specific year, and years are exact
 *        values people already know. The searchable picker jumps straight to
 *        one.
 *
 *        The pair is kept ORDERED here rather than at the call site: raising
 *        From above To pushes To up with it (and vice versa), so the control
 *        cannot produce an inverted range that silently matches nothing.
 * LINKS: src/features/vehicles/post/components/YearField.tsx (the single-value
 *        sibling this mirrors); src/shared/ui/SelectField.tsx (+ SelectScreen);
 *        src/features/search-map/lib/searchCriteria.ts (SEARCH_YEAR_MIN).
 */

import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/shared/theme';
// Direct module imports (not the '@/shared/ui' barrel) keep this field's graph
// off the heavier UI it doesn't use — same reasoning as YearField.
import { SelectField } from '@/shared/ui/SelectField';
import type { SelectOption } from '@/shared/ui/selectOptions';

import { SEARCH_YEAR_MIN } from '../lib/searchCriteria';

/** Sentinel that clears a bound. -1 can never collide with a real year, and
 *  matches YearField's "Not sure" sentinel convention. */
const ANY = -1;

export interface YearRangeFieldsProps {
  /** Inclusive lower bound, or null for open-ended. */
  from: number | null;
  /** Inclusive upper bound, or null for open-ended. */
  to: number | null;
  /** Receives the ORDERED pair — never an inverted range. */
  onChange: (next: { yearFrom: number | null; yearTo: number | null }) => void;
}

export function YearRangeFields({ from, to, onChange }: YearRangeFieldsProps) {
  // The ceiling is the current year, evaluated per render: no car exists that
  // was built after now, and a module-scope constant would go stale on 1 Jan.
  const currentYear = new Date().getFullYear();
  const options = useMemo<SelectOption<number>[]>(() => {
    const years: SelectOption<number>[] = [{ value: ANY, label: 'Any' }];
    for (let year = currentYear; year >= SEARCH_YEAR_MIN; year -= 1) {
      years.push({ value: year, label: String(year) });
    }
    return years;
  }, [currentYear]);

  return (
    <View style={styles.row}>
      <View style={styles.half}>
        <SelectField
          label="From"
          placeholder="Any"
          screenTitle="Year from"
          searchPlaceholder="Search years"
          options={options}
          value={from}
          onChange={(picked) => {
            const yearFrom = picked === ANY ? null : picked;
            // Raising the floor above the ceiling pushes the ceiling up rather
            // than leaving a range that matches nothing.
            const yearTo = yearFrom !== null && to !== null && to < yearFrom ? yearFrom : to;
            onChange({ yearFrom, yearTo });
          }}
          autoFocusSearch={false}
        />
      </View>
      <View style={styles.half}>
        <SelectField
          label="To"
          placeholder="Any"
          screenTitle="Year to"
          searchPlaceholder="Search years"
          options={options}
          value={to}
          onChange={(picked) => {
            const yearTo = picked === ANY ? null : picked;
            const yearFrom = yearTo !== null && from !== null && from > yearTo ? yearTo : from;
            onChange({ yearFrom, yearTo });
          }}
          autoFocusSearch={false}
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
