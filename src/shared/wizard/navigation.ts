/**
 * WHAT:  Pure navigation logic for the wizard — flattens a flow config into
 *        an ordered screen list, a reducer for moving through it (next /
 *        back / edit-from-review), per-phase progress, and validation gating.
 * WHY:   Kept free of React and rendering so the trickiest behaviour —
 *        review-edit-return loops, progress across phases, zod gating — is
 *        tested as plain functions (docs/TESTING.md: behaviour over
 *        implementation). The hook (useWizardController) is a thin shell
 *        over this file.
 * LINKS: src/shared/wizard/types.ts; src/shared/wizard/useWizardController.ts;
 *        src/shared/wizard/navigation.test.ts.
 */

import type {
  WizardFlow,
  WizardScreenDescriptor,
  WizardStep,
} from './types';

/**
 * Flatten phases into the ordered screens a user walks through:
 * intro(0), its steps…, intro(1), its steps…, [review]. A phase without an
 * `intro` contributes only its steps (speed flows skip the intro screen).
 */
export function flattenFlow<TAnswers>(
  flow: WizardFlow<TAnswers>,
): WizardScreenDescriptor<TAnswers>[] {
  const screens: WizardScreenDescriptor<TAnswers>[] = [];
  flow.phases.forEach((phase, phaseIndex) => {
    if (phase.intro) {
      screens.push({ kind: 'intro', phaseIndex });
    }
    phase.steps.forEach((step, stepIndexInPhase) => {
      screens.push({ kind: 'step', phaseIndex, stepIndexInPhase, step });
    });
  });
  if (flow.review) {
    screens.push({ kind: 'review' });
  }
  return screens;
}

/**
 * Resolve a step's question to a string — a plain string passes through; a
 * function is called with the answers so far (for questions whose wording
 * depends on an earlier step, e.g. "Which BMW model?" from the chosen make).
 */
export function resolveQuestion<TAnswers>(
  question: WizardStep<TAnswers>['question'],
  answers: Partial<TAnswers>,
): string {
  return typeof question === 'function' ? question(answers) : question;
}

export interface WizardNavState {
  /** Index into the flattened screen list. */
  index: number;
  /**
   * When the user jumped here from the review screen, the review's index —
   * completing (or backing out of) the edited step returns there instead of
   * continuing forward.
   */
  returnToIndex: number | null;
  /** +1 moving forward, -1 moving back/editing — drives the slide direction. */
  direction: 1 | -1;
}

export const INITIAL_NAV_STATE: WizardNavState = {
  index: 0,
  returnToIndex: null,
  direction: 1,
};

export type WizardNavAction =
  /**
   * Advance: next screen, or back to review when editing from review.
   * `visible[i]` is false for a screen whose `when` says to walk past it.
   */
  | { type: 'next'; visible: readonly boolean[] }
  /** Go back one screen; during a review edit, cancel back to review. */
  | { type: 'back'; visible: readonly boolean[] }
  /** Jump from the review screen to a step to edit it. */
  | { type: 'editStep'; targetIndex: number; reviewIndex: number }
  /**
   * Return to the first screen and drop any review-edit spur.
   *
   * SAFETY: nav.index and nav.returnToIndex are POSITIONS into the flattened
   * screen list. A flow whose screens change identity mid-run (the garage's
   * prefilled post expands its collapsed vehicle phase back to the full seven
   * steps) would otherwise leave those positions pointing into a list that no
   * longer exists — landing the user on an arbitrary screen, and, from a review
   * edit spur, sending "next" to a random step instead of back to review. That
   * path ends in a Stripe charge, so it resets deterministically instead.
   * Answers live in separate state and are NOT touched.
   */
  | { type: 'reset' };

/**
 * The first screen at or beyond `from` (walking in `step`) that is not being
 * walked past. Falls back to `from` when there is none that way, so a hidden
 * screen at an edge can never strand the walk off the end of the list.
 */
export function seekVisible(
  from: number,
  step: 1 | -1,
  visible: readonly boolean[],
): number {
  const last = visible.length - 1;
  let index = Math.min(Math.max(from, 0), last);
  while (visible[index] === false) {
    const candidate = index + step;
    if (candidate < 0 || candidate > last) {
      return from;
    }
    index = candidate;
  }
  return index;
}

export function wizardReducer(
  state: WizardNavState,
  action: WizardNavAction,
): WizardNavState {
  switch (action.type) {
    case 'next': {
      if (state.returnToIndex !== null) {
        return { index: state.returnToIndex, returnToIndex: null, direction: 1 };
      }
      const target = Math.min(state.index + 1, action.visible.length - 1);
      return {
        index: seekVisible(target, 1, action.visible),
        returnToIndex: null,
        direction: 1,
      };
    }
    case 'back': {
      // Backing out of a review edit abandons the edit spur, not the flow.
      if (state.returnToIndex !== null) {
        return { index: state.returnToIndex, returnToIndex: null, direction: -1 };
      }
      const target = Math.max(state.index - 1, 0);
      return {
        index: seekVisible(target, -1, action.visible),
        returnToIndex: null,
        direction: -1,
      };
    }
    case 'editStep':
      return {
        index: action.targetIndex,
        returnToIndex: action.reviewIndex,
        direction: -1,
      };
    case 'reset':
      return { ...INITIAL_NAV_STATE, direction: 1 };
  }
}

/**
 * Fill fraction (0–1) for each phase's progress-bar segment. A phase's
 * screens are its intro plus its steps (intros count toward progress); the
 * current screen counts as filled, so the bar moves on every advance.
 * The review screen sits past every phase, filling all segments.
 */
export function phaseProgress<TAnswers>(
  flow: WizardFlow<TAnswers>,
  currentIndex: number,
): number[] {
  let start = 0;
  return flow.phases.map((phase) => {
    const count = (phase.intro ? 1 : 0) + phase.steps.length;
    const end = start + count - 1;
    let fill: number;
    if (currentIndex < start) {
      fill = 0;
    } else if (currentIndex > end) {
      fill = 1;
    } else {
      fill = (currentIndex - start + 1) / count;
    }
    start = end + 1;
    return fill;
  });
}

/** Whether every REQUIRED step's schema in the whole flow accepts the answers.
 *  Steps flagged `optional` are skipped here — their schema still gates their
 *  own Next button, but a skipped optional step must never block the final CTA
 *  (e.g. distinctive features: Next needs ≥1, but "None to add" submits marks-less). */
export function allStepsValid<TAnswers>(
  flow: WizardFlow<TAnswers>,
  answers: Partial<TAnswers>,
): boolean {
  return flow.phases.every((phase) =>
    phase.steps.every((step) => step.optional || step.schema.safeParse(answers).success),
  );
}

/**
 * The ids of required steps whose schema does not accept the answers — i.e.
 * exactly what `allStepsValid` is refusing on.
 *
 * Exists so the review screen can SAY which answer is missing. The final CTA
 * re-checks every step in the flow and simply disables, which is correct but
 * was silent: twelve rows, a greyed-out button, and no way to tell which one
 * it meant. The commonest cause is invisible from the review screen too —
 * changing the make clears the model, so the row that broke is not the row
 * they touched.
 */
export function invalidStepIds<TAnswers>(
  flow: WizardFlow<TAnswers>,
  answers: Partial<TAnswers>,
): string[] {
  return flow.phases.flatMap((phase) =>
    phase.steps.flatMap((step) =>
      step.optional || step.schema.safeParse(answers).success ? [] : [step.id],
    ),
  );
}

/**
 * Whether the current screen allows advancing. Intros always do; a step
 * gates Next on its own zod schema; the review screen gates the final CTA
 * on EVERY step's schema, so answers invalidated after the fact (e.g. a
 * cancelled edit) can never be submitted.
 */
export function canProceed<TAnswers>(
  flow: WizardFlow<TAnswers>,
  screen: WizardScreenDescriptor<TAnswers>,
  answers: Partial<TAnswers>,
): boolean {
  if (screen.kind === 'step') {
    return screen.step.schema.safeParse(answers).success;
  }
  if (screen.kind === 'review') {
    return allStepsValid(flow, answers);
  }
  return true;
}

/**
 * Resolve the flow's final-CTA label to a string — a plain string passes
 * through; a function is called with the answers (for a label that depends on
 * them, e.g. "Post & pay £250" reading the bounty).
 */
export function resolveFinalCtaLabel<TAnswers>(
  finalCtaLabel: WizardFlow<TAnswers>['finalCtaLabel'],
  answers: Partial<TAnswers>,
): string {
  return typeof finalCtaLabel === 'function' ? finalCtaLabel(answers) : finalCtaLabel;
}

/** The primary footer label for a screen, per the flow's config. */
export function ctaLabel<TAnswers>(
  flow: WizardFlow<TAnswers>,
  screens: WizardScreenDescriptor<TAnswers>[],
  state: WizardNavState,
  answers: Partial<TAnswers>,
): string {
  const screen = screens[state.index];
  if (screen.kind === 'intro') {
    // An intro descriptor only exists for phases that declare an intro.
    return (
      flow.phases[screen.phaseIndex].intro?.ctaLabel ??
      (screen.phaseIndex === 0 ? 'Get started' : 'Continue')
    );
  }
  // The flow's high-information label on the last screen, and when finishing
  // an edit spur (the button returns the user to review, but "Next" would
  // promise forward motion that won't happen — "Done" is honest).
  if (state.returnToIndex !== null) {
    return 'Done';
  }
  if (state.index === screens.length - 1) {
    return resolveFinalCtaLabel(flow.finalCtaLabel, answers);
  }
  return (screen.kind === 'step' && screen.step.ctaLabel) || 'Next';
}

/**
 * Steps that appear on the review screen, grouped by phase.
 *
 * Takes ANSWERS as well as the flow because two of the three filters depend on
 * them: `when` decides whether a step is being walked past, and
 * `hideReviewWhenSkipped` decides whether that absence should also hide the row.
 * Empty groups are dropped — a phase heading with nothing under it is a
 * rendering artefact, and hiding a row can now empty a phase.
 */
export function reviewGroups<TAnswers>(
  flow: WizardFlow<TAnswers>,
  answers: Partial<TAnswers>,
): {
  phaseIndex: number;
  title: string;
  items: { step: WizardStep<TAnswers>; flatIndex: number }[];
}[] {
  const screens = flattenFlow(flow);
  return flow.phases
    .map((phase, phaseIndex) => ({
      phaseIndex,
      title: phase.title,
      items: screens.flatMap((screen, flatIndex) => {
        if (screen.kind !== 'step' || screen.phaseIndex !== phaseIndex) return [];
        const { step } = screen;
        if (!step.reviewValue) return [];
        // Walked past AND opted out — see hideReviewWhenSkipped. Without the
        // opt-out the row survives on purpose; `when`'s own doc explains why.
        const skipped = step.when ? !step.when(answers) : false;
        if (skipped && step.hideReviewWhenSkipped) return [];
        return [{ step, flatIndex }];
      }),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * The flat screen index of a step, by id — so a flow can send someone to its
 * own step without doing index arithmetic against a list the framework builds.
 * Returns null for an unknown id; callers should no-op rather than jump
 * somewhere arbitrary.
 */
export function stepFlatIndex<TAnswers>(
  flow: WizardFlow<TAnswers>,
  stepId: string,
): number | null {
  const index = flattenFlow(flow).findIndex(
    (screen) => screen.kind === 'step' && screen.step.id === stepId,
  );
  return index === -1 ? null : index;
}
