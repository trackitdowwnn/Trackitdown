/**
 * WHAT:  Button — the app's pressable action primitive. Variants `primary`
 *        (near-black fill, ADR-0006), `secondary` (outline), `ghost` (bare),
 *        `danger` (red fill), `dangerOutline` (red outline, for an emergency
 *        action beside a primary), `subtle` (grey fill, ink label — the reference's
 *        "Show all N" block button; docs/design-refs/post-detail/
 *        REFERENCE_SPEC.md §7); 52pt tall, `md` radius, full-width by default.
 * WHY:   Buttons appear on nearly every screen and must look and behave
 *        identically (docs/DESIGN_SYSTEM.md, Core components). Centralising
 *        the variants keeps pressed/disabled states and touch-target sizing
 *        consistent, and stops screens hand-rolling their own Pressables.
 *        Text-only plus an optional loading spinner (the post-a-car wizard's
 *        DVLA lookup and submit need an in-button busy state), and an optional
 *        leading icon, added 2026-09-30 for the first flow that needed one
 *        (the safety sheet's phone glyph on "Call 999").
 * LINKS: docs/DESIGN_SYSTEM.md (Core components, Accessibility);
 *        src/shared/theme.
 *
 * Usage:
 *   <Button label="Report a sighting" onPress={submit} />
 *   <Button label="Back" variant="ghost" onPress={goBack} />
 */

import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { opacity, radii, sizes, spacing, typography, useThemedStyles, type Palette } from '../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerOutline' | 'subtle';

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
  /** A Feather glyph before the label, in the label's colour. */
  icon?: ComponentProps<typeof Feather>['name'];
  /** Spoken instead of `label`. Start it with the visible words, so voice
   *  control still matches what's on screen. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

/**
 * Per-variant colours for rest and pressed states.
 *
 * A FACTORY, not a const: at module scope `colors.primary` is copied in as a
 * STRING the instant this module evaluates, so no runtime theme change could
 * ever reach it. It goes through useThemedStyles instead, which memoises one
 * result per palette across every Button in the app.
 *
 * The parameter is `c`, not `colors`, on purpose — a one-character difference
 * would let a stale `colors.` reference typecheck against the parameter and
 * survive the migration silently.
 *
 * Kept as plain objects rather than folded into StyleSheet.create because
 * `variantStyle.label.color` is read as a VALUE below, for the spinner.
 */
const makeVariantStyles = (
  c: Palette,
): Record<ButtonVariant, { rest: ViewStyle; pressed: ViewStyle; label: TextStyle }> => ({
  primary: {
    rest: { backgroundColor: c.primary },
    pressed: { backgroundColor: c.primaryPressed },
    label: { color: c.textOnPrimary },
  },
  secondary: {
    rest: { borderWidth: 1, borderColor: c.primary },
    pressed: { borderWidth: 1, borderColor: c.primary, backgroundColor: c.surfaceSubtle },
    label: { color: c.primary },
  },
  ghost: {
    rest: {},
    pressed: { backgroundColor: c.surfaceSubtle },
    label: { color: c.primary },
  },
  danger: {
    rest: { backgroundColor: c.danger },
    pressed: { backgroundColor: c.dangerPressed },
    label: { color: c.textOnPrimary },
  },
  // `secondary`'s outline in the danger colour: an emergency action that must
  // be seen without outweighing the primary beside it (the report safety
  // sheet's "Call 999").
  dangerOutline: {
    rest: { borderWidth: 1, borderColor: c.danger },
    pressed: { borderWidth: 1, borderColor: c.danger, backgroundColor: c.surfaceSubtle },
    label: { color: c.danger },
  },
  // The page's only non-CTA block button (the "show all/more" pattern):
  // quiet grey fill, ink label — never competes with a primary action.
  subtle: {
    rest: { backgroundColor: c.surfaceSubtle },
    pressed: { backgroundColor: c.surfaceSubtlePressed },
    label: { color: c.textPrimary },
  },
});

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = true,
  icon,
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps) {
  const variantStyle = useThemedStyles(makeVariantStyles)[variant];
  // Loading blocks presses like disabled, but reads as "busy" not "unavailable"
  // to assistive tech, and keeps the full-opacity fill (a spinner, not a mute).
  const blocked = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
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
      <View style={[styles.content, loading && styles.hiddenLabel]}>
        {icon ? (
          <Feather
            name={icon}
            size={sizes.iconSm}
            color={variantStyle.label.color}
            accessible={false}
            importantForAccessibility="no"
          />
        ) : null}
        <Text style={[styles.label, variantStyle.label]}>{label}</Text>
      </View>
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
  // The label, with the icon before it when there is one.
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  // flexShrink: beside an icon, a long label at large text wraps rather than
  // running out of the button.
  label: {
    ...typography.label,
    flexShrink: 1,
    // A wrapped label (large text) centres like the box it's in.
    textAlign: 'center',
  },
  hiddenLabel: {
    opacity: 0,
  },
});
