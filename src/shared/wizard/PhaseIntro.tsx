/**
 * WHAT:  Full-screen phase intro — large phase number, big headline, one
 *        supporting sentence, and an optional illustration slot, shown
 *        before each phase's first step.
 * WHY:   The Airbnb pattern: a breather that tells the user what the next
 *        chunk of work is before asking for anything, which makes long flows
 *        feel structured instead of endless. Counts toward the progress bar.
 * LINKS: src/shared/wizard/types.ts (WizardPhaseIntro config);
 *        docs/DESIGN_SYSTEM.md (Typography display scale, tone of voice).
 */

import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../theme';
import type { WizardPhaseIntro } from './types';

export interface PhaseIntroProps {
  /** 1-based phase position, e.g. 1 → "Step 1". */
  phaseNumber: number;
  intro: WizardPhaseIntro;
}

export function PhaseIntro({ phaseNumber, intro }: PhaseIntroProps) {
  return (
    <View style={styles.container}>
      {intro.illustration ? (
        <View style={styles.illustration}>{intro.illustration}</View>
      ) : null}
      <Text style={styles.phaseNumber}>Step {phaseNumber}</Text>
      <Text accessibilityRole="header" style={styles.headline}>
        {intro.headline}
      </Text>
      <Text style={styles.body}>{intro.body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.lg,
  },
  illustration: {
    marginBottom: spacing.xl,
  },
  phaseNumber: {
    ...typography.title,
    color: colors.primary,
  },
  headline: {
    ...typography.display,
    color: colors.textPrimary,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
