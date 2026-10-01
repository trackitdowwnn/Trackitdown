/**
 * WHAT:  MakeField — the car-make picker field: a SelectField that opens the
 *        full-screen make picker, AutoTrader-style: browse-first, the ten most
 *        common UK makes as two-up tiles ("Popular makes"), then "All makes"
 *        A–Z with sticky letters, hairline-divided rows and a letter rail, and
 *        a search that ignores accents and knows the other names ("vw",
 *        "merc", "skoda"). Two modes:
 *          - answering (posting, garage, the listing editor): a free-typed make
 *            is allowed for anything unlisted ("Use "<query>"");
 *          - `filter` (search, alerts): an "Any make" row leads, a × clears the
 *            field, and only listed makes can be picked.
 * WHY:   Make is the car's primary identity, so it earns the roomy picker
 *        rather than a bare text box — but posts.make is FREE TEXT, so an owner
 *        must be able to enter a make we don't list. A filter is different:
 *        "any" is a real answer there, and a make nobody's car has can't match
 *        anything. The stored value IS the make label ("BMW").
 *        TEXT-ONLY ROWS (2026-10-01 polish): the old grey monogram disc only
 *        repeated the sticky section letter, at 1.08:1 against the page.
 *        AutoTrader's filter lists carry no logos either.
 * LINKS: src/shared/lib/carMakes.ts (the list, from DfT data);
 *        src/features/vehicles/post/components/postSteps.tsx (MakeStep);
 *        src/features/search-map/components/SearchSheet.tsx (filter);
 *        src/shared/ui/SelectField.tsx (+ SelectScreen) — the picker.
 */

import { useCallback } from 'react';

import { SelectField, type SelectOption } from '@/shared/ui';

import { CAR_MAKES, POPULAR_MAKES, canonicaliseMake, makeKeywords } from '@/shared/lib/carMakes';

/** Static once — CAR_MAKES never changes at runtime. Value === label so a pick
 *  writes the make string straight into the answer. */
const MAKE_OPTIONS: SelectOption<string>[] = CAR_MAKES.map((make) => ({
  value: make.label,
  label: make.label,
  section: make.section,
  keywords: makeKeywords(make.label),
}));

export interface MakeFieldProps {
  /** The selected make (free text — may be unlisted), or null. */
  value: string | null;
  onChange: (make: string) => void;
  error?: string;
  /** Search and alerts: "Any make" and a ×, both calling `onClear`; listed
   *  makes only. */
  filter?: { onClear: () => void };
}

export function MakeField({ value, onChange, error, filter }: MakeFieldProps) {
  /**
   * ⚠️ EVERY MAKE THIS APP STORES PASSES THROUGH HERE — posting, the garage,
   * search and alerts all render this one field — which is why
   * canonicalisation belongs at this seam and nowhere else (review #20).
   *
   * A post says what the owner typed and an alert says what the spotter typed;
   * the server matches them with `lower(btrim(...))` and nothing more. So "VW"
   * never met "Volkswagen", and hand-typed "Skoda" never met the list's
   * "Škoda" — the alert simply stayed silent, which is the failure mode this
   * whole feature exists to prevent.
   *
   * A picked option is already canonical, so this only ever changes a
   * FREE-TYPED entry — and returns anything it does not recognise untouched.
   */
  const onChangeCanonical = useCallback(
    (make: string) => onChange(canonicaliseMake(make)),
    [onChange],
  );

  return (
    <SelectField
      label="Make"
      placeholder={filter ? 'Any make' : 'Select the make'}
      screenTitle="Car make"
      searchPlaceholder="Search car makes"
      options={MAKE_OPTIONS}
      value={value}
      onChange={onChangeCanonical}
      error={error}
      // Browse-first: the list leads; the keyboard rises only on tap.
      autoFocusSearch={false}
      recentValues={POPULAR_MAKES}
      pinnedTitle="Popular makes"
      pinnedLayout="grid"
      allTitle="All makes"
      showIndex
      stagger
      // Answering: any make not on the list is enterable as typed. A filter
      // offers only listed makes, the ones a car can actually be posted as.
      allowManualEntry={!filter}
      clearable={
        filter
          ? { anyLabel: 'Any make', clearLabel: 'Clear make', onClear: filter.onClear }
          : undefined
      }
    />
  );
}
