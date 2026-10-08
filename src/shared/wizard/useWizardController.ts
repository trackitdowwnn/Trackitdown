/**
 * WHAT:  The wizard's state hook — owns the answers object and navigation
 *        state, and exposes everything the chrome renders: current screen,
 *        gating, CTA label, per-phase progress, slide direction, the dirty-exit
 *        confirmation, and the async primary-button path (`advance`, `busy`,
 *        `error`) that runs a step's onContinue lookup or the final onComplete
 *        submit — advancing on success, staying put with an error on failure.
 *        Every move also LOCKS navigation for the length of its transition
 *        and drops the keyboard (see `move`). One-pick steps can move on by
 *        themselves (`advanceSoon`), and an edit from review visits any
 *        answer it broke before returning (2026-10-08).
 * WHY:   A thin React shell over the pure logic in navigation.ts, so screens
 *        and chrome stay dumb. The answers object is a single serializable
 *        value and exits funnel through one place, deliberately: that is the
 *        seam where draft persistence plugs in later.
 * LINKS: src/shared/wizard/navigation.ts; src/shared/wizard/types.ts;
 *        src/shared/wizard/WizardScreen.tsx (consumer).
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Alert, Keyboard } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { useScreenReaderEnabled } from '../hooks/useScreenReaderEnabled';
import { motion } from '../theme';

import {
  INITIAL_NAV_STATE,
  canProceed,
  ctaLabel,
  flattenFlow,
  invalidStepIds,
  phaseProgress,
  wizardReducer,
  type WizardNavAction,
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
   * Called when the owner EXPLICITLY taps Discard on the leave prompt, just
   * before onExit — not on a clean exit with nothing entered. The posting
   * flow uses it to forget a saved draft: without it, a draft the owner had
   * just thrown away came straight back on the next open.
   */
  onDiscard?: () => void;
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
  { onExit, onComplete, onSaveAndExit, onDiscard, initialAnswers }: WizardControllerOptions<TAnswers>,
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

  // ⚠️ ONE MOVE AT A TIME (2026-10-08). A second tap during a transition used
  // to start a second move with the first still on screen: a double-tapped
  // Next skipped a step, and Next-then-Back slid three screens at once. Every
  // move now locks navigation for the length of its transition; a move asked
  // for meanwhile is dropped, not queued (a queued tap lands on a screen the
  // owner never saw). Instant under reduced motion — there is no transition
  // to wait for. `settled` tells steps the same thing, so heavy ones (the
  // map) can wait for it before they mount.
  const reduceMotion = useReducedMotion();
  const lockRef = useRef(false);
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [settled, setSettled] = useState(true);
  // A pending auto-advance (see advanceSoon). Any move cancels it.
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelAutoAdvance = useCallback(() => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = null;
  }, []);
  // A move can be asked for AFTER the screen has gone: a step's onContinue
  // lookup resolving once the owner has left by the X. It must do nothing —
  // above all not drop the keyboard on whatever screen is now on top.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      lockRef.current = false;
      if (unlockTimer.current) clearTimeout(unlockTimer.current);
      if (autoTimer.current) clearTimeout(autoTimer.current);
    };
  }, []);

  /** Every move goes through here: drop the keyboard (a field left focused
   *  would otherwise close mid-slide and resize the screen under it), lock,
   *  dispatch. Internal — the public moves below check the lock first. */
  const move = useCallback(
    (action: WizardNavAction) => {
      if (!mountedRef.current) return;
      cancelAutoAdvance();
      Keyboard.dismiss();
      dispatch(action);
      if (reduceMotion) return;
      lockRef.current = true;
      setSettled(false);
      if (unlockTimer.current) clearTimeout(unlockTimer.current);
      unlockTimer.current = setTimeout(() => {
        lockRef.current = false;
        unlockTimer.current = null;
        setSettled(true);
      }, motion.standard);
    },
    [reduceMotion, cancelAutoAdvance],
  );

  const goNext = useCallback(() => {
    // On an edit spur, Done first visits any required answer the edit broke
    // (navigation.ts, 'next'). Only a return to review commits the edit —
    // until then the snapshot stays, so Back still cancels all of it.
    const editing = nav.returnToIndex !== null;
    const invalid = editing ? new Set(invalidStepIds(flow, answers)) : null;
    const blocking = invalid
      ? screens.map((screen) => screen.kind === 'step' && invalid.has(screen.step.id))
      : undefined;
    if (!blocking?.some(Boolean)) {
      // Completing an edit commits it — the snapshot is no longer a fallback.
      editSnapshotRef.current = null;
    }
    move({ type: 'next', visible, blocking });
  }, [move, visible, nav.returnToIndex, flow, answers, screens]);
  const next = useCallback(() => {
    if (lockRef.current) return;
    goNext();
  }, [goNext]);
  const back = useCallback(() => {
    if (lockRef.current) return;
    setError(null);
    if (editSnapshotRef.current !== null) {
      setAnswersState(editSnapshotRef.current);
      editSnapshotRef.current = null;
    }
    move({ type: 'back', visible });
  }, [move, visible]);
  const editStep = useCallback(
    (targetIndex: number) => {
      if (lockRef.current) return;
      editSnapshotRef.current = answers;
      move({ type: 'editStep', targetIndex, reviewIndex: nav.index });
    },
    [move, answers, nav.index],
  );
  /** The screen re-rendered the leaving view with its exit: swap it out (see
   *  WizardNavState.shownIndex). WizardScreen calls it from a layout effect. */
  const settle = useCallback(() => dispatch({ type: 'settle' }), []);

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
    if (busy || lockRef.current) return;
    const screen = screens[nav.index];
    const onContinue = screen.kind === 'step' ? screen.step.onContinue : undefined;
    const hasAction = isLastScreen ? Boolean(onComplete) : Boolean(onContinue);

    if (!hasAction) {
      // Nothing async to do. The final screen with no onComplete no-ops (the
      // flow is expected to supply one); every other screen just moves on.
      if (!isLastScreen) goNext();
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
      // Not `next`: the press already passed the lock, and a lookup that
      // outlasts nothing must not be dropped by one.
      goNext();
    } catch (err) {
      setBusy(false);
      setError(toErrorMessage(err));
    }
  }, [busy, screens, nav.index, isLastScreen, onComplete, answers, goNext]);

  const canGoNext = canProceed(flow, screens[nav.index], answers);

  // ⚠️ AUTO-ADVANCE (2026-10-08): a one-pick step (make, model, year, colour,
  // body type) moves on by itself a beat after the pick, saving a tap per
  // step. The beat lets the pick be SEEN landing. When it fires it reads the
  // LATEST state (a ref, not this closure): it advances only if the step is
  // valid by then, and never past the lock. Any move cancels it — the owner
  // pressing Next or Back meanwhile wins. NEVER under a screen reader: the
  // screen would move on before the new value had been read back.
  //
  // ⚠️ AND NEVER FROM THE SUBMITTING SCREEN. There `advance` runs onComplete
  // — on Post a car, "Post & pay". A pick must never become a payment.
  const screenReader = useScreenReaderEnabled();
  const latestRef = useRef({ canGoNext, advance, isLastScreen });
  useEffect(() => {
    latestRef.current = { canGoNext, advance, isLastScreen };
  });
  const advanceSoon = useCallback(() => {
    if (screenReader) return;
    cancelAutoAdvance();
    const fire = () => {
      autoTimer.current = null;
      if (lockRef.current) {
        autoTimer.current = setTimeout(fire, motion.autoAdvanceBeat);
        return;
      }
      const latest = latestRef.current;
      if (latest.canGoNext && !latest.isLastScreen) void latest.advance();
    };
    autoTimer.current = setTimeout(fire, motion.autoAdvanceBeat);
  }, [screenReader, cancelAutoAdvance]);

  const requestExit = useCallback(() => {
    const discard = () => {
      onDiscard?.();
      onExit();
    };
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
    // `onContinue`, two of which are reverse-geocodes (postACarFlow,
    // reportSightingFlow → placeLabels.ts) — bounded at LOOKUP_TIMEOUT_MS (4s)
    // since 2026-10-08, but four seconds of spinner is still long enough to
    // want out of. With Back hidden and the Android gesture swallowed, the X is
    // iOS's ONLY way out of one, and a wider guard took it away. Leaving during
    // an `onContinue` is harmless anyway: the move it ends in does nothing once
    // the screen has gone (see `move`). Only the final submit has an
    // onComplete that pops.
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
        { text: 'Discard', style: 'destructive', onPress: discard },
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
      { text: 'Discard', style: 'destructive', onPress: discard },
    ]);
  }, [busy, isLastScreen, onExit, onSaveAndExit, onDiscard]);

  return {
    screens,
    screenIndex: nav.index,
    screen: screens[nav.index],
    /** The screen ON SCREEN, one commit behind screenIndex on a move, and
     *  the one before it (see WizardNavState.shownIndex). */
    shownIndex: nav.shownIndex,
    previousIndex: nav.previousIndex,
    settle,
    /** False for the length of a move's transition — see the lock. */
    settled,
    /** True while on an edit spur: launched from the review screen, or from a
     *  step's own `editStep` (the report flow's check-and-send). */
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
    canGoNext,
    /** Move on after a short beat — see the auto-advance note above. */
    advanceSoon,
    // NOT on an edit spur: a spur into an intro-less flow's first step (the
    // report flow's camera, from its check-and-send) must still show Back,
    // and the hardware back must cancel the edit, not offer to discard the
    // whole flow.
    isFirstScreen: nav.index === 0 && nav.returnToIndex === null,
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
    /** Fill fraction (0–1) per phase segment. Held where it was while on an
     *  edit spur: a detour from review is not progress lost (2026-10-08). */
    progress: phaseProgress(flow, nav.returnToIndex ?? nav.index),
    /** +1 sliding forward, -1 sliding back — drives the transition. */
    direction: nav.direction,
  };
}
