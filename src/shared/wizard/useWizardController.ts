/**
 * WHAT:  The wizard's state hook — owns the answers object and navigation
 *        state, and exposes everything the chrome renders: current screen,
 *        gating, CTA label, per-phase progress, slide direction, the dirty-exit
 *        confirmation, and the async primary-button path (`advance`, `busy`,
 *        `error`) that runs a step's onContinue lookup or the final onComplete
 *        submit — advancing on success, staying put with an error on failure.
 * WHY:   A thin React shell over the pure logic in navigation.ts, so screens
 *        and chrome stay dumb. The answers object is a single serializable
 *        value and exits funnel through one place, deliberately: that is the
 *        seam where draft persistence plugs in later.
 * LINKS: src/shared/wizard/navigation.ts; src/shared/wizard/types.ts;
 *        src/shared/wizard/WizardScreen.tsx (consumer).
 */

import { useCallback, useMemo, useReducer, useRef, useState } from 'react';
import { Alert } from 'react-native';

import {
  INITIAL_NAV_STATE,
  canProceed,
  ctaLabel,
  flattenFlow,
  phaseProgress,
  wizardReducer,
} from './navigation';
import type { WizardFlow } from './types';

export interface WizardControllerOptions<TAnswers> {
  /** Called when the user leaves the flow (X, confirmed discard). */
  onExit: () => void;
  /**
   * The final screen's async submit. Runs when the user presses the primary
   * button on the last screen; while it runs the button shows a spinner. On
   * rejection the wizard stays fully intact (answers + position) and the
   * thrown message is surfaced for retry — losing a completed wizard to a
   * network blip is the failure this guards against. On success the flow does
   * NOT navigate: onComplete owns routing away (to the new post / a success
   * screen). A synchronous onComplete works too.
   */
  onComplete?: (answers: Partial<TAnswers>) => void | Promise<void>;
  /** Pre-filled answers (e.g. a future saved draft). */
  initialAnswers?: Partial<TAnswers>;
}

/**
 * Pull a user-facing string out of whatever an async action threw. Steps and
 * submit handlers are expected to throw Errors whose message is already
 * plain-English; anything else falls back to a generic line.
 */
function toErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'Something went wrong. Please try again.';
}

export function useWizardController<TAnswers>(
  flow: WizardFlow<TAnswers>,
  { onExit, onComplete, initialAnswers }: WizardControllerOptions<TAnswers>,
) {
  const screens = useMemo(() => flattenFlow(flow), [flow]);
  const [nav, dispatch] = useReducer(wizardReducer, INITIAL_NAV_STATE);
  const [answers, setAnswersState] = useState<Partial<TAnswers>>(
    initialAnswers ?? {},
  );

  // Async-action state for onContinue lookups and the final submit: `busy`
  // drives the button spinner and blocks a second press; `error` is the last
  // thrown message, shown until the next attempt or any answer edit.
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dirty = the user has changed something since entering. Deleting text
  // again still counts (matches the caution of a discard confirmation).
  const dirtyRef = useRef(false);
  // Answers as they were when a review edit began; backing out of the edit
  // restores this, so "Back" truly cancels instead of leaving a half-edit.
  const editSnapshotRef = useRef<Partial<TAnswers> | null>(null);

  const setAnswers = useCallback((patch: Partial<TAnswers>) => {
    dirtyRef.current = true;
    // Editing the answer clears a stale action error so it doesn't linger over
    // a value the user has since changed.
    setError(null);
    setAnswersState((current) => ({ ...current, ...patch }));
  }, []);

  const next = useCallback(() => {
    // Completing an edit commits it — the snapshot is no longer a fallback.
    editSnapshotRef.current = null;
    dispatch({ type: 'next', screenCount: screens.length });
  }, [screens.length]);
  const back = useCallback(() => {
    setError(null);
    if (editSnapshotRef.current !== null) {
      setAnswersState(editSnapshotRef.current);
      editSnapshotRef.current = null;
    }
    dispatch({ type: 'back' });
  }, []);
  const editStep = useCallback(
    (targetIndex: number) => {
      editSnapshotRef.current = answers;
      dispatch({ type: 'editStep', targetIndex, reviewIndex: nav.index });
    },
    [answers, nav.index],
  );

  // The last screen is the final step (or the review, when the flow has one) —
  // but NOT while editing from review, where the primary button returns to
  // review rather than submitting.
  const isLastScreen =
    nav.returnToIndex === null && nav.index === screens.length - 1;

  /**
   * The single primary-button handler. Routes to the right behaviour for the
   * current screen: run the step's onContinue (merge its patch, then advance),
   * run the final onComplete (submit; stay put on failure, don't navigate on
   * success), or a plain forward move. Serialized by `busy` so a double-tap
   * can't fire two lookups or two submits.
   */
  const advance = useCallback(async () => {
    if (busy) return;
    const screen = screens[nav.index];
    const onContinue = screen.kind === 'step' ? screen.step.onContinue : undefined;
    const hasAction = isLastScreen ? Boolean(onComplete) : Boolean(onContinue);

    if (!hasAction) {
      // Nothing async to do. The final screen with no onComplete no-ops (the
      // flow is expected to supply one); every other screen just moves on.
      if (!isLastScreen) next();
      return;
    }

    setError(null);
    setBusy(true);
    try {
      if (isLastScreen) {
        await onComplete!(answers);
        // Terminal success: onComplete owns routing away. Hold the spinner
        // until the screen unmounts instead of flashing the label back.
        return;
      }
      const result = await onContinue!(answers);
      if (result) {
        setAnswersState((current) => ({ ...current, ...result }));
      }
      setBusy(false);
      next();
    } catch (err) {
      setBusy(false);
      setError(toErrorMessage(err));
    }
  }, [busy, screens, nav.index, isLastScreen, onComplete, answers, next]);

  const requestExit = useCallback(() => {
    if (!dirtyRef.current) {
      onExit();
      return;
    }
    // TODO(draft-persistence): when save & exit lands, offer "Save & exit"
    // here — serialize `answers` and hand it to the flow's persistence layer
    // before calling onExit. Until then, discard is the only exit.
    Alert.alert('Discard your answers?', "You'll lose what you've entered so far.", [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onExit },
    ]);
  }, [onExit]);

  return {
    screens,
    screenIndex: nav.index,
    screen: screens[nav.index],
    /** True while on an edit spur launched from the review screen. */
    isEditingFromReview: nav.returnToIndex !== null,
    answers,
    setAnswers,
    next,
    back,
    editStep,
    /** Primary-button handler: runs onContinue / onComplete, else moves on. */
    advance,
    /** True while an onContinue lookup or the final submit is in flight. */
    busy,
    /** Last async-action error message (null when none); shown for retry. */
    error,
    requestExit,
    canGoNext: canProceed(flow, screens[nav.index], answers),
    isFirstScreen: nav.index === 0,
    ctaLabel: ctaLabel(flow, screens, nav),
    /** Fill fraction (0–1) per phase segment. */
    progress: phaseProgress(flow, nav.index),
    /** +1 sliding forward, -1 sliding back — drives the transition. */
    direction: nav.direction,
  };
}
