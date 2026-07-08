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

import { colors, radii, sizes, spacing, typography } from '../theme';

export interface WizardHeaderProps {
  onExit: () => void;
}

export function WizardHeader({ onExit }: WizardHeaderProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Exit"
      accessibilityHint="Closes this flow"
      onPress={onExit}
      hitSlop={spacing.sm}
      style={({ pressed }) => [styles.exit, pressed && styles.exitPressed]}
    >
      <Text style={styles.exitGlyph}>✕</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  exit: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  exitPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  exitGlyph: {
    ...typography.heading,
    color: colors.textPrimary,
  },
});
