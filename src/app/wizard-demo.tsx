/**
 * WHAT:  Dev-only demo of the wizard framework — a fake 2-phase flow (About
 *        you → Preferences → review) to feel the whole experience in Expo
 *        Go: phase intros, validation gating, back navigation, the
 *        review-edit-return loop, and the dirty-exit confirmation.
 * WHY:   The framework is shared infrastructure with no user-facing flow
 *        yet; this route is its playground until the posting stepper
 *        consumes it. Like sandbox.tsx it is a dev screen — remove or gate
 *        before launch. (Sandbox precedent: dev screens keep their demo
 *        content in the route file.)
 * LINKS: src/shared/wizard (the framework under demo); src/app/sandbox.tsx
 *        (entry link).
 */

import { useRouter } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import { TextField } from '@/shared/ui';
import { WizardScreen, type WizardFlow, type WizardStepProps } from '@/shared/wizard';

interface DemoAnswers {
  name: string;
  colour: string;
  contact: string;
}

const COLOURS = ['Sage', 'Terracotta', 'Sand', 'Sky'];
const CONTACT_OPTIONS = ['Email', 'Push', 'No updates'];

function NameStep({ answers, setAnswers }: WizardStepProps<DemoAnswers>) {
  return (
    <TextField
      label="Full name"
      placeholder="Jane Smith"
      value={answers.name ?? ''}
      onChangeText={(name) => setAnswers({ name })}
    />
  );
}

function ColourStep({ answers, setAnswers }: WizardStepProps<DemoAnswers>) {
  return (
    <ChoiceChips
      options={COLOURS}
      value={answers.colour}
      onSelect={(colour) => setAnswers({ colour })}
    />
  );
}

function ContactStep({ answers, setAnswers }: WizardStepProps<DemoAnswers>) {
  return (
    <ChoiceChips
      options={CONTACT_OPTIONS}
      value={answers.contact}
      onSelect={(contact) => setAnswers({ contact })}
    />
  );
}

const demoFlow: WizardFlow<DemoAnswers> = {
  id: 'wizard-demo',
  finalCtaLabel: 'Submit answers',
  review: {},
  phases: [
    {
      id: 'about-you',
      title: 'About you',
      intro: {
        headline: 'Tell us about you',
        body: 'Two quick questions so we can say hello properly.',
      },
      steps: [
        {
          id: 'name',
          question: "What's your name?",
          helper: 'As you’d like us to greet you.',
          component: NameStep,
          schema: z.object({ name: z.string().trim().min(1) }),
          reviewLabel: 'Name',
          reviewValue: (answers) => answers.name ?? '',
        },
        {
          id: 'colour',
          question: 'Pick a favourite colour',
          component: ColourStep,
          schema: z.object({ colour: z.string().min(1) }),
          reviewLabel: 'Favourite colour',
          reviewValue: (answers) => answers.colour ?? '',
        },
      ],
    },
    {
      id: 'preferences',
      title: 'Preferences',
      intro: {
        headline: 'Your preferences',
        body: 'One more thing — how should we keep in touch?',
      },
      steps: [
        {
          id: 'contact',
          question: 'How should we contact you?',
          component: ContactStep,
          schema: z.object({ contact: z.string().min(1) }),
          reviewLabel: 'Contact preference',
          reviewValue: (answers) => answers.contact ?? '',
        },
      ],
    },
  ],
};

export default function WizardDemoScreen() {
  const router = useRouter();

  return (
    <WizardScreen
      flow={demoFlow}
      onExit={() => router.back()}
      onComplete={(answers) => {
        Alert.alert('Flow complete', JSON.stringify(answers, null, 2), [
          { text: 'Nice', onPress: () => router.back() },
        ]);
      }}
    />
  );
}

/** Single-select chips — demo-local; promote to shared/ui when a real flow needs it. */
function ChoiceChips({
  options,
  value,
  onSelect,
}: {
  options: string[];
  value: string | undefined;
  onSelect: (option: string) => void;
}) {
  return (
    <View style={styles.chips} accessibilityRole="radiogroup">
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityLabel={option}
            accessibilityState={{ checked: selected }}
            onPress={() => onSelect(option)}
            style={[styles.chip, selected && styles.chipSelected]}
          >
            <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: sizes.touchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: {
    backgroundColor: colors.primary,
  },
  chipLabel: {
    ...typography.label,
    color: colors.textPrimary,
  },
  chipLabelSelected: {
    color: colors.textOnPrimary,
  },
});
