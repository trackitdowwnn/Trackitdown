/**
 * WHAT:  Tests for the wizard controller hook — answer merging, gating
 *        recomputation, and the dirty-exit confirmation path (clean exits
 *        leave silently; dirty exits confirm, and only Discard exits).
 * WHY:   The exit path guards user-entered data across every flow built on
 *        the framework; silently discarding a half-finished post would be a
 *        trust failure. Navigation itself is covered in navigation.test.ts.
 * LINKS: src/shared/wizard/useWizardController.ts, docs/TESTING.md.
 */

import { act, renderHook } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import { z } from 'zod';

import type { WizardFlow } from './types';
import { useWizardController } from './useWizardController';

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
