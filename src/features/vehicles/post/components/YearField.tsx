/**
 * WHAT:  YearField — the year picker for the post-a-car year step. The shared
 *        full-screen searchable SelectField, listing years newest-first from the
 *        current year back to 1900, plus a "Not sure" row that clears the
 *        (optional) year.
 * WHY:   A searchable picker matches the make/model steps and beats a free
 *        number field: it can't produce an out-of-range or nonsense year, and
 *        search jumps straight to a year. Year is OPTIONAL (posts.year is
 *        nullable, CHECK 1900–2100), so "Not sure" keeps the field clearable
 *        after a mis-tap. The stored value is the integer year.
 * LINKS: src/features/vehicles/post/components/postSteps.tsx (YearStep);
 *        src/features/vehicles/post/components/MakeField.tsx (sibling picker);
 *        src/shared/ui/SelectField.tsx (+ SelectScreen) — the picker.
 */

import { useMemo } from 'react';

// Direct module imports (not the '@/shared/ui' barrel) keep this field's graph
// off the heavier UI (BottomSheet/gorhom, MoneySlider) it doesn't use.
import { SelectField } from '@/shared/ui/SelectField';
import type { SelectOption } from '@/shared/ui/selectOptions';

/** Floor mirrors the posts.year CHECK (1900) so no real car — classics
 *  included — is un-listable. The ceiling is the current year, evaluated per
 *  render (a report is always for a car that exists now). */
const EARLIEST_YEAR = 1900;
/** Sentinel option value that clears the optional year (maps to null on pick). */
const NOT_SURE = -1;

export interface YearFieldProps {
  /** The selected year, or null when unset. */
  value: number | null;
  onChange: (year: number | null) => void;
  error?: string;
}

export function YearField({ value, onChange, error }: YearFieldProps) {
  const currentYear = new Date().getFullYear();
  const options = useMemo<SelectOption<number>[]>(() => {
    const years: SelectOption<number>[] = [{ value: NOT_SURE, label: 'Not sure' }];
    for (let year = currentYear; year >= EARLIEST_YEAR; year -= 1) {
      years.push({ value: year, label: String(year) });
    }
    return years;
  }, [currentYear]);

  return (
    <SelectField
      label="Year"
      placeholder="Select the year"
      screenTitle="Year"
      searchPlaceholder="Search years"
      options={options}
      value={value}
      onChange={(picked) => onChange(picked === NOT_SURE ? null : picked)}
      error={error}
      // Browse-first (newest years lead), matching the make/model pickers.
      autoFocusSearch={false}
    />
  );
}
