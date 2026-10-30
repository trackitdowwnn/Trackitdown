/**
 * WHAT:  PlateStep — the optional number-plate question shared by both car
 *        flows: the field, a format warning that never blocks, and a skip.
 * WHY:   It follows the photos step, which reads the plate from the photos
 *        (PhotosWithPlateScanStep); the flows hide it with `when` once a scanned
 *        plate was confirmed, so it is only asked of people the scan could not
 *        answer. It began as a garage-only step; the owner asked for plates in
 *        the report too (2026-10-30). Each flow says why it wants the plate
 *        through `helper` (the garage does; the report has no helpers).
 * LINKS: ./PhotosWithPlateScanStep.tsx; ../postACarFlow.tsx;
 *        src/features/garage/components/garageSteps.tsx (GaragePlateStep);
 *        src/shared/ui/TextField.tsx (the `plate` variant: formatting only).
 */

import { StyleSheet, Text, View } from 'react-native';

import { isValidPlate, normalisePlate } from '@/shared/lib/plate';
import { spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { StepSkipButton, TextField } from '@/shared/ui';
import type { WizardStepProps } from '@/shared/wizard';

export type PlateStepProps = WizardStepProps<{ plate: string }> & {
  /** One line on why the plate is wanted, under the field. */
  helper?: string;
};

export function PlateStep({ answers, setAnswers, onSkip, helper }: PlateStepProps) {
  const styles = useThemedStyles(makeStyles);
  const typed = answers.plate ?? '';
  const canon = normalisePlate(typed);

  /**
   * ⚠️ A WARNING, NEVER A GATE. Our FORMATS list cannot know every plate a real
   * car carries: personalised, Northern Irish, pre-2001 and imported plates are
   * all legitimate, and a regex that misses one becomes a wall in front of
   * someone whose car has just been stolen. So it catches a typo and gets out
   * of the way. Only once there is enough to judge: two characters is someone
   * mid-type, not someone who is wrong.
   */
  const looksWrong = canon.length >= 4 && !isValidPlate(canon);

  return (
    <View style={styles.block}>
      <TextField
        label="Number plate"
        variant="plate"
        placeholder="AB12 CDE"
        value={typed}
        onChangeText={(plate) => setAnswers({ plate })}
      />
      {looksWrong ? (
        // Phrased as a question, because it may well be right and we are the
        // ones who might be wrong. Nothing is disabled by this.
        <Text style={styles.warning} testID="plate-format-warning">
          That doesn’t look like a UK plate — is it right?
        </Text>
      ) : null}
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
      {/* Without this the step is a DEAD END: its schema needs a plate to
          unlock Next, so an owner without one to hand could not get past it. */}
      {onSkip ? (
        <StepSkipButton label="I don't have it to hand" onPress={onSkip} testID="plate-skip" />
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    block: {
      gap: spacing.md,
    },
    helper: {
      ...typography.caption,
      color: c.textSecondary,
    },
    // `warning`, not `danger`: nothing is wrong yet and nothing is blocked.
    warning: {
      ...typography.caption,
      color: c.warning,
    },
  });
