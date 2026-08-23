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

import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { opacity, sizes, spacing, typography, useThemedStyles, type Palette } from '../theme';
import { invalidStepIds, resolveQuestion, reviewGroups, stepFlatIndex } from './navigation';
import type { WizardFlow } from './types';

/**
 * The sentence shown when the final CTA is refusing, and the one a screen
 * reader hears.
 *
 * ⚠️ Exported and spoken by WIZARDSCREEN, folded into its landing announcement
 * rather than announced from here. Announcing it separately fired in the same
 * commit as the screen title — React flushes child effects before parents — and
 * iOS VoiceOver interrupts an in-flight announcement, so the notice cut off the
 * title at the exact moment it was most needed. A live region on the Text made
 * TalkBack say it twice on top of that; there is none now, because the folded
 * announcement covers Android on mount AND on change.
 *
 * One announcement, built from a string, means it also re-announces on BOTH
 * platforms when the count changes — which the separate call never did on iOS.
 */
export function blockingNotice(count: number): string | null {
  if (count === 0) return null;
  return count === 1
    ? 'One answer still needs your attention before you can finish.'
    : `${count} answers still need your attention before you can finish.`;
}

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

  const notice = blockingNotice(blocking.size);

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
          is a scroll away from everything it means.

          NO accessibilityLiveRegion: WizardScreen's landing announcement already
          carries this sentence, and announceForAccessibility covers both
          platforms on mount AND on change. A region here made TalkBack say it
          twice — the same reason FullscreenLoader and Toast carry the explicit
          call without one. */}
      {notice ? (
        <Text accessibilityRole="alert" style={styles.blockingNotice}>
          {notice}
        </Text>
      ) : null}

      {groups.map((group, groupIndex) => (
        <View
          key={group.phaseIndex}
          style={[
            styles.group,
            // Nothing above it to be parted FROM — the container gap already
            // spaces it off the title. PostDetailBody sets the same precedent
            // with `sectionFirst`. Without this the rule read as an underline
            // of the screen headline, and on the two single-group flows it was
            // the only hairline on the page.
            groupIndex === 0 && !header ? styles.groupFirst : null,
          ]}
        >
          {/* A lone group heading only ever restates the screen: "Check your
              car" over "Your car", "Check your alert" over "Your alert". Phase
              names earn their place by separating phases. */}
          {groups.length > 1 ? (
            <Text accessibilityRole="header" style={styles.groupTitle}>
              {group.title}
            </Text>
          ) : null}
          <View style={styles.items}>
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
    // PostDetailBody's section rhythm, measured: 32 above each divider (the
    // last row's 8pt padding + the container's 24pt gap) and 32 below it. The 32
    // below has to be the group's OWN padding — the container gap sits ABOVE the
    // hairline, so leaning on it left the title 8pt under the rule.
    //
    // Exact between groups. The header→first-group boundary is 24/32, because a
    // preview caption ends that block with no row padding of its own, and
    // title→first row lands at 24 (this gap plus the row's 8). Both read fine;
    // noted so the next reader does not take "32/32 everywhere" literally.
    group: {
      gap: spacing.lg,
      paddingTop: spacing.xxl,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    groupFirst: {
      borderTopWidth: 0,
      paddingTop: 0,
    },
    // ⚠️ NO GAP. The group's 16 is for title→rows; letting it apply BETWEEN
    // rows too put each hairline 8pt under one row and 24pt over the next, so
    // it read as an underline of the row above rather than a separator between
    // two. The rows' own symmetric padding is the rhythm.
    items: {},
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
    // `body`, not `caption`: the sentence explaining why the pay button is
    // dead should not be the smallest type on the page, and it was set smaller
    // than the per-row flag it summarises.
    blockingNotice: {
      ...typography.body,
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
