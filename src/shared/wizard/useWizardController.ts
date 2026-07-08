/**
 * WHAT:  The wizard's state hook — owns the answers object and navigation
 *        state, and exposes everything the chrome renders: current screen,
 *        gating, CTA label, per-phase progress, slide direction, and the
 *        dirty-exit confirmation.
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
  /** Pre-filled answers (e.g. a future saved draft). */
  initialAnswers?: Partial<TAnswers>;
}

export function useWizardController<TAnswers>(
  flow: WizardFlow<TAnswers>,
  { onExit, initialAnswers }: WizardControllerOptions<TAnswers>,
) {
  const screens = useMemo(() => flattenFlow(flow), [flow]);
  const [nav, dispatch] = useReducer(wizardReducer, INITIAL_NAV_STATE);
  const [answers, setAnswersState] = useState<Partial<TAnswers>>(
    initialAnswers ?? {},
  );

  // Dirty = the user has changed something since entering. Deleting text
  // again still counts (matches the caution of a discard confirmation).
  const dirtyRef = useRef(false);
  // Answers as they were when a review edit began; backing out of the edit
  // restores this, so "Back" truly cancels instead of leaving a half-edit.
  const editSnapshotRef = useRef<Partial<TAnswers> | null>(null);

  const setAnswers = useCallback((patch: Partial<TAnswers>) => {
    dirtyRef.current = true;
    setAnswersState((current) => ({ ...current, ...patch }));
  }, []);

  const next = useCallback(() => {
    // Completing an edit commits it — the snapshot is no longer a fallback.
    editSnapshotRef.current = null;
    dispatch({ type: 'next', screenCount: screens.length });
  }, [screens.length]);
  const back = useCallback(() => {
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
