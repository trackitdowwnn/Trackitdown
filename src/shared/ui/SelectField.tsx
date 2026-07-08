/**
 * WHAT:  SelectField — the trigger for a full-screen select: looks and sits
 *        like a TextField (floating label geometry, md radius, border/error
 *        colours) but the whole field is pressable, shows the selected
 *        option's label (or rests the label as placeholder), and opens a
 *        SelectScreen with a chevron cue on the right.
 * WHY:   Forms treat selects and text inputs as siblings, so they must read
 *        as one family (docs/DESIGN_SYSTEM.md, Forms). Controlled
 *        value/onChange keeps it form-library-agnostic — a react-hook-form
 *        Controller can drive it exactly like TextField. The field owns the
 *        screen's open state so consumers wire nothing but options and
 *        value.
 * LINKS: src/shared/ui/SelectScreen.tsx; src/shared/ui/selectOptions.ts;
 *        src/shared/ui/TextField.tsx (visual sibling); docs/DESIGN_SYSTEM.md.
 *
 * Usage:
 *   <SelectField
 *     label="Car make"
 *     options={makeOptions}
 *     value={make}
 *     onChange={setMake}
 *     recentValues={recentMakes}
 *   />
 */

import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, opacity, radii, sizes, spacing, typography } from '../theme';
import { SelectScreen } from './SelectScreen';
import type { SelectOption } from './selectOptions';

export interface SelectFieldProps<V extends string | number> {
  /** Field label — rests as the placeholder, sits floated once selected. */
  label: string;
  options: SelectOption<V>[];
  /** Controlled value; null renders the resting label/placeholder. */
  value: V | null;
  onChange: (value: V) => void;
  /** Hint shown instead of the label while nothing is selected. */
  placeholder?: string;
  /** Error message — styles the field invalid and replaces helperText. */
  error?: string;
  helperText?: string;
  disabled?: boolean;
  /** SelectScreen extras. Title defaults to the field label. */
  screenTitle?: string;
  searchPlaceholder?: string;
  recentValues?: V[];
}

export function SelectField<V extends string | number>({
  label,
  options,
  value,
  onChange,
  placeholder,
  error,
  helperText,
  disabled = false,
  screenTitle,
  searchPlaceholder,
  recentValues,
}: SelectFieldProps<V>) {
  const [open, setOpen] = useState(false);

  const selectedLabel = options.find((option) => option.value === value)?.label ?? null;
  const message = error ?? helperText;

  // iOS has no accessibilityLiveRegion; announce errors explicitly so
  // VoiceOver users hear them the moment they appear (TextField parity).
  useEffect(() => {
    if (error) {
      AccessibilityInfo.announceForAccessibility(`${label}: ${error}`);
    }
  }, [error, label]);

  return (
    <View style={styles.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${selectedLabel ?? 'not selected'}, opens selection screen`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.field,
          { borderColor: error ? colors.danger : colors.border },
          pressed && !disabled && styles.fieldPressed,
          disabled && styles.fieldDisabled,
        ]}
      >
        <View style={styles.fieldText}>
          {selectedLabel ? (
            <>
              <Text numberOfLines={1} style={styles.floatedLabel}>
                {label}
              </Text>
              <Text numberOfLines={1} style={styles.value}>
                {selectedLabel}
              </Text>
            </>
          ) : (
            <Text numberOfLines={1} style={styles.restingLabel}>
              {placeholder ?? label}
            </Text>
          )}
        </View>
        <Feather
          name="chevron-down"
          size={typography.heading.fontSize}
          color={colors.textSecondary}
        />
      </Pressable>

      {message ? (
        <Text
          style={[styles.message, error ? styles.messageError : styles.messageHelper]}
          accessibilityLiveRegion={error ? 'polite' : 'none'}
        >
          {message}
        </Text>
      ) : null}

      <SelectScreen
        visible={open}
        title={screenTitle ?? label}
        options={options}
        value={value}
        onSelect={onChange}
        onClose={() => setOpen(false)}
        searchPlaceholder={searchPlaceholder}
        recentValues={recentValues}
      />
    </View>
  );
}

// Mirrors TextField's floating-label geometry so the two sit as siblings.
const styles = StyleSheet.create({
  root: {
    gap: spacing.sm,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.input,
    borderWidth: 1,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
  },
  fieldPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  fieldDisabled: {
    backgroundColor: colors.surfaceSubtle,
    opacity: opacity.disabled,
  },
  fieldText: {
    flex: 1,
    paddingVertical: spacing.sm,
  },
  restingLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  floatedLabel: {
    ...typography.caption,
    fontWeight: typography.label.fontWeight,
    color: colors.textSecondary,
  },
  value: {
    ...typography.body,
    color: colors.textPrimary,
  },
  message: {
    ...typography.caption,
  },
  messageHelper: {
    color: colors.textSecondary,
  },
  messageError: {
    color: colors.danger,
  },
});
