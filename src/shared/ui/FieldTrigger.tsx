/**
 * WHAT:  FieldTrigger — a TextField-shaped button that opens a picker. It shows
 *        a floated label over the chosen value, or a resting placeholder, with
 *        one trailing icon.
 * WHY:   The date fields (LastSeenTimeField, DateRangeField) each hand-copied
 *        the same TextField-family geometry: sizes.input tall, radii.md, a 1pt
 *        border, a floated caption label. One component keeps them identical
 *        (2026-09-29, design review).
 *        One trailing icon only: a calendar (or similar) says "opens a
 *        picker", where a chevron would promise a new screen.
 * LINKS: src/shared/ui/{DateRangeField,TextField}.tsx;
 *        src/features/vehicles/post/components/LastSeenTimeField.tsx.
 */

import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radii, sizes, spacing, typography, usePalette, useThemedStyles, type Palette } from '../theme';

export interface FieldTriggerProps {
  /** Floated over the value once there is one. */
  label: string;
  /** The chosen value, as shown; null shows the placeholder. */
  value: string | null;
  placeholder: string;
  onPress: () => void;
  /** Spoken name. Should include the value when there is one. */
  accessibilityLabel: string;
  accessibilityHint?: string;
  icon?: ComponentProps<typeof Feather>['name'];
  testID?: string;
}

/** A TextField-shaped button that opens a picker (see the file header). */
export function FieldTrigger({
  label,
  value,
  placeholder,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  icon = 'calendar',
  testID,
}: FieldTriggerProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.field, pressed && styles.fieldPressed]}
    >
      <View style={styles.text}>
        {value !== null ? (
          <>
            <Text numberOfLines={1} style={styles.floatedLabel}>
              {label}
            </Text>
            <Text numberOfLines={1} style={styles.value}>
              {value}
            </Text>
          </>
        ) : (
          <Text numberOfLines={1} style={styles.restingLabel}>
            {placeholder}
          </Text>
        )}
      </View>
      <Feather name={icon} size={sizes.iconSm} color={palette.textSecondary} />
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: sizes.input,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radii.md,
      backgroundColor: c.surface,
      paddingHorizontal: spacing.lg,
    },
    fieldPressed: {
      backgroundColor: c.surfaceSubtle,
    },
    text: {
      flex: 1,
      paddingVertical: spacing.sm,
    },
    floatedLabel: {
      ...typography.caption,
      fontFamily: typography.label.fontFamily,
      color: c.textSecondary,
    },
    value: {
      ...typography.body,
      color: c.textPrimary,
    },
    restingLabel: {
      ...typography.body,
      color: c.textSecondary,
    },
  });
