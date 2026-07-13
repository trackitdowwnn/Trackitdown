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

import { useEffect } from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  SlideInLeft,
  SlideInRight,
  SlideOutLeft,
  SlideOutRight,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAndroidKeyboardHeight } from '../hooks';
import { colors, spacing, typography } from '../theme';
import { PhaseIntro } from './PhaseIntro';
import { ReviewStep } from './ReviewStep';
import { WizardFooter } from './WizardFooter';
import { WizardHeader } from './WizardHeader';
import { WizardProgressBar } from './WizardProgressBar';
import type { WizardFlow } from './types';
import { useWizardController } from './useWizardController';

/** Step transitions: 250ms ease-out per the design system's motion rules. */
const SLIDE_MS = 250;
const slideEasing = Easing.out(Easing.quad);

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
  /** Pre-filled answers (sensible defaults, or a future saved draft). */
  initialAnswers?: Partial<TAnswers>;
}

export function WizardScreen<TAnswers>({
  flow,
  onExit,
  onComplete,
  initialAnswers,
}: WizardScreenProps<TAnswers>) {
  const controller = useWizardController(flow, { onExit, onComplete, initialAnswers });
  const {
    screen,
    screenIndex,
    answers,
    direction,
    busy,
    error,
  } = controller;
  const keyboardHeight = useAndroidKeyboardHeight();

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

  // Tell screen-reader users what screen they landed on after each move.
  useEffect(() => {
    const announcement =
      screen.kind === 'intro'
        ? flow.phases[screen.phaseIndex].intro.headline
        : screen.kind === 'step'
          ? screen.step.question
          : (flow.review?.title ?? 'Check your answers');
    AccessibilityInfo.announceForAccessibility(announcement);
  }, [flow, screen]);

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
          <WizardHeader onExit={controller.requestExit} />
          <View style={styles.headerProgress}>
            <WizardProgressBar
              fills={controller.progress}
              activeIndex={activeDot}
              dotCount={dotCount}
              label={progressLabel}
            />
          </View>
        </View>

        <Animated.View
          key={screenIndex}
          style={styles.flex}
          entering={(direction === 1 ? SlideInRight : SlideInLeft)
            .duration(SLIDE_MS)
            .easing(slideEasing)
            .reduceMotion(ReduceMotion.System)}
          exiting={(direction === 1 ? SlideOutLeft : SlideOutRight)
            .duration(SLIDE_MS)
            .easing(slideEasing)
            .reduceMotion(ReduceMotion.System)}
        >
          {screen.kind === 'intro' ? (
            <View style={[styles.content, styles.introContent]}>
              <PhaseIntro
                phaseNumber={screen.phaseIndex + 1}
                intro={flow.phases[screen.phaseIndex].intro}
              />
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={[styles.content, styles.scrollContent]}
              keyboardShouldPersistTaps="handled"
            >
              {screen.kind === 'step' ? (
                <>
                  <Text accessibilityRole="header" style={styles.question}>
                    {screen.step.question}
                  </Text>
                  {screen.step.helper ? (
                    <Text style={styles.helper}>{screen.step.helper}</Text>
                  ) : null}
                  <View style={styles.stepBody}>
                    <screen.step.component
                      answers={answers}
                      setAnswers={controller.setAnswers}
                    />
                  </View>
                </>
              ) : (
                <ReviewStep flow={flow} answers={answers} onEdit={controller.editStep} />
              )}
            </ScrollView>
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

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
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
  question: {
    ...typography.display,
    color: colors.textPrimary,
  },
  helper: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  stepBody: {
    marginTop: spacing.xxl,
  },
  footer: {
    paddingHorizontal: spacing.xl,
  },
  // Sits just above the footer buttons; danger-toned, announced politely so a
  // failed lookup/submit is read out without stealing focus.
  error: {
    ...typography.caption,
    color: colors.danger,
    marginBottom: spacing.sm,
  },
});
