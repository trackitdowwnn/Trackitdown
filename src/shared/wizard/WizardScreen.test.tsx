/**
 * WHAT:  Wiring tests for WizardScreen — the controller↔chrome integration
 *        the unit suites can't see: intro renders with Back hidden, zod
 *        gating disables/enables the primary button, the review Edit link
 *        jumps and Done returns, and Android hardware back mirrors in-flow
 *        Back (exit-confirm on the first screen).
 * WHY:   navigation.test.ts proves the logic and this file proves the
 *        screen actually obeys it; a wiring slip (wrong prop, missing
 *        handler) would ship a wizard whose buttons lie.
 * LINKS: src/shared/wizard/WizardScreen.tsx, docs/TESTING.md (Tier 2
 *        screen states).
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, BackHandler, Pressable, Text } from 'react-native';
import { z } from 'zod';

import type { WizardFlow, WizardStepProps } from './types';
import { WizardScreen } from './WizardScreen';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

// Mock at the boundary: WizardScreen needs Animated.View, the slide
// builders (chainable no-ops here), Easing, and ReduceMotion.
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { View } = require('react-native');
  const builder = () => {
    const chain: Record<string, unknown> = {};
    chain.duration = () => chain;
    chain.easing = () => chain;
    chain.reduceMotion = () => chain;
    return chain;
  };
  return {
    __esModule: true,
    default: { View },
    Easing: { out: (fn: unknown) => fn, quad: () => 0 },
    ReduceMotion: { System: 'system' },
    SlideInLeft: builder(),
    SlideInRight: builder(),
    SlideOutLeft: builder(),
    SlideOutRight: builder(),
    // Deterministic tests: the progress bubble snaps instead of animating.
    useReducedMotion: () => true,
  };
});

interface Answers {
  name: string;
  colour: string;
}

function makeStep(field: keyof Answers, fillValue: string) {
  return function StepBody({ setAnswers }: WizardStepProps<Answers>) {
    return (
      <Pressable testID={`fill-${field}`} onPress={() => setAnswers({ [field]: fillValue })}>
        <Text>fill {field}</Text>
      </Pressable>
    );
  };
}

const flow: WizardFlow<Answers> = {
  id: 'wiring-test',
  finalCtaLabel: 'Publish',
  review: {},
  phases: [
    {
      id: 'about',
      title: 'About you',
      intro: { headline: 'Tell us about you', body: 'Quick questions.' },
      steps: [
        {
          id: 'name',
          question: "What's your name?",
          component: makeStep('name', 'Jane'),
          schema: z.object({ name: z.string().min(1) }),
          reviewLabel: 'Name',
          reviewValue: (answers) => answers.name ?? '',
        },
      ],
    },
    {
      id: 'prefs',
      title: 'Preferences',
      intro: { headline: 'Your preferences', body: 'One more.' },
      steps: [
        {
          id: 'colour',
          question: 'Favourite colour?',
          component: makeStep('colour', 'Sage'),
          schema: z.object({ colour: z.string().min(1) }),
          reviewLabel: 'Colour',
          reviewValue: (answers) => answers.colour ?? '',
        },
      ],
    },
  ],
};

async function renderWizard(overrides: { onExit?: jest.Mock; onComplete?: jest.Mock } = {}) {
  const onExit = overrides.onExit ?? jest.fn();
  const onComplete = overrides.onComplete ?? jest.fn();
  const view = await render(<WizardScreen flow={flow} onExit={onExit} onComplete={onComplete} />);
  return { view, onExit, onComplete };
}

/** Press the primary/labelled button. */
async function press(view: Awaited<ReturnType<typeof render>>, name: string | RegExp) {
  await act(async () => {
    fireEvent.press(view.getByRole('button', { name }));
  });
}

describe('WizardScreen wiring', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens on the first phase intro with Get started and no Back', async () => {
    const { view } = await renderWizard();

    expect(view.getByText('Tell us about you')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Get started' })).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(view.getByRole('button', { name: 'Exit' })).toBeTruthy();
    // 2 phases + review = 3 dots; the a11y label counts phases only.
    expect(view.getByLabelText('Step 1 of 2')).toBeTruthy();
  });

  it('disables Next until the step schema passes, then advances', async () => {
    const { view } = await renderWizard();
    await press(view, 'Get started');

    expect(view.getByText("What's your name?")).toBeTruthy();
    const next = view.getByRole('button', { name: 'Next' });
    expect(next.props.accessibilityState).toMatchObject({ disabled: true });

    await act(async () => {
      fireEvent.press(view.getByTestId('fill-name'));
    });
    expect(
      view.getByRole('button', { name: 'Next' }).props.accessibilityState,
    ).toMatchObject({ disabled: false });

    await press(view, 'Next');
    expect(view.getByText('Your preferences')).toBeTruthy();
    expect(view.getByLabelText('Step 2 of 2')).toBeTruthy();
  });

  it('review Edit jumps to the step and Done returns to review', async () => {
    const { view } = await renderWizard();
    await press(view, 'Get started');
    await act(async () => {
      fireEvent.press(view.getByTestId('fill-name'));
    });
    await press(view, 'Next');
    await press(view, 'Continue');
    await act(async () => {
      fireEvent.press(view.getByTestId('fill-colour'));
    });
    await press(view, 'Next');

    expect(view.getByText('Check your answers')).toBeTruthy();
    expect(view.getByText('Jane')).toBeTruthy();
    expect(view.getByLabelText('Review')).toBeTruthy();

    await press(view, 'Edit Name');
    expect(view.getByText("What's your name?")).toBeTruthy();

    await press(view, 'Done');
    expect(view.getByText('Check your answers')).toBeTruthy();
  });

  it('routes Android hardware back through the wizard: previous screen mid-flow, exit path on the first screen', async () => {
    let hardwareBack: (() => boolean) | undefined;
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((
      _event: string,
      handler: () => boolean,
    ) => {
      hardwareBack = handler;
      return { remove: jest.fn() };
    }) as unknown as typeof BackHandler.addEventListener);
    const { view, onExit } = await renderWizard();

    await press(view, 'Get started');
    expect(view.getByText("What's your name?")).toBeTruthy();

    // Mid-flow: hardware back = in-flow Back, handled (returns true).
    await act(async () => {
      expect(hardwareBack?.()).toBe(true);
    });
    expect(view.getByText('Tell us about you')).toBeTruthy();

    // First screen, clean answers: hardware back exits via the guarded path.
    await act(async () => {
      hardwareBack?.();
    });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('confirms before exiting with dirty answers via the X', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { view, onExit } = await renderWizard();

    await press(view, 'Get started');
    await act(async () => {
      fireEvent.press(view.getByTestId('fill-name'));
    });
    await press(view, 'Exit');

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
  });
});
