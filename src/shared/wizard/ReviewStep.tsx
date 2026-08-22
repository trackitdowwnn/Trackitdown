/**
 * WHAT:  The wizard's built-in review screen — an optional preview of the thing
 *        being made, then every answer grouped by phase with an Edit link that
 *        jumps back to its step, then an optional footer for what it costs.
 * WHY:   Airbnb-style flows end with "check your answers before you commit";
 *        the framework owns it so every flow gets the same review-edit-return
 *        loop (completing an edited step returns here, handled by the
 *        navigation reducer) without rebuilding it per flow.
 *
 *        The two SLOTS exist because a list of label/value rows can only ever
 *        describe what someone typed, and `reviewValue` returns a string —
 *        which is why a seven-photo listing read "Photos — 5 added". A flow
 *        that has something to show (a cover photo) or something to charge
 *        passes an element; every other flow passes neither and renders exactly
 *        as before.
 *
 *        RHYTHM (2026-08-22): rows were 8pt-padded around a text block in an
 *        app whose sections breathe at 24/32, so the last screen before a card
 *        charge read as a dense settings list. Each group now opens with a
 *        hairline and PostDetailBody's rhythm below it (32 to the title, 16 to
 *        the rows), and the Edit control carries the app's 44pt minimum as a
 *        real box rather than hitSlop alone — which grew the target vertically
 *        but left it exactly as wide as the word "Edit". Rows are therefore
 *        >= 60pt without needing padding to get there.
 *
 *        ⚠️ The 32 is the GROUP's padding, not the container gap: the gap sits
 *        above the hairline, so a rule with 24 over it and 8 under it is not a
 *        section opener, it is a stray line.
 *
 *        It also SAYS what is blocking submit. The final CTA re-checks every
 *        step in the flow and disables — right, but it was silent, and the
 *        commonest cause is invisible from here: changing the make clears the
 *        model, so the row that broke is not the row they touched.
 * LINKS: src/shared/wizard/navigation.ts (reviewGroups, stepFlatIndex, editStep
 *        return behaviour); docs/DESIGN_SYSTEM.md.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';

import { opacity, sizes, spacing, typography, useThemedStyles, type Palette } from '../theme';
import { invalidStepIds, resolveQuestion, reviewGroups, stepFlatIndex } from './navigation';
import type { WizardFlow } from './types';

export interface ReviewStepProps<TAnswers> {
  flow: WizardFlow<TAnswers>;
  answers: Partial<TAnswers>;
  /** Jump to a step (flat screen index) to edit it. */
  onEdit: (flatIndex: number) => void;
}

export function ReviewStep<TAnswers>({ flow, answers, onEdit }: ReviewStepProps<TAnswers>) {
  const styles = useThemedStyles(makeStyles);
  // Answers are a dependency now: `when` + `hideReviewWhenSkipped` decide which
  // rows belong, and both read them.
  const groups = useMemo(() => reviewGroups(flow, answers), [flow, answers]);

  // By id, so a flow never has to know its own index arithmetic. A LIST is
  // ordered candidates — the first that exists wins — because a composed flow
  // may drop the obvious target: the prefilled post flow omits the photos step
  // entirely when the saved car already has enough, so a preview hard-wired to
  // `photos` would render an Edit control that silently did nothing. An id that
  // matches nothing no-ops rather than jumping somewhere arbitrary.
  const editById = useCallback(
    (stepId: string | string[]) => {
      for (const candidate of Array.isArray(stepId) ? stepId : [stepId]) {
        const index = stepFlatIndex(flow, candidate);
        if (index !== null) {
          onEdit(index);
          return;
        }
      }
    },
    [flow, onEdit],
  );

  // What the final CTA is refusing on. It gates the whole flow's schemas and
  // simply disables — correct, but silent: a dozen rows, a greyed-out button,
  // and nothing saying which. Naming it is the difference between a screen you
  // can finish and a dead end.
  const blocking = useMemo(() => new Set(invalidStepIds(flow, answers)), [flow, answers]);

  const blockingCount = blocking.size;
  const blockingNotice =
    blockingCount === 0
      ? null
      : blockingCount === 1
        ? 'One answer still needs your attention before you can finish.'
        : `${blockingCount} answers still need your attention before you can finish.`;

  // accessibilityLiveRegion covers Android; iOS VoiceOver ignores live regions,
  // so the announcement is carried explicitly — the same pair WizardScreen uses
  // for its submit error.
  useEffect(() => {
    if (blockingNotice) {
      AccessibilityInfo.announceForAccessibility(blockingNotice);
    }
  }, [blockingNotice]);

  const header = flow.review?.header?.(answers, editById);
  const footer = flow.review?.footer?.(answers);

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {flow.review?.title ?? 'Check your answers'}
      </Text>

      {header}

      {/* BELOW the header, not above it: the preview is a 4:5 hero, roughly a
          viewport tall, and a notice pointing at "the rows below" from above it
          is a scroll away from everything it means. */}
      {blockingNotice ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.blockingNotice}
        >
          {blockingNotice}
        </Text>
      ) : null}

      {groups.map((group) => (
        <View key={group.phaseIndex} style={styles.group}>
          <Text accessibilityRole="header" style={styles.groupTitle}>
            {group.title}
          </Text>
          {group.items.map(({ step, flatIndex }, rowIndex) => {
            const label = step.reviewLabel ?? resolveQuestion(step.question, answers);
            // The last row draws NO rule: the next group opens with its own
            // hairline, and the two together drew a pair 24pt apart with
            // nothing between them — an accidental double rule.
            const lastRow = rowIndex === group.items.length - 1;
            return (
              <View key={step.id} style={[styles.item, lastRow ? null : styles.itemRuled]}>
                <View style={styles.itemText}>
                  <Text style={styles.itemLabel}>{label}</Text>
                  <Text style={styles.itemValue}>{step.reviewValue?.(answers) || '—'}</Text>
                  {/* The value STAYS. The gate fails on too-few as well as
                      none — photos at 2 of 3, a bounty under the floor — and
                      replacing "2 added" with "needs an answer" both lies and
                      hides the thing they need to see to fix it. */}
                  {blocking.has(step.id) ? (
                    <Text style={styles.itemNeeded}>Needs another look</Text>
                  ) : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${label}`}
                  hitSlop={spacing.sm}
                  onPress={() => onEdit(flatIndex)}
                  style={({ pressed }) => [styles.edit, pressed ? styles.editPressed : null]}
                >
                  <Text style={styles.editLink}>Edit</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}

      {footer}
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
    // PostDetailBody's section rhythm: divider → 32 → title → 16 → content.
    // The 32 has to be the group's OWN padding — the container's 24pt gap sits
    // above the hairline, not below it, so leaning on it (as this did) left the
    // title 8pt under the rule and the "~32" claim simply untrue.
    group: {
      gap: spacing.lg,
      paddingTop: spacing.xxl,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    groupTitle: {
      ...typography.heading,
      color: c.textPrimary,
    },
    // The row is already >= 44 from its Edit control, so the padding is breathing
    // room on top of a guaranteed target, not the target itself.
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.lg,
      paddingVertical: spacing.sm,
    },
    itemRuled: {
      borderBottomWidth: StyleSheet.hairlineWidth,
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
    // Danger is the app's one red and belongs on exactly this: something the
    // person must act on before the flow will let them pay.
    itemNeeded: {
      ...typography.body,
      color: c.danger,
    },
    blockingNotice: {
      ...typography.caption,
      color: c.danger,
    },
    // The app's 44pt minimum, as a real box rather than hitSlop alone: hitSlop
    // grew the target vertically but left it exactly as wide as the word.
    edit: {
      minHeight: sizes.touchTarget,
      minWidth: sizes.touchTarget,
      alignItems: 'flex-end',
      justifyContent: 'center',
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
