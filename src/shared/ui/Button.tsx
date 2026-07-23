/**
 * WHAT:  Button — the app's pressable action primitive. Variants `primary`
 *        (orange fill, ADR-0005), `secondary` (outline), `ghost` (bare),
 *        `danger` (red fill), `subtle` (grey fill, ink label — the reference's
 *        "Show all N" block button; docs/design-refs/post-detail/
 *        REFERENCE_SPEC.md §7); 52pt tall, `md` radius, full-width by default.
 * WHY:   Buttons appear on nearly every screen and must look and behave
 *        identically (docs/DESIGN_SYSTEM.md, Core components). Centralising
 *        the variants keeps pressed/disabled states and touch-target sizing
 *        consistent, and stops screens hand-rolling their own Pressables.
 *        Text-only plus an optional loading spinner (the post-a-car wizard's
 *        DVLA lookup and submit need an in-button busy state) — icons still
 *        get added only when a real flow needs them, not speculatively.
 * LINKS: docs/DESIGN_SYSTEM.md (Core components, Accessibility);
 *        src/shared/theme.
 *
 * Usage:
 *   <Button label="Report a sighting" onPress={submit} />
 *   <Button label="Back" variant="ghost" onPress={goBack} />
 */

import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { colors, opacity, radii, sizes, spacing, typography } from '../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';

export interface ButtonProps {
  /** Button text — sentence case per the design system's tone rules. */
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** Disables presses and mutes the button. */
  disabled?: boolean;
  /**
   * Shows a spinner in place of the label and blocks presses — for async
   * actions in flight (e.g. a plate lookup or a submit). The label stays
   * mounted but hidden so the button keeps its width.
   */
  loading?: boolean;
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
  // The page's only non-CTA block button (the "show all/more" pattern):
  // quiet grey fill, ink label — never competes with a primary action.
  subtle: {
    rest: { backgroundColor: colors.surfaceSubtle },
    pressed: { backgroundColor: colors.surfaceSubtlePressed },
    label: { color: colors.textPrimary },
  },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = true,
}: ButtonProps) {
  const variantStyle = VARIANT_STYLES[variant];
  // Loading blocks presses like disabled, but reads as "busy" not "unavailable"
  // to assistive tech, and keeps the full-opacity fill (a spinner, not a mute).
  const blocked = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: loading }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        fullWidth ? styles.fullWidth : styles.hugContent,
        pressed && !blocked ? variantStyle.pressed : variantStyle.rest,
        disabled && styles.disabled,
      ]}
    >
      {/* Keep the label mounted (hidden) under the spinner so the button holds
          its width instead of collapsing to the indicator. */}
      <Text
        style={[styles.label, variantStyle.label, loading && styles.hiddenLabel]}
      >
        {label}
      </Text>
      {loading ? (
        <ActivityIndicator
          color={variantStyle.label.color}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
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
  hiddenLabel: {
    opacity: 0,
  },
});
