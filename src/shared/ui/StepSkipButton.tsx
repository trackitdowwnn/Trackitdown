/**
 * WHAT:  StepSkipButton — the centred, underlined text action that advances a
 *        wizard step without filling in its main input ("None to add", "Skip
 *        for now").
 * WHY:   A step can be OPTIONAL for submission and still have a schema that
 *        gates its own Next (that is what `WizardStep.optional` means). Without
 *        a skip affordance such a step is a DEAD END: the user has nothing to
 *        enter, Next stays disabled, and the only way out is abandoning the
 *        flow. Every optional step therefore needs one of these, and they must
 *        look identical — so it lives here rather than as a private helper in
 *        one feature (it was, until the garage needed the same thing).
 *
 *        Wired to the framework's `onSkip`, which is a plain forward move and
 *        returns to review on an edit spur, exactly like Next.
 * LINKS: src/shared/wizard/types.ts (WizardStepProps.onSkip, WizardStep.optional);
 *        src/features/vehicles/post/components/postSteps.tsx (distinctive
 *          features — "None to add");
 *        src/features/garage/components/garageSteps.tsx (plate, nickname).
 *
 * Usage:
 *   <StepSkipButton label="I don't have it to hand" onPress={onSkip} />
 */

import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, opacity, sizes, spacing, typography } from '../theme';

export interface StepSkipButtonProps {
  /** What skipping means, in the user's terms — never a bare "Skip". */
  label: string;
  onPress: () => void;
  testID?: string;
}

export function StepSkipButton({ label, onPress, testID }: StepSkipButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={spacing.sm}
      onPress={onPress}
      style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
      testID={testID}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    alignSelf: 'center',
    justifyContent: 'center',
    // Full target: this is the only way out of an optional step.
    minHeight: sizes.touchTarget,
    marginTop: spacing.lg,
  },
  linkPressed: {
    opacity: opacity.pressed,
  },
  label: {
    ...typography.label,
    color: colors.primary,
    textDecorationLine: 'underline',
  },
});
