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

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
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
   * Persist the answers so far, then leave (review #19).
   *
   * ⚠️ OPTIONAL, AND ITS ABSENCE IS THE OLD BEHAVIOUR EXACTLY. A flow that
   * passes nothing gets the two-way discard prompt this hook has always shown
   * — which is right for the short flows (report a sighting, add a vehicle),
   * where a draft would be more machinery than the thing it saves. Only the
   * nine-step posting wizard, which ends in a card charge, offers a third way
   * out.
   *
   * Rejections are swallowed by the caller, not here: an exit the owner has
   * already asked for must happen whether or not the write succeeded.
   */
  onSaveAndExit?: (answers: Partial<TAnswers>) => void | Promise<void>;
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
  { onExit, onComplete, onSaveAndExit, initialAnswers }: WizardControllerOptions<TAnswers>,
) {
  const screens = useMemo(() => flattenFlow(flow), [flow]);
  const [nav, dispatch] = useReducer(wizardReducer, INITIAL_NAV_STATE);

  // SAFETY: nav holds POSITIONS into `screens`. A flow that changes its screen
  // list mid-run would leave them indexing a list that no longer exists. Reset
  // navigation (never the answers) when that happens. Static flows — every flow
  // except the garage's prefilled post, which expands its collapsed vehicle
  // phase when the owner taps Edit — keep a stable `flow` identity, so this
  // never fires for them and posting from scratch is unaffected.
  const previousScreens = useRef(screens);
  useEffect(() => {
    if (previousScreens.current !== screens) {
      previousScreens.current = screens;
      dispatch({ type: 'reset' });
    }
  }, [screens]);
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
  // ⚠️ A REF, NOT THE `answers` STATE, for requestExit's save (review #19).
  // requestExit is memoised and is handed to a header button AND to the Android
  // back handler; taking `answers` as a dependency would rebuild it on every
  // keystroke and re-register both. The ref is what the ALERT CALLBACK reads,
  // and that fires long after render, so it must be the newest value rather
  // than the one closed over when the prompt was built.
  const answersRef = useRef<Partial<TAnswers>>({});

  const setAnswers = useCallback((patch: Partial<TAnswers>) => {
    dirtyRef.current = true;
    // Editing the answer clears a stale action error so it doesn't linger over
    // a value the user has since changed.
    setError(null);
    setAnswersState((current) => ({ ...current, ...patch }));
  }, []);

  // ⚠️ ONE SYNC POINT, not a write inside setAnswers. Every path that changes
  // answers goes through setAnswersState — the initial value, a step's edit,
  // and the snapshot restore when a review edit is backed out of — so mirroring
  // the STATE is the only version that cannot drift from it. Patching the ref
  // in setAnswers alone would have missed the first two.
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  // Which screens the walk should stop on. Recomputed from the CURRENT answers
  // on every move, because that is the whole point: a step steps aside the
  // moment another one answers its question. Intros and review have no step and
  // are always walked to.
  const visible = useMemo(
    () =>
      screens.map((screen) =>
        screen.kind === 'step' ? (screen.step.when?.(answers) ?? true) : true,
      ),
    [screens, answers],
  );

  const next = useCallback(() => {
    // Completing an edit commits it — the snapshot is no longer a fallback.
    editSnapshotRef.current = null;
    dispatch({ type: 'next', visible });
  }, [visible]);
  const back = useCallback(() => {
    setError(null);
    if (editSnapshotRef.current !== null) {
      setAnswersState(editSnapshotRef.current);
      editSnapshotRef.current = null;
    }
    dispatch({ type: 'back', visible });
  }, [visible]);
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
    // ⚠️ NOT WHILE SUBMITTING, and this is a double-pop bug, not tidiness. The
    // footer Back hides itself while an action is in flight and the Android
    // hardware back swallows the gesture, but the header X funnels straight in
    // here with no guard of its own: press Send → spinner → X → Discard →
    // onExit() pops, then the submit resolves and the flow's own onComplete
    // pops a SECOND screen out from under whoever is now on top. The old
    // bug-report form guarded this by hand with `disabled={sending}` on its
    // back chevron; guarding it here means no flow has to remember.
    //
    // ⚠️ AND ONLY ON THE LAST SCREEN — `busy` alone was too wide, and the cost
    // landed on a different flow entirely. `busy` is also true during a step's
    // `onContinue`, two of which are reverse-geocodes with no timeout
    // (postACarFlow, reportSightingFlow → placeLabels.ts, which catches but
    // cannot detect a hang). With Back hidden and the Android gesture
    // swallowed, the X is iOS's ONLY way out of a stalled lookup, and a wider
    // guard took it away. Leaving during an `onContinue` is harmless anyway: it
    // strands a `next()` dispatch against an unmounted reducer and routes
    // nowhere. Only the final submit has an onComplete that pops.
    if (busy && isLastScreen) return;
    if (!dirtyRef.current) {
      onExit();
      return;
    }
    // ⚠️ SAVE & EXIT LANDED 2026-09-03 (review #19) — this is the TODO that
    // stood here since the framework was written, and the prompt below is the
    // only place a flow's answers can leave the wizard other than by submit.
    //
    // A flow WITHOUT onSaveAndExit keeps the exact two-way prompt it always
    // had. That is deliberate: the short flows have nothing worth a draft, and
    // offering "Save" where nothing saves would be a lie.
    if (onSaveAndExit) {
      Alert.alert('Leave this report?', 'We can keep what you’ve entered for next time.', [
        { text: 'Keep editing', style: 'cancel' },
        // ⚠️ Destructive is on DISCARD, not on saving — the safe option must
        // not be the one styled as dangerous. Order matters too: on iOS the
        // cancel button is pinned, and "Discard" sits furthest from the thumb.
        { text: 'Discard', style: 'destructive', onPress: onExit },
        {
          text: 'Save & exit',
          onPress: () => {
            // Fire and leave. Awaiting a write before honouring an exit the
            // owner has already asked for would hold the screen open on a slow
            // disk, and a failed save must not trap them either.
            //
            // ⚠️ CAUGHT HERE, not left to the caller. `void` on a rejected
            // promise is still an UNHANDLED REJECTION — the app's own storage
            // layer swallows its errors, but this hook is shared and must not
            // assume that of every flow that ever passes this prop. A test
            // caught it doing exactly that.
            Promise.resolve(onSaveAndExit(answersRef.current)).catch(() => {});
            onExit();
          },
        },
      ]);
      return;
    }
    Alert.alert('Discard your answers?', "You'll lose what you've entered so far.", [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onExit },
    ]);
  }, [busy, isLastScreen, onExit, onSaveAndExit]);

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
    /**
     * True on the screen whose primary button SUBMITS (review, or the last step
     * in a flow with no review) — and false while editing from review.
     *
     * Exported so the chrome can disable the exit under exactly the condition
     * `requestExit` refuses. Recomputing `screen.kind === 'review'` up there
     * would agree today and diverge the moment a flow ships without a review.
     */
    isLastScreen,
    ctaLabel: ctaLabel(flow, screens, nav, answers),
    /** Fill fraction (0–1) per phase segment. */
    progress: phaseProgress(flow, nav.index),
    /** +1 sliding forward, -1 sliding back — drives the transition. */
    direction: nav.direction,
  };
}
