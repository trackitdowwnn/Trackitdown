/**
 * WHAT:  ChoiceChips — a single-select row of pill chips: `surfaceSubtle`
 *        resting, `primary` fill when selected, wrapping to new lines as
 *        needed.
 * WHY:   Small closed choices (favourite-colour steps, date presets,
 *        filters) read faster as tappable pills than as a select; one
 *        shared implementation keeps the radio-group semantics (radiogroup/
 *        radio + checked, 44pt targets) and pressed states consistent.
 *        Promoted from the wizard demo once DateTimeField became its
 *        second consumer. Values may be transient (a preset row can pass
 *        value=null and treat onSelect as an action).
 * LINKS: docs/DESIGN_SYSTEM.md (Colour, Accessibility);
 *        src/shared/ui/DateTimeField.tsx and src/app/wizard-demo.tsx
 *        (consumers).
 *
 * Usage:
 *   <ChoiceChips
 *     options={[{ value: 'sage', label: 'Sage' }, { value: 'sky', label: 'Sky' }]}
 *     value={colour}
 *     onSelect={setColour}
 *   />
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, sizes, spacing, typography } from '../theme';

export interface ChoiceChipOption<V extends string = string> {
  value: V;
  label: string;
}

export interface ChoiceChipsProps<V extends string = string> {
  options: ChoiceChipOption<V>[];
  /** Currently selected value; null renders no chip selected. */
  value: V | null;
  onSelect: (value: V) => void;
  /**
   * `radio` (default) for persistent selections; `button` when chips are
   * one-tap ACTIONS (e.g. date presets) — announcing an action as an
   * unchecked radio that never checks is a name/role/value mismatch.
   */
  role?: 'radio' | 'button';
}

export function ChoiceChips<V extends string = string>({
  options,
  value,
  onSelect,
  role = 'radio',
}: ChoiceChipsProps<V>) {
  const asRadios = role === 'radio';
  return (
    <View style={styles.row} accessibilityRole={asRadios ? 'radiogroup' : undefined}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole={role}
            accessibilityLabel={option.label}
            accessibilityState={asRadios ? { checked: selected } : undefined}
            onPress={() => onSelect(option.value)}
            style={({ pressed }) => [
              styles.chip,
              selected && styles.chipSelected,
              pressed && (selected ? styles.chipSelectedPressed : styles.chipPressed),
            ]}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: sizes.touchTarget,
    minWidth: sizes.touchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: {
    backgroundColor: colors.primary,
  },
  chipPressed: {
    backgroundColor: colors.surfaceSubtlePressed,
  },
  chipSelectedPressed: {
    backgroundColor: colors.primaryPressed,
  },
  label: {
    ...typography.label,
    color: colors.textPrimary,
  },
  labelSelected: {
    color: colors.textOnPrimary,
  },
});
