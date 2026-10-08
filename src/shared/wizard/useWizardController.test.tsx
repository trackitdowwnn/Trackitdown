/**
 * WHAT:  Tests for the wizard controller hook — answer merging, gating
 *        recomputation, the dirty-exit confirmation path (clean exits leave
 *        silently; dirty exits confirm, and only Discard exits), and the
 *        async primary-button behaviour: a step's onContinue (merge-then-
 *        advance, error-then-stay) and the final onComplete (success holds the
 *        spinner without navigating; failure keeps the wizard intact for retry),
 *        and that an edit spur into an intro-less first step is not "the
 *        first screen".
 * WHY:   The exit path guards user-entered data across every flow built on
 *        the framework; silently discarding a half-finished post would be a
 *        trust failure. The async path is the post-a-car wizard's spine —
 *        losing a completed wizard to a network blip is the unforgivable
 *        failure, so submit-failure-stays-intact is covered here explicitly.
 *        Navigation itself is covered in navigation.test.ts.
 * LINKS: src/shared/wizard/useWizardController.ts, docs/TESTING.md.
 */

import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo, Alert, Keyboard, type AlertButton } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { z } from 'zod';

import { motion } from '../theme';
import type { WizardFlow } from './types';
import { useWizardController } from './useWizardController';

/** The submitting screen ignores its button for a moment after arriving (a
 *  double-tapped Next must not become a submit — useWizardController's
 *  SUBMIT_ARM_MS). A person never presses that fast; wait as one would. */
const waitForSubmitArm = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 320));
  });

/** A promise whose resolve/reject we drive by hand, to freeze an action mid-flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Answers {
  name: string;
}

const flow: WizardFlow<Answers> = {
  id: 'exit-test',
  finalCtaLabel: 'Submit',
  phases: [
    {
      id: 'about',
      title: 'About you',
      intro: { headline: 'Hello', body: 'One question.' },
      steps: [
        {
          id: 'name',
          question: "What's your name?",
          component: () => null,
          schema: z.object({ name: z.string().min(1) }),
        },
      ],
    },
  ],
};

async function renderController(onExit: () => void) {
  const rendered = await renderHook(() =>
    useWizardController<Answers>(flow, { onExit }),
  );
  return rendered;
}

// Reduced motion by default: these cases move several times in a row, and
// each move otherwise locks navigation for its transition (see 'one move at a
// time' below, which turns motion back on).
beforeEach(() => {
  jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
});

describe('one move at a time', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('drops a move asked for during another one, then takes the next', async () => {
    jest.useFakeTimers();
    jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(false);
    const { result } = await renderController(jest.fn());

    await act(async () => result.current.next()); // intro → name
    expect(result.current.settled).toBe(false);
    await act(async () => result.current.back()); // mid-move: dropped
    expect(result.current.screenIndex).toBe(1);

    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    expect(result.current.settled).toBe(true);
    await act(async () => result.current.back());
    expect(result.current.screenIndex).toBe(0);
  });

  it('a move asked for after the screen has gone does nothing — not even drop the keyboard', async () => {
    jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(false);
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const { result, unmount } = await renderController(jest.fn());
    const { next } = result.current;
    await unmount(); // left by the X mid-lookup
    next(); // the lookup lands
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('never locks under reduced motion — there is no transition to wait for', async () => {
    const { result } = await renderController(jest.fn());
    await act(async () => result.current.next());
    await act(async () => result.current.back());
    expect(result.current.screenIndex).toBe(0);
    expect(result.current.settled).toBe(true);
  });
});

// 2026-10-08: one-pick steps move on by themselves a beat after the pick.
describe('advanceSoon (auto-advance)', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** The name step, with one more after it. */
  const twoStepFlow: WizardFlow<Answers> = {
    ...flow,
    phases: [
      {
        ...flow.phases[0],
        steps: [
          ...flow.phases[0].steps,
          { id: 'more', question: 'And?', component: () => null, schema: z.object({}) },
        ],
      },
    ],
  };

  /** On the name step, freshly answered. */
  async function onAnsweredStep(onComplete?: () => void) {
    jest.useFakeTimers();
    const rendered = await renderHook(() =>
      useWizardController<Answers>(twoStepFlow, { onExit: jest.fn(), onComplete }),
    );
    await act(async () => rendered.result.current.next()); // intro → name
    await act(async () => rendered.result.current.setAnswers({ name: 'Jane' }));
    return rendered;
  }

  it('moves on after the beat — not before', async () => {
    const { result } = await onAnsweredStep();
    await act(async () => result.current.advanceSoon());
    await act(async () => {
      jest.advanceTimersByTime(motion.autoAdvanceBeat - 1);
    });
    expect(result.current.screenIndex).toBe(1);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.screenIndex).toBe(2);
  });

  it('takes the beat it is given (a picker’s shorter one)', async () => {
    const { result } = await onAnsweredStep();
    await act(async () => result.current.advanceSoon(motion.autoAdvanceAfterPicker));
    await act(async () => {
      jest.advanceTimersByTime(motion.autoAdvanceAfterPicker);
    });
    expect(result.current.screenIndex).toBe(2);
  });

  // Code review of #143: a habitual Next landing just after the step moved on
  // by itself acted on the NEXT step — an always-valid year step, skipped
  // unseen. Even under reduced motion, where ordinary moves don't lock.
  it('⚠️ a move it makes locks against a stray Next, even under reduced motion', async () => {
    const { result } = await onAnsweredStep();
    await act(async () => result.current.advanceSoon());
    await act(async () => {
      jest.advanceTimersByTime(motion.autoAdvanceBeat);
    });
    expect(result.current.screenIndex).toBe(2);
    await act(async () => result.current.next()); // the habitual tap
    expect(result.current.screenIndex).toBe(2);
  });

  it('a move meanwhile cancels it — the owner’s Back wins', async () => {
    const { result } = await onAnsweredStep();
    await act(async () => result.current.advanceSoon());
    await act(async () => result.current.back());
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.screenIndex).toBe(0);
  });

  it('never moves on from a step that is not valid by then', async () => {
    const { result } = await onAnsweredStep();
    await act(async () => result.current.advanceSoon());
    await act(async () => result.current.setAnswers({ name: '' }));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.screenIndex).toBe(1);
  });

  it('⚠️ never SUBMITS — a pick on the last screen waits for the button', async () => {
    jest.useFakeTimers();
    const onComplete = jest.fn();
    const { result } = await renderHook(() =>
      useWizardController<Answers>(flow, { onExit: jest.fn(), onComplete }),
    );
    await act(async () => result.current.next()); // intro → name, the last screen
    await act(async () => result.current.setAnswers({ name: 'Jane' }));
    await act(async () => result.current.advanceSoon());
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('never runs under a screen reader', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    const { result } = await onAnsweredStep();
    await act(async () => result.current.advanceSoon());
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.screenIndex).toBe(1);
  });
});

// 2026-10-08: changing the make from review clears the model. Done used to drop
// the owner back on a review that now refused to submit.
describe('an edit from review that breaks another answer', () => {
  interface CarAnswers {
    make: string;
    model: string;
  }
  const carFlow: WizardFlow<CarAnswers> = {
    id: 'car-edit-test',
    finalCtaLabel: 'Post',
    review: {},
    phases: [
      {
        id: 'car',
        title: 'Car',
        steps: [
          { id: 'make', question: 'Make?', component: () => null, schema: z.object({ make: z.string().min(1) }) },
          { id: 'model', question: 'Model?', component: () => null, schema: z.object({ model: z.string().min(1) }) },
        ],
      },
    ],
  };
  // make(0), model(1), review(2)
  async function onReviewEditingMake() {
    const rendered = await renderHook(() =>
      useWizardController<CarAnswers>(carFlow, {
        onExit: jest.fn(),
        initialAnswers: { make: 'BMW', model: '320d' },
      }),
    );
    const { result } = rendered;
    await act(async () => result.current.next());
    await act(async () => result.current.next()); // review
    await act(async () => result.current.editStep(0)); // edit the make
    await act(async () => result.current.setAnswers({ make: 'Audi', model: '' })); // clears the model
    return rendered;
  }

  it('Done goes on to the answer it broke, still on the edit (Done again)', async () => {
    const { result } = await onReviewEditingMake();
    await act(async () => result.current.next());
    expect(result.current.screenIndex).toBe(1); // the model step
    expect(result.current.ctaLabel).toBe('Done');

    await act(async () => result.current.setAnswers({ model: 'A4' }));
    await act(async () => result.current.next());
    expect(result.current.screenIndex).toBe(2); // back on review
  });

  // Security review of #143: Done can return to review, putting "Post & pay"
  // where "Done" was — so on a spur the owner presses Done themselves.
  it('⚠️ never auto-advances on an edit — a tap meant for Done must not land on pay', async () => {
    jest.useFakeTimers();
    try {
      const { result } = await onReviewEditingMake();
      await act(async () => result.current.setAnswers({ make: 'BMW', model: '320d' })); // nothing broken
      await act(async () => result.current.advanceSoon());
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      expect(result.current.screenIndex).toBe(0); // still on the spur
    } finally {
      jest.useRealTimers();
    }
  });

  it('Back from there cancels the WHOLE edit — make and model restored', async () => {
    const { result } = await onReviewEditingMake();
    await act(async () => result.current.next()); // on to the model step
    await act(async () => result.current.back());
    expect(result.current.screenIndex).toBe(2);
    expect(result.current.answers).toEqual({ make: 'BMW', model: '320d' });
  });
});

describe('useWizardController', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('merges answer patches and unlocks Next when the schema passes', async () => {
    const { result } = await renderController(jest.fn());

    await act(async () => result.current.next()); // intro → name step
    expect(result.current.canGoNext).toBe(false);

    await act(async () => result.current.setAnswers({ name: 'Jane' }));
    expect(result.current.answers).toEqual({ name: 'Jane' });
    expect(result.current.canGoNext).toBe(true);
  });

  it('exits immediately when nothing has been entered', async () => {
    const onExit = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { result } = await renderController(onExit);

    await act(async () => result.current.requestExit());

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('confirms before a dirty exit and only exits on Discard', async () => {
    const onExit = jest.fn();
    let buttons: AlertButton[] = [];
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, alertButtons) => {
      buttons = alertButtons ?? [];
    });
    const { result } = await renderController(onExit);

    await act(async () => result.current.setAnswers({ name: 'J' }));
    await act(async () => result.current.requestExit());

    expect(onExit).not.toHaveBeenCalled();
    expect(buttons.map((button) => button.text)).toEqual(['Keep editing', 'Discard']);

    await act(async () => buttons.find((button) => button.text === 'Discard')?.onPress?.());
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('restores the pre-edit answer when the user backs out of a review edit', async () => {
    const { result } = await renderController(jest.fn());

    await act(async () => result.current.next()); // intro → name step
    await act(async () => result.current.setAnswers({ name: 'Jane' }));

    // Jump into an edit as if from review, damage the answer, then cancel.
    await act(async () => result.current.editStep(1));
    await act(async () => result.current.setAnswers({ name: '' }));
    await act(async () => result.current.back());

    expect(result.current.answers).toEqual({ name: 'Jane' });
    expect(result.current.isEditingFromReview).toBe(false);
  });

  it('⚠️ a spur into an intro-less flow’s FIRST step is not the first screen', async () => {
    // The report flow's check-and-send sends the spotter back to its camera
    // (index 0). As "first screen" that spur hid Back, and the hardware back
    // offered to discard the whole report instead of cancelling the edit.
    const speedFlow: WizardFlow<Answers> = {
      id: 'speed-test',
      finalCtaLabel: 'Send report',
      phases: [
        {
          id: 'only',
          title: 'Report',
          steps: [
            { id: 'name', question: 'Name?', component: () => null, schema: z.object({}) },
            { id: 'check', question: 'Check', component: () => null, schema: z.object({}) },
          ],
        },
      ],
    };
    const { result } = await renderHook(() =>
      useWizardController<Answers>(speedFlow, { onExit: jest.fn() }),
    );
    expect(result.current.isFirstScreen).toBe(true);

    await act(async () => result.current.next()); // → check
    await act(async () => result.current.editStep(0));
    expect(result.current.screenIndex).toBe(0);
    expect(result.current.isFirstScreen).toBe(false);
    expect(result.current.ctaLabel).toBe('Done');
    expect(result.current.isLastScreen).toBe(false);

    await act(async () => result.current.back()); // cancels, back to check
    expect(result.current.screenIndex).toBe(1);
    expect(result.current.isLastScreen).toBe(true);
  });

  it('keeps an edited answer when the edit is completed with Next', async () => {
    const { result } = await renderController(jest.fn());

    await act(async () => result.current.next());
    await act(async () => result.current.setAnswers({ name: 'Jane' }));
    await act(async () => result.current.editStep(1));
    await act(async () => result.current.setAnswers({ name: 'Joan' }));
    await act(async () => result.current.next());

    expect(result.current.answers).toEqual({ name: 'Joan' });
  });

  it('still confirms when the entered text was deleted again', async () => {
    const onExit = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { result } = await renderController(onExit);

    await act(async () => result.current.setAnswers({ name: 'J' }));
    await act(async () => result.current.setAnswers({ name: '' }));
    await act(async () => result.current.requestExit());

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
  });
});

// --- Async primary-button actions (onContinue + onComplete) ------------------

interface AsyncAnswers {
  plate: string;
  make: string;
}

/**
 * A flow whose single step carries an onContinue and whose review is the final
 * screen (so onComplete fires there). The onContinue/onComplete behaviours are
 * injected per test. Screens flatten to: 0 intro, 1 plate step, 2 review.
 */
function makeAsyncFlow(overrides: {
  onContinue?: (answers: Partial<AsyncAnswers>) => Promise<Partial<AsyncAnswers> | void>;
}): WizardFlow<AsyncAnswers> {
  return {
    id: 'async-test',
    finalCtaLabel: 'Post',
    review: { title: 'Check' },
    phases: [
      {
        id: 'car',
        title: 'Car',
        intro: { headline: 'Your car', body: 'One question.' },
        steps: [
          {
            id: 'plate',
            question: "What's the plate?",
            component: () => null,
            schema: z.object({ plate: z.string().min(1) }),
            reviewValue: (a) => a.plate ?? '',
            onContinue: overrides.onContinue,
          },
        ],
      },
    ],
  };
}

async function renderAsyncController(
  flow: WizardFlow<AsyncAnswers>,
  onComplete?: (answers: Partial<AsyncAnswers>) => void | Promise<void>,
) {
  const rendered = await renderHook(() =>
    useWizardController<AsyncAnswers>(flow, { onExit: jest.fn(), onComplete }),
  );
  // Walk intro → plate step and enter a valid plate so advance() is unblocked.
  await act(async () => rendered.result.current.next());
  await act(async () => rendered.result.current.setAnswers({ plate: 'AB12CDE' }));
  return rendered;
}

describe('useWizardController — async actions', () => {
  afterEach(() => jest.restoreAllMocks());

  it('runs onContinue, merges its returned patch, then advances', async () => {
    const onContinue = jest.fn(async () => ({ make: 'BMW' }));
    const flow = makeAsyncFlow({ onContinue });
    const { result } = await renderAsyncController(flow);

    await act(async () => result.current.advance());

    expect(onContinue).toHaveBeenCalledWith({ plate: 'AB12CDE' });
    expect(result.current.answers).toEqual({ plate: 'AB12CDE', make: 'BMW' });
    expect(result.current.screenIndex).toBe(2); // advanced to review
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('surfaces a thrown onContinue error and stays on the step', async () => {
    const onContinue = jest.fn(async () => {
      throw new Error('That plate already has an active post.');
    });
    const { result } = await renderAsyncController(makeAsyncFlow({ onContinue }));

    await act(async () => result.current.advance());

    expect(result.current.error).toBe('That plate already has an active post.');
    expect(result.current.screenIndex).toBe(1); // did not advance
    expect(result.current.busy).toBe(false);
    expect(result.current.answers).toEqual({ plate: 'AB12CDE' }); // no patch merged
  });

  it('shows busy while onContinue is in flight and ignores a second press', async () => {
    const gate = deferred<Partial<AsyncAnswers>>();
    const onContinue = jest.fn(() => gate.promise);
    const { result } = await renderAsyncController(makeAsyncFlow({ onContinue }));

    let inFlight!: Promise<void>;
    await act(async () => {
      inFlight = result.current.advance();
    });
    expect(result.current.busy).toBe(true);

    // A second press while busy must not fire a second lookup.
    await act(async () => result.current.advance());
    expect(onContinue).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve({ make: 'Audi' });
      await inFlight;
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.screenIndex).toBe(2);
  });

  it('clears a stale onContinue error when the answer is edited', async () => {
    const onContinue = jest.fn(async () => {
      throw new Error('Plate in use.');
    });
    const { result } = await renderAsyncController(makeAsyncFlow({ onContinue }));

    await act(async () => result.current.advance());
    expect(result.current.error).toBe('Plate in use.');

    await act(async () => result.current.setAnswers({ plate: 'XY99ZZZ' }));
    expect(result.current.error).toBeNull();
  });

  it('runs onComplete on the final screen and holds the spinner on success', async () => {
    const gate = deferred<void>();
    const onComplete = jest.fn(() => gate.promise);
    // No onContinue, so advancing the plate step just moves to review.
    const { result } = await renderAsyncController(makeAsyncFlow({}), onComplete);

    await act(async () => result.current.advance()); // plate → review
    expect(result.current.screenIndex).toBe(2);
    await waitForSubmitArm();

    let submit!: Promise<void>;
    await act(async () => {
      submit = result.current.advance(); // review → submit
    });
    expect(onComplete).toHaveBeenCalledWith({ plate: 'AB12CDE' });
    expect(result.current.busy).toBe(true);

    await act(async () => {
      gate.resolve();
      await submit;
    });
    // Success does NOT navigate and keeps the spinner up (onComplete routes away).
    expect(result.current.busy).toBe(true);
    expect(result.current.screenIndex).toBe(2);
  });

  // Security review of #142: under reduced motion there is no move lock, so a
  // double-tapped Next on the screen before could land on the submit.
  it('⚠️ ignores the submit for a moment after arriving — a double tap is not a payment', async () => {
    const onComplete = jest.fn();
    const { result } = await renderAsyncController(makeAsyncFlow({}), onComplete);
    await act(async () => result.current.advance()); // plate → review
    await act(async () => result.current.advance()); // the double tap's second half
    expect(onComplete).not.toHaveBeenCalled();

    await waitForSubmitArm();
    await act(async () => result.current.advance());
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  // Confirming review of #143: a step's Skip during an onContinue lookup moved,
  // and then the lookup's own move went one further — a screen skipped.
  it('a step’s Skip does nothing while a lookup is running — the lookup moves', async () => {
    const lookup = deferred<undefined>();
    const { result } = await renderAsyncController(
      makeAsyncFlow({ onContinue: () => lookup.promise }),
      jest.fn(),
    );
    await act(async () => {
      void result.current.advance(); // the lookup starts
    });
    await act(async () => result.current.next()); // Skip, mid-lookup
    expect(result.current.screenIndex).toBe(1);

    await act(async () => lookup.resolve(undefined));
    expect(result.current.screenIndex).toBe(2); // one move, not two
  });

  it('keeps the wizard intact and shows the error when onComplete fails', async () => {
    const onComplete = jest.fn(async () => {
      throw new Error('Payment could not be taken. Please try again.');
    });
    const { result } = await renderAsyncController(makeAsyncFlow({}), onComplete);

    await act(async () => result.current.advance()); // plate → review
    await waitForSubmitArm();
    await act(async () => result.current.advance()); // submit (fails)

    expect(result.current.error).toBe('Payment could not be taken. Please try again.');
    expect(result.current.busy).toBe(false);
    expect(result.current.screenIndex).toBe(2); // still on review, answers intact
    expect(result.current.answers).toEqual({ plate: 'AB12CDE' });
    expect(result.current.canGoNext).toBe(true); // can retry immediately
  });
});

// ---------------------------------------------------------------------------
// ⚠️ Review #19. This hook carried a TODO(draft-persistence) at the exit prompt
// from the day it was written — "discard is the only exit" — and the flow it
// most mattered for is nine steps ending in a Stripe charge. An owner whose car
// was taken that morning lost all of it to a phone call.
// ---------------------------------------------------------------------------
describe('save & exit', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function renderWithSave(onExit: () => void, onSaveAndExit: (a: unknown) => void) {
    return renderHook(() =>
      useWizardController<Answers>(flow, { onExit, onSaveAndExit }),
    );
  }

  it('offers a third way out, with Discard still the destructive one', async () => {
    let buttons: AlertButton[] = [];
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, alertButtons) => {
      buttons = alertButtons ?? [];
    });
    const { result } = await renderWithSave(jest.fn(), jest.fn());

    await act(async () => result.current.setAnswers({ name: 'J' }));
    await act(async () => result.current.requestExit());

    expect(buttons.map((button) => button.text)).toEqual([
      'Keep editing',
      'Discard',
      'Save & exit',
    ]);
    // The safe option must not be the one styled as dangerous.
    expect(buttons.find((b) => b.text === 'Discard')?.style).toBe('destructive');
    expect(buttons.find((b) => b.text === 'Save & exit')?.style).toBeUndefined();
  });

  it('Discard calls onDiscard before leaving; a clean exit does not', async () => {
    const onExit = jest.fn();
    const onDiscard = jest.fn();
    let buttons: AlertButton[] = [];
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, alertButtons) => {
      buttons = alertButtons ?? [];
    });
    const { result } = await renderHook(() =>
      useWizardController<Answers>(flow, { onExit, onSaveAndExit: jest.fn(), onDiscard }),
    );

    // Nothing entered: leaving is not discarding anything.
    await act(async () => result.current.requestExit());
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledTimes(1);

    await act(async () => result.current.setAnswers({ name: 'J' }));
    await act(async () => result.current.requestExit());
    await act(async () => buttons.find((b) => b.text === 'Discard')?.onPress?.());
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(2);
  });

  it('hands over the CURRENT answers, then leaves', async () => {
    const onExit = jest.fn();
    const onSaveAndExit = jest.fn();
    let buttons: AlertButton[] = [];
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, alertButtons) => {
      buttons = alertButtons ?? [];
    });
    const { result } = await renderWithSave(onExit, onSaveAndExit);

    await act(async () => result.current.setAnswers({ name: 'Jane' }));
    await act(async () => result.current.requestExit());
    await act(async () => buttons.find((b) => b.text === 'Save & exit')?.onPress?.());

    // ⚠️ The newest answers, not the ones closed over when the prompt was
    // built: requestExit is memoised without `answers` (it is handed to a
    // header button and the Android back handler), so the callback reads a ref.
    expect(onSaveAndExit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Jane' }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('⚠️ leaves even when the save fails', async () => {
    // An exit the owner has already asked for must happen. A rejected write
    // that stranded them in the wizard would be a trap.
    const onExit = jest.fn();
    let buttons: AlertButton[] = [];
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, alertButtons) => {
      buttons = alertButtons ?? [];
    });
    const { result } = await renderWithSave(onExit, () => Promise.reject(new Error('disk full')));

    await act(async () => result.current.setAnswers({ name: 'J' }));
    await act(async () => result.current.requestExit());
    await act(async () => buttons.find((b) => b.text === 'Save & exit')?.onPress?.());

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('⚠️ a flow without it keeps the old two-way prompt exactly', async () => {
    // Report-a-sighting and add-a-vehicle are short; a draft there would be
    // more machinery than the thing it saves, and offering "Save" where
    // nothing saves would be a lie.
    let buttons: AlertButton[] = [];
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, alertButtons) => {
      buttons = alertButtons ?? [];
    });
    const { result } = await renderController(jest.fn());

    await act(async () => result.current.setAnswers({ name: 'J' }));
    await act(async () => result.current.requestExit());

    expect(buttons.map((button) => button.text)).toEqual(['Keep editing', 'Discard']);
  });
});
