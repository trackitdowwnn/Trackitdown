/**
 * WHAT:  Button — the app's pressable action primitive. Variants `primary`
 *        (sage fill), `secondary` (outline), `ghost` (bare), `danger`
 *        (muted red fill); 52pt tall, `md` radius, full-width by default.
 * WHY:   Buttons appear on nearly every screen and must look and behave
 *        identically (docs/DESIGN_SYSTEM.md, Core components). Centralising
 *        the variants keeps pressed/disabled states and touch-target sizing
 *        consistent, and stops screens hand-rolling their own Pressables.
 *        Text-only by design — icons/loading states get added here when a
 *        real flow needs them, not speculatively.
 * LINKS: docs/DESIGN_SYSTEM.md (Core components, Accessibility);
 *        src/shared/theme.
 *
 * Usage:
 *   <Button label="Report a sighting" onPress={submit} />
 *   <Button label="Back" variant="ghost" onPress={goBack} />
 */

import { Pressable, StyleSheet, Text, type TextStyle, type ViewStyle } from 'react-native';

import { colors, opacity, radii, sizes, spacing, typography } from '../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  /** Button text — sentence case per the design system's tone rules. */
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** Disables presses and mutes the button. */
  disabled?: boolean;
  /** Buttons stretch full-width by default; set false to hug content. */
  fullWidth?: boolean;
}

/** Per-variant colours for rest and pressed states. */
const VARIANT_STYLES: Record<
  ButtonVariant,
  { rest: ViewStyle; pressed: ViewStyle; label: TextStyle }
> = {
  primary: {
    rest: { backgroundColor: colors.primary },
    pressed: { backgroundColor: colors.primaryPressed },
    label: { color: colors.textOnPrimary },
  },
  secondary: {
    rest: { borderWidth: 1, borderColor: colors.primary },
    pressed: { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surfaceSubtle },
    label: { color: colors.primary },
  },
  ghost: {
    rest: {},
    pressed: { backgroundColor: colors.surfaceSubtle },
    label: { color: colors.primary },
  },
  danger: {
    rest: { backgroundColor: colors.danger },
    pressed: { backgroundColor: colors.dangerPressed },
    label: { color: colors.textOnPrimary },
  },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  fullWidth = true,
}: ButtonProps) {
  const variantStyle = VARIANT_STYLES[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        fullWidth ? styles.fullWidth : styles.hugContent,
        pressed && !disabled ? variantStyle.pressed : variantStyle.rest,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.label, variantStyle.label]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    // minHeight, not height: the label must grow with dynamic type.
    minHeight: sizes.control,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  hugContent: {
    alignSelf: 'flex-start',
  },
  disabled: {
    opacity: opacity.disabled,
  },
  label: {
    ...typography.label,
  },
});
