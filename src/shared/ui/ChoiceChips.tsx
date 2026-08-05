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
 *        src/shared/ui/DateTimeField.tsx (consumer).
 *
 * Usage:
 *   <ChoiceChips
 *     options={[{ value: 'sage', label: 'Sage' }, { value: 'sky', label: 'Sky' }]}
 *     value={colour}
 *     onSelect={setColour}
 *   />
 */

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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
  /**
   * One horizontally-scrolling line instead of wrapping onto a second.
   *
   * Wrapping is right inside a form, where a chip group is the whole answer
   * and vertical space is free. It is wrong at the top of a LIST screen: the
   * Inbox's four filters overflow a phone by ~20px, so the last chip dropped
   * to a line of its own and read as a layout fault. Scrolling also keeps the
   * header height constant, which stops the list jumping when a count label
   * grows ("Unread" → "Unread (12)").
   *
   * The scroller is full-bleed and owns the screen gutter itself, so chips can
   * scroll out under the edge: the CALLER must not add horizontal padding.
   */
  scrollable?: boolean;
  /**
   * Optional — the chip ROW takes this, the scroller takes `${testID}-scroller`.
   * Opt-in rather than a fixed id because a wizard step can render two chip
   * groups, and a hardcoded id would make both unfindable.
   */
  testID?: string;
}

export function ChoiceChips<V extends string = string>({
  options,
  value,
  onSelect,
  role = 'radio',
  scrollable = false,
  testID,
}: ChoiceChipsProps<V>) {
  const asRadios = role === 'radio';
  const chips = (
    <View
      style={[styles.row, scrollable && styles.rowScrollable]}
      accessibilityRole={asRadios ? 'radiogroup' : undefined}
      testID={testID}
    >
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

  if (!scrollable) {
    return chips;
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // The gutter lives on the CONTENT, not the scroller, so the first chip
      // starts on the screen margin while the last can scroll under the edge —
      // which is what tells the user there is more to the right.
      contentContainerStyle={styles.scrollContent}
      testID={testID ? `${testID}-scroller` : undefined}
    >
      {chips}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  rowScrollable: {
    flexWrap: 'nowrap',
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
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
