/**
 * WHAT:  The alert wizard's opening screen: "What should this alert match?" —
 *        three cards (an area, a specific car, a minimum bounty) whose ticks
 *        decide which steps the wizard then asks.
 * WHY:   Without it the wizard asked everyone every question, so a spotter who
 *        only wanted "anything near home" still walked through two criteria
 *        screens to leave them both untouched. Choosing first makes the short
 *        path genuinely short (area → name) and the long path deliberate.
 *
 *        AREA IS A LOCKED CARD, not a hidden one. `alert_zones.point` and
 *        `radius_m` are NOT NULL — DOMAIN.md's call that alerts are always
 *        local, because a spotter cannot act on a car 200 miles away. Showing
 *        it greyed-and-ticked with the reason states the constraint once;
 *        omitting it would leave the user wondering where the location question
 *        came from on the next screen.
 *
 *        ⚠️ This is NOT a wizard step, deliberately — see the header of
 *        ../lib/alertFlow.tsx. The flattened screen list must stay stable for a
 *        run, so what changes it is chosen BEFORE the wizard mounts. It is
 *        styled to match a step (display question, helper, footer button) so
 *        the seam does not show.
 * LINKS: ../lib/alertFlow.tsx (consumes the result);
 *        ../lib/alertMatchers.ts (derives the ticks when editing);
 *        ../screens/AlertWizardScreen.tsx (renders this then the wizard);
 *        src/shared/ui/CardSelectMulti.tsx.
 */

import { Banknote, Car, MapPin } from 'lucide-react-native';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '@/shared/theme';
import { Button, CardSelectMulti, type CardSelectMultiOption } from '@/shared/ui';

import type { AlertMatcher } from '../types';

const OPTIONS: CardSelectMultiOption<AlertMatcher>[] = [
  {
    value: 'area',
    label: 'An area',
    description: "Always on — we only alert you about cars you'd realistically spot.",
    icon: MapPin,
    locked: true,
  },
  {
    value: 'car',
    label: 'A specific car',
    description: 'Make, model, colour or body type.',
    icon: Car,
  },
  {
    value: 'bounty',
    label: 'A minimum bounty',
    description: 'Only higher-value reports, and how recently the car was seen.',
    icon: Banknote,
  },
];

export interface AlertMatcherPickerProps {
  value: AlertMatcher[];
  onChange: (next: AlertMatcher[]) => void;
  onContinue: () => void;
  /** Leaves the flow entirely (the X). */
  onExit: () => void;
  /** Editing an existing alert — the CTA shouldn't promise a fresh start. */
  editing?: boolean;
}

export function AlertMatcherPicker({
  value,
  onChange,
  onContinue,
  onExit,
  editing = false,
}: AlertMatcherPickerProps) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Button variant="ghost" label="Cancel" onPress={onExit} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.question}>
          What should this alert match?
        </Text>
        <Text style={styles.helper}>
          Pick as many as you like. The more you add, the fewer — and more useful — the
          notifications.
        </Text>

        <View style={styles.body}>
          <CardSelectMulti options={OPTIONS} value={value} onChange={onChange} />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button label={editing ? 'Continue' : 'Next'} onPress={onContinue} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // Mirrors WizardScreen's header padding so the exit affordance sits in the
  // same place before and after the wizard mounts.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
    flexGrow: 1,
  },
  question: {
    ...typography.display,
    color: colors.textPrimary,
  },
  helper: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  body: {
    marginTop: spacing.xxl,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
});
