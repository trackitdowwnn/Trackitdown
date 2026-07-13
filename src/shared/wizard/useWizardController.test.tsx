/**
 * WHAT:  Tests for the wizard controller hook — answer merging, gating
 *        recomputation, the dirty-exit confirmation path (clean exits leave
 *        silently; dirty exits confirm, and only Discard exits), and the
 *        async primary-button behaviour: a step's onContinue (merge-then-
 *        advance, error-then-stay) and the final onComplete (success holds the
 *        spinner without navigating; failure keeps the wizard intact for retry).
 * WHY:   The exit path guards user-entered data across every flow built on
 *        the framework; silently discarding a half-finished post would be a
 *        trust failure. The async path is the post-a-car wizard's spine —
 *        losing a completed wizard to a network blip is the unforgivable
 *        failure, so submit-failure-stays-intact is covered here explicitly.
 *        Navigation itself is covered in navigation.test.ts.
 * LINKS: src/shared/wizard/useWizardController.ts, docs/TESTING.md.
 */

import { act, renderHook } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import { z } from 'zod';

import type { WizardFlow } from './types';
import { useWizardController } from './useWizardController';

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

  it('keeps the wizard intact and shows the error when onComplete fails', async () => {
    const onComplete = jest.fn(async () => {
      throw new Error('Payment could not be taken. Please try again.');
    });
    const { result } = await renderAsyncController(makeAsyncFlow({}), onComplete);

    await act(async () => result.current.advance()); // plate → review
    await act(async () => result.current.advance()); // submit (fails)

    expect(result.current.error).toBe('Payment could not be taken. Please try again.');
    expect(result.current.busy).toBe(false);
    expect(result.current.screenIndex).toBe(2); // still on review, answers intact
    expect(result.current.answers).toEqual({ plate: 'AB12CDE' });
    expect(result.current.canGoNext).toBe(true); // can retry immediately
  });
});
