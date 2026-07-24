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
  /** Advance: next screen, or back to review when editing from review. */
  | { type: 'next'; screenCount: number }
  /** Go back one screen; during a review edit, cancel back to review. */
  | { type: 'back' }
  /** Jump from the review screen to a step to edit it. */
  | { type: 'editStep'; targetIndex: number; reviewIndex: number };

export function wizardReducer(
  state: WizardNavState,
  action: WizardNavAction,
): WizardNavState {
  switch (action.type) {
    case 'next': {
      if (state.returnToIndex !== null) {
        return { index: state.returnToIndex, returnToIndex: null, direction: 1 };
      }
      return {
        index: Math.min(state.index + 1, action.screenCount - 1),
        returnToIndex: null,
        direction: 1,
      };
    }
    case 'back': {
      // Backing out of a review edit abandons the edit spur, not the flow.
      if (state.returnToIndex !== null) {
        return { index: state.returnToIndex, returnToIndex: null, direction: -1 };
      }
      return { index: Math.max(state.index - 1, 0), returnToIndex: null, direction: -1 };
    }
    case 'editStep':
      return {
        index: action.targetIndex,
        returnToIndex: action.reviewIndex,
        direction: -1,
      };
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

/** Whether every step's schema in the whole flow accepts the answers. */
export function allStepsValid<TAnswers>(
  flow: WizardFlow<TAnswers>,
  answers: Partial<TAnswers>,
): boolean {
  return flow.phases.every((phase) =>
    phase.steps.every((step) => step.schema.safeParse(answers).success),
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

/** The primary footer label for a screen, per the flow's config. */
export function ctaLabel<TAnswers>(
  flow: WizardFlow<TAnswers>,
  screens: WizardScreenDescriptor<TAnswers>[],
  state: WizardNavState,
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
    return flow.finalCtaLabel;
  }
  return (screen.kind === 'step' && screen.step.ctaLabel) || 'Next';
}

/** Steps that appear on the review screen, grouped by phase. */
export function reviewGroups<TAnswers>(flow: WizardFlow<TAnswers>): {
  phaseIndex: number;
  title: string;
  items: { step: WizardStep<TAnswers>; flatIndex: number }[];
}[] {
  const screens = flattenFlow(flow);
  return flow.phases.map((phase, phaseIndex) => ({
    phaseIndex,
    title: phase.title,
    items: screens.flatMap((screen, flatIndex) =>
      screen.kind === 'step' &&
      screen.phaseIndex === phaseIndex &&
      screen.step.reviewValue
        ? [{ step: screen.step, flatIndex }]
        : [],
    ),
  }));
}
