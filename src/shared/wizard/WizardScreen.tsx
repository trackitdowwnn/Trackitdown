/**
 * WHAT:  The wizard's container screen — assembles the header row (exit X
 *        left, bubble-stepper progress + label right), the current screen's
 *        content (phase intro / step / review) with horizontal slide
 *        transitions, and the fixed keyboard-aware Back/Next footer. This is
 *        the one component a route renders to run a flow.
 * WHY:   Consuming flows supply config and two callbacks (onExit,
 *        onComplete); everything Airbnb-ish — one question per screen,
 *        display typography, slides reversed on Back, step announcements for
 *        screen readers, footer never covered by the keyboard — lives here
 *        once. Keyboard handling is split by platform: iOS uses
 *        KeyboardAvoidingView padding; Android is edge-to-edge (the window
 *        never resizes) so the footer lifts by the measured keyboard height
 *        (useAndroidKeyboardHeight).
 * LINKS: src/shared/wizard/README.md; src/shared/wizard/useWizardController.ts;
 *        docs/DESIGN_SYSTEM.md (Motion, Accessibility, Forms).
 */

import { useEffect, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  ReduceMotion,
  SlideInLeft,
  SlideInRight,
  SlideOutLeft,
  SlideOutRight,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAndroidKeyboardHeight } from '../hooks';
import { spacing, typography, useThemedStyles, type Palette } from '../theme';
import { easeOut } from '@/shared/theme/motionEasing';
import { invalidStepIds, resolveQuestion } from './navigation';
import { PhaseIntro } from './PhaseIntro';
import { blockingNotice, ReviewStep } from './ReviewStep';
import { WizardFooter } from './WizardFooter';
import { WizardHeader } from './WizardHeader';
import { WizardProgressBar } from './WizardProgressBar';
import type { WizardFlow } from './types';
import { useWizardController } from './useWizardController';

/** Step transitions: 250ms ease-out per the design system's motion rules. */
const SLIDE_MS = 250;
const slideEasing = easeOut;

/**
 * Past this text scale a fills step gives up filling and scrolls instead.
 *
 * A fills step has no scroll rescue by design, which is fine while the headline
 * is one or two lines. At large accessibility text sizes the headline grows,
 * the map refuses to shrink past its minHeight and a slider below it has
 * nowhere to go — so content runs off a container that cannot scroll. Falling
 * back costs a big-text user the full-bleed map and gives them a reachable
 * screen, which is the right trade (DESIGN_SYSTEM.md, dynamic type).
 */
const FILLS_MAX_FONT_SCALE = 1.3;

/**
 * The step body's container. Scrolls by default; a `fills` step gets a plain
 * flex View so a flex:1 child can occupy the space down to the footer.
 *
 * Extracted rather than inlined so the children are written ONCE — a ternary
 * around two containers would duplicate the whole step body and let the two
 * copies drift.
 */
function StepContainer({ fills, children }: { fills: boolean; children: ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  // `?? 1` because fontScale is absent in some environments (jest's mock);
  // an unknown scale must not silently cost every fills step its layout.
  const { fontScale } = useWindowDimensions();
  if (fills && (fontScale ?? 1) <= FILLS_MAX_FONT_SCALE) {
    // testID: which container a step got is the whole difference between a map
    // that fills and one that silently sits at its minHeight, and it is
    // invisible to every other assertion.
    return (
      <View testID="wizard-step-fills" style={[styles.content, styles.fillsContent]}>
        {children}
      </View>
    );
  }
  return (
    <ScrollView
      testID="wizard-step-scroll"
      contentContainerStyle={[styles.content, styles.scrollContent]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export interface WizardScreenProps<TAnswers> {
  flow: WizardFlow<TAnswers>;
  /** Leave the flow (X with dirty-confirm). Usually router.back(). */
  onExit: () => void;
  /**
   * The final screen's submit. May be async: while it runs the primary button
   * spins; on rejection the wizard stays intact and the error is shown for
   * retry; on success onComplete routes away (the flow does not auto-navigate).
   */
  onComplete: (answers: Partial<TAnswers>) => void | Promise<void>;
  /**
   * Offer "Save & exit" on the leave prompt, and persist with this (review
   * #19). Omit it and the prompt stays the two-way discard it has always been —
   * which is right for the short flows, where a draft would be more machinery
   * than the thing it saves.
   */
  onSaveAndExit?: (answers: Partial<TAnswers>) => void | Promise<void>;
  /** Pre-filled answers (sensible defaults, or a saved draft). */
  initialAnswers?: Partial<TAnswers>;
}

export function WizardScreen<TAnswers>({
  flow,
  onExit,
  onComplete,
  onSaveAndExit,
  initialAnswers,
}: WizardScreenProps<TAnswers>) {
  const styles = useThemedStyles(makeStyles);
  const controller = useWizardController(flow, { onExit, onComplete, onSaveAndExit, initialAnswers });
  const {
    screen,
    screenIndex,
    answers,
    direction,
    busy,
    error,
  } = controller;
  const keyboardHeight = useAndroidKeyboardHeight();
  const isFillsStep = screen.kind === 'step' && screen.step.fills === true;

  // Android system back mirrors in-flow Back (previous screen — even on
  // intros, where the visible button is hidden, because blocking the system
  // gesture would feel broken); on the first screen it becomes the exit,
  // which keeps the dirty-answers confirmation unbypassable.
  const { isFirstScreen, back, requestExit } = controller;
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // Swallow the gesture while an async action is in flight so a submit or
      // lookup can't be navigated out from under.
      if (busy) return true;
      if (isFirstScreen) {
        requestExit();
      } else {
        back();
      }
      return true;
    });
    return () => subscription.remove();
  }, [isFirstScreen, back, requestExit, busy]);

  // What a screen-reader user hears on landing here. A dynamic question reads
  // the answers, but this is a plain string, so the announce effect below fires
  // only when the TEXT changes (a move) — not on every keystroke that mutates
  // `answers` while the wording stays put.
  //
  // The review branch reads `answers` too (through invalidStepIds), so its text
  // CAN change without a move — by design: that is how a fixed answer stops
  // being announced as blocking. It still cannot fire per keystroke, because
  // the review screen has no inputs.
  const announcement =
    screen.kind === 'intro'
      ? // Intro descriptors only exist for phases that declare an intro.
        (flow.phases[screen.phaseIndex].intro?.headline ?? '')
      : screen.kind === 'step'
        ? resolveQuestion(screen.step.question, answers)
        : // The review's landing announcement carries the blocking notice with
          // it, as ONE utterance. Announced separately it fired in the same
          // commit as this one (React flushes child effects before parents) and
          // iOS VoiceOver cut the title off; a live region on that Text made
          // TalkBack say it twice as well. The notice carries no region now —
          // this call is what covers Android, on mount and on change alike.
          // Folding it in also means a changed count changes this STRING, so it
          // re-announces on both platforms — which the separate call never did
          // on iOS.
          [
            flow.review?.title ?? 'Check your answers',
            blockingNotice(invalidStepIds(flow, answers).length),
          ]
            .filter(Boolean)
            .join('. ');
  // Tell screen-reader users what screen they landed on after each move.
  // INVARIANT: adjacent screens must have DISTINCT text — a move to a screen
  // whose text equals the previous one won't re-announce (dep is the string).
  // Holds today (every question/headline/review title differs); keep it so.
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(announcement);
  }, [announcement]);

  // Announce async-action errors too. accessibilityLiveRegion (on the error
  // Text below) covers Android; announceForAccessibility carries it to iOS
  // VoiceOver, which ignores live regions.
  useEffect(() => {
    if (error) {
      AccessibilityInfo.announceForAccessibility(error);
    }
  }, [error]);

  // Progress geometry: one dot per phase, plus a final dot for the review
  // screen when the flow opts in. The label names the dot the bubble is on.
  const dotCount = flow.phases.length + (flow.review ? 1 : 0);
  const activeDot = screen.kind === 'review' ? dotCount - 1 : screen.phaseIndex;
  // "of phases.length", not dotCount: counting the review dot would tell
  // screen-reader users there are more question phases than exist.
  const progressLabel =
    screen.kind === 'review'
      ? 'Review'
      : `Step ${screen.phaseIndex + 1} of ${flow.phases.length}`;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          {/* Disabled during the SUBMIT only — the exact case requestExit
              refuses, read from the controller so the two cannot drift. During
              a step's onContinue lookup the X stays live, because on iOS it is
              the only way out of a stalled one. */}
          <WizardHeader
            onExit={controller.requestExit}
            disabled={busy && controller.isLastScreen}
          />
          <View style={styles.headerProgress}>
            <WizardProgressBar
              fills={controller.progress}
              activeIndex={activeDot}
              dotCount={dotCount}
              label={progressLabel}
            />
          </View>
        </View>

        {/* NO SLIDE ON A FILLS STEP.
            Two reasons, one cosmetic and one a real bug. A full-bleed map is
            the screen, so sliding it reads as the whole app moving rather than
            as one answer replacing another. And more importantly: a fills step
            can swap its subtree after mount (the map waits for its opening
            centre before it renders), which strands the entering transform
            part-way — the step then sits permanently offset to the right, with
            the footer, which lives outside this wrapper, staying put. */}
        <Animated.View
          key={screenIndex}
          testID="wizard-step-slide"
          style={styles.flex}
          entering={
            isFillsStep
              ? undefined
              : (direction === 1 ? SlideInRight : SlideInLeft)
                  .duration(SLIDE_MS)
                  .easing(slideEasing)
                  .reduceMotion(ReduceMotion.System)
          }
          exiting={
            isFillsStep
              ? undefined
              : (direction === 1 ? SlideOutLeft : SlideOutRight)
                  .duration(SLIDE_MS)
                  .easing(slideEasing)
                  .reduceMotion(ReduceMotion.System)
          }
        >
          {screen.kind === 'intro' ? (
            <View style={[styles.content, styles.introContent]}>
              <PhaseIntro
                phaseNumber={screen.phaseIndex + 1}
                // Non-null: flattenFlow only emits intro descriptors for
                // phases that declare an intro.
                intro={flow.phases[screen.phaseIndex].intro!}
              />
            </View>
          ) : (
            // A `fills` step swaps the ScrollView for a plain flex View, so a
            // flex:1 body (a map) can reach the footer. Everything inside is
            // identical — only the container changes.
            <StepContainer fills={isFillsStep}>
              {screen.kind === 'step' ? (
                <>
                  <Text
                    accessibilityRole="header"
                    style={[
                      styles.question,
                      isFillsStep && styles.questionFills,
                    ]}
                  >
                    {resolveQuestion(screen.step.question, answers)}
                  </Text>
                  {screen.step.helper ? (
                    <Text style={styles.helper}>{screen.step.helper}</Text>
                  ) : null}
                  <View style={[styles.stepBody, isFillsStep && styles.stepBodyFills]}>
                    <screen.step.component
                      answers={answers}
                      setAnswers={controller.setAnswers}
                      // A step's own Skip affordance advances without the Next
                      // gate/action (returns to review on an edit spur).
                      onSkip={controller.next}
                    />
                  </View>
                </>
              ) : (
                <ReviewStep
                  flow={flow}
                  answers={answers}
                  onEdit={controller.editStep}
                  busy={busy}
                />
              )}
            </StepContainer>
          )}
        </Animated.View>

        <View style={[styles.footer, { paddingBottom: spacing.sm + keyboardHeight }]}>
          {error ? (
            <Text accessibilityLiveRegion="polite" style={styles.error}>
              {error}
            </Text>
          ) : null}
          <WizardFooter
            ctaLabel={controller.ctaLabel}
            canProceed={controller.canGoNext}
            loading={busy}
            // No Back while busy — can't abandon an in-flight lookup/submit.
            showBack={!controller.isFirstScreen && screen.kind !== 'intro' && !busy}
            onBack={controller.back}
            onNext={controller.advance}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: c.background,
    },
    flex: {
      flex: 1,
    },
    // md, not xl: the 44pt exit target has ~13px of internal padding around its
    // glyph, so md lands the glyph optically on the content's 24px edge.
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    // Progress sits top-right beside the X; the extra right padding lands its
    // end on the content's 24px edge (header pad 12 + 12 = 24).
    headerProgress: {
      flex: 1,
      paddingRight: spacing.md,
    },
    content: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
    },
    introContent: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      paddingBottom: spacing.xl,
    },
    // The non-scrolling variant. flex (not flexGrow) so the container is BOUNDED
    // by the space between header and footer — that bound is what a flex:1 step
    // body measures itself against.
    fillsContent: {
      flex: 1,
      // sm, not the scroll variant's xl: the footer below already carries its own
      // padding, so anything more is a second gap stacked on the first — and on a
      // fills step that gap is taken straight off the map.
      paddingBottom: spacing.sm,
    },
    question: {
      ...typography.display,
      color: c.textPrimary,
    },
    // One step down the scale (32 -> 24) on a fills step. Display type earns its
    // size when the question IS the screen; when a map is the screen, the
    // headline's job is to label it, and every point of line-height above that
    // is map the user does not get.
    // Self-contained, not a partial override of `question`: it only happens to
    // work today because `title` replaces all three of `display`'s properties.
    questionFills: {
      ...typography.title,
      color: c.textPrimary,
    },
    helper: {
      ...typography.body,
      color: c.textSecondary,
      marginTop: spacing.md,
    },
    stepBody: {
      marginTop: spacing.xxl,
    },
    // On a fills step the body takes the remaining height, and the headline gets
    // a tighter gap — on a map step that margin is pure lost map.
    stepBodyFills: {
      flex: 1,
      marginTop: spacing.lg,
    },
    footer: {
      paddingHorizontal: spacing.xl,
    },
    // Sits just above the footer buttons; danger-toned, announced politely so a
    // failed lookup/submit is read out without stealing focus.
    error: {
      ...typography.caption,
      color: c.danger,
      marginBottom: spacing.sm,
    },
  });
