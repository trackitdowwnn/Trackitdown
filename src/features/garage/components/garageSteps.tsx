/**
 * WHAT:  The two GARAGE-ONLY wizard steps — the number plate and the optional
 *        nickname. Everything else in the add-a-car flow is the shared
 *        vehicle-identity slice from features/vehicles.
 * WHY:   Posting dropped plate capture on 2026-07-24, but a saved car wants one:
 *        it is the natural key for "is this car currently reported stolen?", and
 *        supplying it at posting time re-arms create_post's one-active-post-per-
 *        plate guard, which is dormant today because every post is plate-less.
 *        Both steps are OPTIONAL — a plate the owner doesn't have (or a car with
 *        no pet name) must never block saving.
 * LINKS: src/features/garage/lib/addVehicleFlow.tsx (the flow that uses these);
 *        src/features/vehicles/post/lib/vehicleSteps.tsx (the shared seven);
 *        src/shared/ui/TextField.tsx (the `plate` variant — formatting only;
 *          validation is server-side in add_vehicle).
 */

import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/shared/theme';
import { StepSkipButton, TextField } from '@/shared/ui';
import type { WizardStepProps } from '@/shared/wizard';

import type { AddVehicleAnswers } from '../types';

type GarageStepProps = WizardStepProps<AddVehicleAnswers>;

export function PlateStep({ answers, setAnswers, onSkip }: GarageStepProps) {
  return (
    <View style={styles.block}>
      <TextField
        label="Number plate"
        variant="plate"
        placeholder="AB12 CDE"
        value={answers.plate ?? ''}
        onChangeText={(plate) => setAnswers({ plate })}
      />
      {/* Honest about why we want it, and that it is genuinely optional — some
          owners don't have it to hand, and a thief may have swapped it. */}
      <Text style={styles.helper}>
        We use this to spot if your car is already reported stolen. You can add it later.
      </Text>
      {/* Without this the step is a DEAD END: its schema needs a plate to
          unlock Next, so an owner who doesn't have one to hand could not get
          past the FIRST screen of the flow. */}
      {onSkip ? (
        <StepSkipButton
          label="I don't have it to hand"
          onPress={onSkip}
          testID="plate-skip"
        />
      ) : null}
    </View>
  );
}

export function NicknameStep({ answers, setAnswers, onSkip }: GarageStepProps) {
  return (
    <View style={styles.block}>
      <TextField
        label="Nickname"
        placeholder="Mum's Golf"
        value={answers.nickname ?? ''}
        onChangeText={(nickname) => setAnswers({ nickname })}
        maxLength={40}
      />
      <Text style={styles.helper}>
        Just for you — it makes a garage with a few cars easier to scan.
      </Text>
      {/* Same dead end as the plate step — and this one is the LAST screen
          before saving, so without it a car with no pet name can't be saved. */}
      {onSkip ? (
        <StepSkipButton label="No name needed" onPress={onSkip} testID="nickname-skip" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.md,
  },
  helper: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
