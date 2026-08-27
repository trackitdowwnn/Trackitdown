/**
 * WHAT:  The wizard's header row — the exit (X) control, present on every
 *        wizard screen, top-left.
 * WHY:   Airbnb-style flows are always escapable from the same place; the
 *        exit funnels through the controller's requestExit so the dirty-
 *        answers confirmation can't be bypassed. 44pt touch target per the
 *        accessibility rules.
 * LINKS: src/shared/wizard/useWizardController.ts (requestExit);
 *        docs/DESIGN_SYSTEM.md (Accessibility).
 */

import { Pressable, StyleSheet, Text } from 'react-native';

import {
  opacity,
  radii,
  sizes,
  spacing,
  typography,
  useThemedStyles,
  type Palette,
} from '../theme';

export interface WizardHeaderProps {
  onExit: () => void;
  /**
   * True while the final submit is in flight, when `requestExit` refuses (see
   * useWizardController) so a discard cannot pop a screen the success handler
   * is about to pop again.
   *
   * ⚠️ THE REFUSAL HAS TO BE VISIBLE. Guarded in the controller alone, the X
   * still rendered at full strength, still flashed its pressed state on touch,
   * and still announced "Exit, button, Closes this flow" — a control that
   * looks, feels and reads as live while doing nothing at all. Same rule the
   * review screen's Edit links follow.
   */
  disabled?: boolean;
}

export function WizardHeader({ onExit, disabled = false }: WizardHeaderProps) {
  const styles = useThemedStyles(makeStyles);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Exit"
      accessibilityHint="Closes this flow"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onExit}
      hitSlop={spacing.sm}
      style={({ pressed }) => [
        styles.exit,
        pressed && styles.exitPressed,
        disabled && styles.exitDisabled,
      ]}
    >
      <Text style={styles.exitGlyph}>✕</Text>
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    exit: {
      width: sizes.touchTarget,
      height: sizes.touchTarget,
      borderRadius: radii.md,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'flex-start',
    },
    exitPressed: {
      backgroundColor: c.surfaceSubtle,
    },
    exitDisabled: {
      opacity: opacity.disabled,
    },
    exitGlyph: {
      ...typography.heading,
      color: c.textPrimary,
    },
  });
