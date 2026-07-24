/**
 * WHAT:  MakeField — the car-make picker field for the post-a-car details
 *        step: a SelectField that opens the full-screen searchable make picker
 *        (browse-first, "Popular makes" pinned, A–Z index rail, monogram per
 *        row) and accepts a free-typed make for anything unlisted.
 * WHY:   Make is the car's primary identity, so it earns the roomy Airbnb-style
 *        picker rather than a bare text box — but posts.make is FREE TEXT, so
 *        the manual-entry path must reach an unlisted make: typing a make with
 *        no exact match surfaces a "Use "<query>"" row (allowManualEntry). The
 *        stored value IS the make label ("BMW"), so a pick or a typed entry both
 *        write exactly what the DB keeps. Real logos are a later swap — the
 *        monogram fills the slot now (icon convention).
 * LINKS: src/features/vehicles/post/lib/carMakes.ts (the list);
 *        src/features/vehicles/post/components/postSteps.tsx (MakeStep);
 *        src/shared/ui/SelectField.tsx (+ SelectScreen) — the picker.
 */

import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, sizes, typography } from '@/shared/theme';
import { SelectField, type SelectOption } from '@/shared/ui';

import { CAR_MAKES, POPULAR_MAKES, makeSection } from '../lib/carMakes';

/** Placeholder for a real make logo — a monogram of the make's first letter. */
function Monogram({ letter }: { letter: string }) {
  return (
    <View style={styles.monogram}>
      <Text style={styles.monogramText}>{letter}</Text>
    </View>
  );
}

/** Static once — CAR_MAKES never changes at runtime. Value === label so a pick
 *  writes the make string straight into the answer. */
const MAKE_OPTIONS: SelectOption<string>[] = CAR_MAKES.map((make) => ({
  value: make.label,
  label: make.label,
  section: make.section,
  icon: <Monogram letter={make.section} />,
}));

export interface MakeFieldProps {
  /** The selected make (free text — may be unlisted), or null. */
  value: string | null;
  onChange: (make: string) => void;
  error?: string;
}

export function MakeField({ value, onChange, error }: MakeFieldProps) {
  return (
    <SelectField
      label="Make"
      placeholder="Select the make"
      screenTitle="Car make"
      searchPlaceholder="Search car makes"
      options={MAKE_OPTIONS}
      value={value}
      onChange={onChange}
      error={error}
      // Browse-first: the list leads; the keyboard rises only on tap.
      autoFocusSearch={false}
      recentValues={POPULAR_MAKES}
      pinnedTitle="Popular makes"
      showIndex
      stagger
      // Any make not on the list is enterable as free text: typing it surfaces
      // a "Use "<query>"" row.
      allowManualEntry
    />
  );
}

/** Re-derive a monogram letter if a caller needs one outside the field. */
export const monogramFor = makeSection;

const styles = StyleSheet.create({
  monogram: {
    width: sizes.circleButtonSm,
    height: sizes.circleButtonSm,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monogramText: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.textSecondary,
  },
});
