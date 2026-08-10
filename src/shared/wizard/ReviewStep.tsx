/**
 * WHAT:  The wizard's built-in review screen — every answer grouped by
 *        phase, each with an Edit link that jumps back to its step.
 * WHY:   Airbnb-style flows end with "check your answers before you commit";
 *        the framework owns it so every flow gets the same review-edit-return
 *        loop (completing an edited step returns here, handled by the
 *        navigation reducer) without rebuilding it per flow.
 * LINKS: src/shared/wizard/navigation.ts (reviewGroups, editStep return
 *        behaviour); docs/DESIGN_SYSTEM.md.
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { opacity, spacing, typography, useThemedStyles, type Palette } from '../theme';
import { resolveQuestion, reviewGroups } from './navigation';
import type { WizardFlow } from './types';

export interface ReviewStepProps<TAnswers> {
  flow: WizardFlow<TAnswers>;
  answers: Partial<TAnswers>;
  /** Jump to a step (flat screen index) to edit it. */
  onEdit: (flatIndex: number) => void;
}

export function ReviewStep<TAnswers>({ flow, answers, onEdit }: ReviewStepProps<TAnswers>) {
  const styles = useThemedStyles(makeStyles);
  const groups = useMemo(() => reviewGroups(flow), [flow]);

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {flow.review?.title ?? 'Check your answers'}
      </Text>
      {groups.map((group) => (
        <View key={group.phaseIndex} style={styles.group}>
          <Text accessibilityRole="header" style={styles.groupTitle}>
            {group.title}
          </Text>
          {group.items.map(({ step, flatIndex }) => {
            const label = step.reviewLabel ?? resolveQuestion(step.question, answers);
            return (
              <View key={step.id} style={styles.item}>
                <View style={styles.itemText}>
                  <Text style={styles.itemLabel}>{label}</Text>
                  <Text style={styles.itemValue}>{step.reviewValue?.(answers) || '—'}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${label}`}
                  hitSlop={spacing.lg}
                  onPress={() => onEdit(flatIndex)}
                  style={({ pressed }) => (pressed ? styles.editPressed : undefined)}
                >
                  <Text style={styles.editLink}>Edit</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: {
      gap: spacing.xl,
    },
    title: {
      ...typography.display,
      color: c.textPrimary,
    },
    group: {
      gap: spacing.md,
    },
    groupTitle: {
      ...typography.heading,
      color: c.textPrimary,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.lg,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    itemText: {
      flex: 1,
      gap: spacing.xs,
    },
    itemLabel: {
      ...typography.caption,
      color: c.textSecondary,
    },
    itemValue: {
      ...typography.body,
      color: c.textPrimary,
    },
    // Underlined so it still reads as a tappable control in the monochrome scheme
    // (near-black link text no longer stands out by colour alone).
    editLink: {
      ...typography.label,
      color: c.primary,
      textDecorationLine: 'underline',
    },
    editPressed: {
      opacity: opacity.pressed,
    },
  });
