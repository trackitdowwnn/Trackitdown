/**
 * WHAT:  The report screen's "Finish your draft?" stage: the draft listing's
 *        car, then Continue draft (opens it, to edit and pay) and Start a new
 *        one (carries on to the usual report).
 * WHY:   Device check, 2026-10-29: + started a new report from nothing while
 *        a listing sat unfinished at the payment step, and never said so. The
 *        owner chose to be asked, with both ways forward; nothing is deleted
 *        either way. Minimal copy (owner preference): a question, the car,
 *        two buttons.
 * LINKS: ../screens/StartReportScreen.tsx (decides when it shows);
 *        src/features/vehicles/lib/serverDraft.ts (where the draft comes from).
 */

import { StyleSheet, Text, View } from 'react-native';

import { spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { Button, Screen } from '@/shared/ui';

import { ReportHeader } from './ReportHeader';

export interface FinishDraftStageProps {
  /** "Ford Fiesta · Blue". */
  carLabel: string;
  onContinue: () => void;
  onStartNew: () => void;
  onBack: () => void;
}

export function FinishDraftStage({ carLabel, onContinue, onStartNew, onBack }: FinishDraftStageProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Screen>
      <ReportHeader onBack={onBack} />
      <View style={styles.body}>
        <Text accessibilityRole="header" style={styles.title}>
          Finish your draft?
        </Text>
        <Text style={styles.car}>{carLabel}</Text>
        <View style={styles.actions}>
          <Button label="Continue draft" onPress={onContinue} />
          <Button label="Start a new one" variant="secondary" onPress={onStartNew} />
        </View>
      </View>
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    body: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
      gap: spacing.md,
    },
    title: {
      ...typography.heading,
      color: c.textPrimary,
    },
    car: {
      ...typography.body,
      color: c.textSecondary,
    },
    actions: {
      marginTop: spacing.lg,
      gap: spacing.md,
    },
  });
