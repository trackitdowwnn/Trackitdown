/**
 * WHAT:  ChoiceChipsMulti — a MULTI-select row of pill chips: `surfaceSubtle`
 *        resting, `primary` fill + trailing check when selected, wrapping to new
 *        lines. The checkbox sibling of ChoiceChips (which is single-select).
 * WHY:   The post-a-car wizard's distinguishing-features step lets an owner
 *        pick many tags from the vehicle_feature taxonomy at once — a checkbox
 *        group, not a radio. One shared implementation keeps checkbox semantics
 *        (checkbox role + checked state, 44pt targets, a non-colour selection
 *        cue) and pressed states consistent with the rest of the kit. Options
 *        may carry a Feather icon so the picker mirrors the detail page's
 *        FeaturesGrid.
 * LINKS: docs/DESIGN_SYSTEM.md (Colour, Accessibility, Forms);
 *        src/shared/ui/ChoiceChips.tsx (single-select sibling);
 *        src/features/vehicles/components/FeaturesGrid.tsx (icon convention).
 *
 * Usage:
 *   <ChoiceChipsMulti
 *     options={[{ value: 'roof_rack', label: 'Roof rack', icon: 'box' }]}
 *     value={featureKeys}
 *     onChange={(next) => setAnswers({ featureKeys: next })}
 *   />
 */

import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, opacity, radii, sizes, spacing, typography } from '../theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

export interface ChoiceChipMultiOption<V extends string = string> {
  value: V;
  label: string;
  /** Optional Feather icon shown left of the label (matches FeaturesGrid). */
  icon?: FeatherName;
}

export interface ChoiceChipsMultiProps<V extends string = string> {
  options: ChoiceChipMultiOption<V>[];
  /** Currently selected values; order is preserved by the caller's array. */
  value: V[];
  /** Receives the full next selection (the chip's toggle is applied for you). */
  onChange: (next: V[]) => void;
  /**
   * Optional cap. At the cap, unselected chips are disabled (and announced
   * disabled) so the group can't exceed it; selected chips still deselect.
   */
  max?: number;
}

export function ChoiceChipsMulti<V extends string = string>({
  options,
  value,
  onChange,
  max,
}: ChoiceChipsMultiProps<V>) {
  const atCap = max !== undefined && value.length >= max;

  const toggle = (option: V) => {
    onChange(
      value.includes(option)
        ? value.filter((v) => v !== option)
        : [...value, option],
    );
  };

  return (
    <View style={styles.row}>
      {options.map((option) => {
        const selected = value.includes(option.value);
        // Only unselected chips are blocked at the cap — you can always remove.
        const disabled = atCap && !selected;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="checkbox"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            onPress={() => toggle(option.value)}
            style={({ pressed }) => [
              styles.chip,
              selected && styles.chipSelected,
              disabled && styles.chipDisabled,
              pressed &&
                !disabled &&
                (selected ? styles.chipSelectedPressed : styles.chipPressed),
            ]}
          >
            {option.icon ? (
              <Feather
                name={option.icon}
                size={sizes.iconSm}
                color={selected ? colors.textOnPrimary : colors.textSecondary}
                importantForAccessibility="no"
              />
            ) : null}
            <Text style={[styles.label, selected && styles.labelSelected]}>
              {option.label}
            </Text>
            {/* Trailing check: a selection cue that doesn't rely on colour
                alone. The slot is always present (fixed width) so toggling shows
                the tick WITHOUT resizing the chip and reflowing the wrapped row. */}
            <View style={styles.checkSlot}>
              {selected ? (
                <Feather
                  name="check"
                  size={sizes.iconSm}
                  color={colors.textOnPrimary}
                  importantForAccessibility="no"
                />
              ) : null}
            </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  checkSlot: {
    width: sizes.iconSm,
    alignItems: 'center',
  },
  chipSelected: {
    backgroundColor: colors.primary,
  },
  chipDisabled: {
    opacity: opacity.disabled,
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
