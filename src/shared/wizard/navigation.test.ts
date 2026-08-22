/**
 * WHAT:  Tests for the wizard's pure navigation logic — flow flattening,
 *        next/back/edit-from-review transitions, per-phase progress fills,
 *        zod validation gating, and CTA labels.
 * WHY:   Every flow built on the framework (posting, Stripe onboarding)
 *        rides on this logic; a broken review-return or progress calculation
 *        would corrupt every wizard in the app at once.
 * LINKS: src/shared/wizard/navigation.ts, docs/TESTING.md.
 */

import { z } from 'zod';

import {
  INITIAL_NAV_STATE,
  canProceed,
  ctaLabel,
  flattenFlow,
  phaseProgress,
  resolveQuestion,
  reviewGroups,
  wizardReducer,
  type WizardNavState,
} from './navigation';
import type { WizardFlow } from './types';

interface DemoAnswers {
  name: string;
  colour: string;
  newsletter: boolean;
}

const Noop = () => null;

/** 2 phases (2 steps + 1 step) plus review → 6 screens. */
const flow: WizardFlow<DemoAnswers> = {
  id: 'test-flow',
  finalCtaLabel: 'Publish',
  review: {},
  phases: [
    {
      id: 'about',
      title: 'About you',
      intro: { headline: 'Tell us about you', body: 'Two quick questions.' },
      steps: [
        {
          id: 'name',
          question: "What's your name?",
          component: Noop,
          schema: z.object({ name: z.string().min(1) }),
          reviewValue: (answers) => answers.name ?? '',
        },
        {
          id: 'colour',
          question: 'Favourite colour?',
          component: Noop,
          schema: z.object({ colour: z.string().min(1) }),
          reviewValue: (answers) => answers.colour ?? '',
        },
      ],
    },
    {
      id: 'prefs',
      title: 'Preferences',
      intro: { headline: 'Your preferences', body: 'One more thing.' },
      steps: [
        {
          id: 'newsletter',
          question: 'Want the newsletter?',
          component: Noop,
          schema: z.object({ newsletter: z.boolean() }),
          reviewValue: (answers) => (answers.newsletter ? 'Yes' : 'No'),
        },
      ],
    },
  ],
};

const screens = flattenFlow(flow);
// screens: intro, name, colour, intro, newsletter, review
/** No step is being walked past — the shape of every flow without a `when`. */
const ALL_VISIBLE = screens.map(() => true);
const REVIEW_INDEX = 5;

function navState(
  index: number,
  returnToIndex: number | null = null,
  direction: 1 | -1 = 1,
): WizardNavState {
  return { index, returnToIndex, direction };
}

describe('flattenFlow', () => {
  it('orders screens as intro, its steps, next intro, its steps, review', () => {
    expect(screens.map((s) => s.kind)).toEqual([
      'intro',
      'step',
      'step',
      'intro',
      'step',
      'review',
    ]);
  });

  it('omits the review screen when the flow does not opt in', () => {
    const noReview = flattenFlow({ ...flow, review: undefined });
    expect(noReview.map((s) => s.kind)).not.toContain('review');
  });
});

describe('wizardReducer', () => {
  it('advances one screen on next', () => {
    expect(wizardReducer(INITIAL_NAV_STATE, { type: 'next', visible: ALL_VISIBLE }))
      .toEqual(navState(1));
  });

  it('does not advance past the last screen', () => {
    expect(
      wizardReducer(navState(REVIEW_INDEX), { type: 'next', visible: ALL_VISIBLE }),
    ).toEqual(navState(REVIEW_INDEX));
  });

  it('goes back one screen and never below the first', () => {
    expect(wizardReducer(navState(2), { type: 'back', visible: ALL_VISIBLE })).toEqual(navState(1, null, -1));
    expect(wizardReducer(navState(0), { type: 'back', visible: ALL_VISIBLE })).toEqual(navState(0, null, -1));
  });

  it('jumps from review to the edited step and remembers where to return', () => {
    const editing = wizardReducer(navState(REVIEW_INDEX), {
      type: 'editStep',
      targetIndex: 1,
      reviewIndex: REVIEW_INDEX,
    });
    expect(editing).toEqual(navState(1, REVIEW_INDEX, -1));
  });

  it('returns to review when the edited step completes, not forward', () => {
    const afterEdit = wizardReducer(navState(1, REVIEW_INDEX), {
      type: 'next',
      visible: ALL_VISIBLE,
    });
    expect(afterEdit).toEqual(navState(REVIEW_INDEX));
  });

  it('returns to review when the user backs out of an edit', () => {
    const cancelled = wizardReducer(navState(1, REVIEW_INDEX), { type: 'back', visible: ALL_VISIBLE });
    expect(cancelled).toEqual(navState(REVIEW_INDEX, null, -1));
  });

  // A step whose `when` says to walk past it. Positions are NOT renumbered —
  // the screen list is untouched — so an edit spur into it still lands.
  describe('walking past a hidden step', () => {
    /** Screen 1 steps aside. */
    const hidden1 = ALL_VISIBLE.map((_, index) => index !== 1);

    it('next skips it', () => {
      expect(wizardReducer(navState(0), { type: 'next', visible: hidden1 })).toEqual(
        navState(2),
      );
    });

    it('back skips it too, so Back is not a trap', () => {
      // The bug this prevents: Back lands on a hidden step, which is skipped
      // forward again, and the user can never get behind it.
      expect(wizardReducer(navState(2), { type: 'back', visible: hidden1 })).toEqual(
        navState(0, null, -1),
      );
    });

    it('skips a whole run of hidden steps', () => {
      const hidden12 = ALL_VISIBLE.map((_, index) => index !== 1 && index !== 2);
      expect(wizardReducer(navState(0), { type: 'next', visible: hidden12 })).toEqual(
        navState(3),
      );
    });

    it('an edit spur still reaches it — review is how you correct it', () => {
      const editing = wizardReducer(navState(REVIEW_INDEX), {
        type: 'editStep',
        targetIndex: 1,
        reviewIndex: REVIEW_INDEX,
      });
      expect(editing).toEqual(navState(1, REVIEW_INDEX, -1));
    });

    it('stays put rather than running off the end when the way is all hidden', () => {
      const noneVisible = ALL_VISIBLE.map(() => false);
      expect(
        wizardReducer(navState(0), { type: 'next', visible: noneVisible }),
      ).toEqual(navState(1));
    });
  });
});

describe('phaseProgress', () => {
  it('starts with a sliver of phase 1 on its intro and nothing in phase 2', () => {
    expect(phaseProgress(flow, 0)).toEqual([1 / 3, 0]);
  });

  it('fills phase 1 proportionally as its screens complete', () => {
    expect(phaseProgress(flow, 1)).toEqual([2 / 3, 0]);
    expect(phaseProgress(flow, 2)).toEqual([1, 0]);
  });

  it('fills earlier phases fully once passed', () => {
    expect(phaseProgress(flow, 3)).toEqual([1, 1 / 2]);
    expect(phaseProgress(flow, 4)).toEqual([1, 1]);
  });

  it('shows every segment full on the review screen', () => {
    expect(phaseProgress(flow, REVIEW_INDEX)).toEqual([1, 1]);
  });
});

describe('canProceed (validation gating)', () => {
  const completeAnswers = { name: 'Jane', colour: 'green', newsletter: true };

  it('always allows intro screens', () => {
    expect(canProceed(flow, screens[0], {})).toBe(true);
    expect(canProceed(flow, screens[3], {})).toBe(true);
  });

  it('blocks a step until its schema accepts the answers', () => {
    expect(canProceed(flow, screens[1], {})).toBe(false);
    expect(canProceed(flow, screens[1], { name: '' })).toBe(false);
    expect(canProceed(flow, screens[1], { name: 'Jane' })).toBe(true);
  });

  it('ignores answers owned by other steps', () => {
    expect(canProceed(flow, screens[1], { name: 'Jane', colour: 'green' })).toBe(true);
  });

  it('gates the review screen on EVERY step schema, so a cancelled edit cannot submit invalid answers', () => {
    expect(canProceed(flow, screens[REVIEW_INDEX], completeAnswers)).toBe(true);
    expect(canProceed(flow, screens[REVIEW_INDEX], { ...completeAnswers, name: '' })).toBe(false);
    expect(canProceed(flow, screens[REVIEW_INDEX], {})).toBe(false);
  });

  it('an OPTIONAL step never blocks the review CTA even when its schema fails (skipped)', () => {
    // Make the colour step optional; its schema still needs a colour, but a
    // skipped optional step must not disable the final CTA (the marks-step bug).
    const withOptional: WizardFlow<DemoAnswers> = {
      ...flow,
      phases: flow.phases.map((phase) => ({
        ...phase,
        steps: phase.steps.map((step) =>
          step.id === 'colour' ? { ...step, optional: true } : step,
        ),
      })),
    };
    const reviewScreen = flattenFlow(withOptional).find((s) => s.kind === 'review')!;
    // No colour → the required flow blocks, but the optional one submits.
    expect(canProceed(flow, screens[REVIEW_INDEX], { name: 'Jane', newsletter: true })).toBe(false);
    expect(canProceed(withOptional, reviewScreen, { name: 'Jane', newsletter: true })).toBe(true);
    // A required step (name) still gates the optional-containing flow.
    expect(canProceed(withOptional, reviewScreen, { newsletter: true })).toBe(false);
  });
});

describe('ctaLabel', () => {
  it('says Get started on the first intro and Continue on later intros', () => {
    expect(ctaLabel(flow, screens, navState(0), {})).toBe('Get started');
    expect(ctaLabel(flow, screens, navState(3), {})).toBe('Continue');
  });

  it('says Next mid-flow and the flow’s own label on the last screen', () => {
    expect(ctaLabel(flow, screens, navState(1), {})).toBe('Next');
    expect(ctaLabel(flow, screens, navState(REVIEW_INDEX), {})).toBe('Publish');
  });

  it('says Done while editing from review', () => {
    expect(ctaLabel(flow, screens, navState(1, REVIEW_INDEX), {})).toBe('Done');
  });

  it('resolves a function finalCtaLabel with the answers on the last screen', () => {
    const dynamicFlow: WizardFlow<DemoAnswers> = {
      ...flow,
      finalCtaLabel: (answers) => `Pay for ${answers.name ?? 'you'}`,
    };
    expect(ctaLabel(dynamicFlow, screens, navState(REVIEW_INDEX), { name: 'Sam' })).toBe(
      'Pay for Sam',
    );
    // Not the last screen → the dynamic label is not used.
    expect(ctaLabel(dynamicFlow, screens, navState(1), { name: 'Sam' })).toBe('Next');
  });
});

describe('reviewGroups', () => {
  it('groups reviewable steps by phase with their flat indices', () => {
    const groups = reviewGroups(flow, {});
    expect(groups.map((group) => group.title)).toEqual(['About you', 'Preferences']);
    expect(groups[0].items.map((item) => item.flatIndex)).toEqual([1, 2]);
    expect(groups[1].items.map((item) => item.flatIndex)).toEqual([4]);
  });
});

describe('resolveQuestion', () => {
  it('passes a plain string through unchanged', () => {
    expect(resolveQuestion('Which model?', {})).toBe('Which model?');
  });

  it('calls a function question with the answers so far', () => {
    const question = (answers: Partial<DemoAnswers>) =>
      answers.name ? `Hi ${answers.name}, what next?` : 'What next?';
    expect(resolveQuestion(question, { name: 'Sam' })).toBe('Hi Sam, what next?');
    expect(resolveQuestion(question, {})).toBe('What next?');
  });
});

describe('intro-less phases (speed flows)', () => {
  /** One phase, no intro, no review — the report-sighting shape. */
  const speedFlow: WizardFlow<DemoAnswers> = {
    id: 'speed-flow',
    finalCtaLabel: 'Send report',
    phases: [
      {
        id: 'report',
        title: 'Report',
        steps: [
          {
            id: 'name',
            question: "What's your name?",
            component: Noop,
            schema: z.object({ name: z.string().min(1) }),
          },
          {
            id: 'colour',
            question: 'Favourite colour?',
            component: Noop,
            schema: z.object({ colour: z.string().min(1) }),
          },
        ],
      },
    ],
  };

  it('emits no intro screens: the flow starts on the first step', () => {
    const speedScreens = flattenFlow(speedFlow);
    expect(speedScreens.map((screen) => screen.kind)).toEqual(['step', 'step']);
  });

  it('progress counts only the steps', () => {
    expect(phaseProgress(speedFlow, 0)).toEqual([0.5]);
    expect(phaseProgress(speedFlow, 1)).toEqual([1]);
  });

  it('the last step carries the final CTA', () => {
    const speedScreens = flattenFlow(speedFlow);
    expect(
      ctaLabel(speedFlow, speedScreens, { index: 1, returnToIndex: null, direction: 1 }, {}),
    ).toBe('Send report');
  });

  it('mixed flows still emit intros for phases that declare one', () => {
    const mixed: WizardFlow<DemoAnswers> = {
      ...speedFlow,
      phases: [flow.phases[0], speedFlow.phases[0]],
    };
    expect(flattenFlow(mixed).map((screen) => screen.kind)).toEqual([
      'intro',
      'step',
      'step',
      'step',
      'step',
    ]);
    // Phase 1: intro + 2 steps = 3 screens; phase 2: 2 steps.
    expect(phaseProgress(mixed, 2)).toEqual([1, 0]);
  });
});
