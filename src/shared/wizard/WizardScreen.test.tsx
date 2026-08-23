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
import {
  AccessibilityInfo,
  Alert,
  BackHandler,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
} from 'react-native';
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
  return function StepBody({ setAnswers, onSkip }: WizardStepProps<Answers>) {
    return (
      <>
        <Pressable testID={`fill-${field}`} onPress={() => setAnswers({ [field]: fillValue })}>
          <Text>fill {field}</Text>
        </Pressable>
        <Pressable testID={`skip-${field}`} onPress={() => onSkip?.()}>
          <Text>skip {field}</Text>
        </Pressable>
      </>
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

  it('a step can advance past its disabled Next via onSkip', async () => {
    const { view } = await renderWizard();
    await press(view, 'Get started');

    // Unfilled step → Next is disabled…
    expect(
      view.getByRole('button', { name: 'Next' }).props.accessibilityState,
    ).toMatchObject({ disabled: true });

    // …but the step's own Skip affordance advances anyway.
    await act(async () => {
      fireEvent.press(view.getByTestId('skip-name'));
    });
    expect(view.getByText('Your preferences')).toBeTruthy();
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

  it('⚠️ announces the review EXACTLY ONCE on landing', async () => {
    // ReviewStep used to announce the blocking notice itself, in the same commit
    // as this title — React flushes child effects before parents — and iOS
    // VoiceOver interrupts an in-flight announcement, so the title was cut off
    // at the moment it mattered most. The notice now travels INSIDE this string
    // (see WizardScreen's `announcement`), so there is only ever one utterance.
    //
    // Scope note: this walks a fully-answered flow, so it pins the count, not
    // the concatenation. blockingNotice's own copy is unit-tested in
    // ReviewStep.test.tsx — a blocked review is not reachable through this
    // harness, because every step gates its own Next.
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
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
    announce.mockClear();
    await press(view, 'Next');

    // Everything answered: the title alone, and exactly once.
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Check your answers');
    announce.mockRestore();
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

/**
 * `fills` — the step mode that lets a map reach the footer.
 *
 * These assert LAYOUT, which this suite otherwise avoids, because the failure
 * mode is invisible everywhere else. The default ScrollView grows its CONTENT
 * CONTAINER, not the step body, so a `flex: 1` child inside it collapses to
 * zero and a map silently falls back to its minHeight. That is not a crash, not
 * a failed assertion, and not visible in any other test — it just quietly
 * un-does the feature. It has already happened once, when AreaStep's own
 * wrapper was left without `flex` and the map sat at its floor with dead space
 * under the slider.
 */
describe('fills steps', () => {
  const fillsFlow: WizardFlow<Answers> = {
    id: 'fills-test',
    finalCtaLabel: 'Publish',
    phases: [
      {
        id: 'only',
        title: 'Only',
        steps: [
          {
            id: 'map',
            question: 'Where?',
            fills: true,
            component: makeStep('name', 'Jane'),
            schema: z.object({}),
          },
          {
            id: 'plain',
            question: 'And?',
            component: makeStep('colour', 'Sage'),
            schema: z.object({}),
          },
        ],
      },
    ],
  };

  const renderFills = () =>
    render(<WizardScreen flow={fillsFlow} onExit={jest.fn()} onComplete={jest.fn()} />);

  /** Drive the text scale: a fills step gives up filling at large sizes. */
  const setFontScale = (fontScale: number) =>
    jest
      .spyOn(Dimensions, 'get')
      .mockReturnValue({ width: 390, height: 844, scale: 2, fontScale });

  beforeEach(() => setFontScale(1));

  it('renders a fills step WITHOUT a ScrollView, so a flex child can grow', async () => {
    const view = await renderFills();
    expect(view.getByTestId('wizard-step-fills')).toBeTruthy();
    expect(view.queryByTestId('wizard-step-scroll')).toBeNull();
  });

  it('gives a fills step its scroller back at large text sizes', async () => {
    // A fills step has no scroll rescue by design. At accessibility text sizes
    // the headline grows, the map will not shrink past its minHeight and a
    // slider below it has nowhere to go — so the content would run off a
    // container that cannot scroll. A big-text user loses the full-bleed map
    // and keeps a reachable screen, which is the right way round.
    setFontScale(1.6);
    const view = await renderFills();
    expect(view.getByTestId('wizard-step-scroll')).toBeTruthy();
    expect(view.queryByTestId('wizard-step-fills')).toBeNull();
  });

  it('still scrolls an ordinary step', async () => {
    // The opt-in must stay an opt-in: every other step in every other flow
    // keeps its scroller, or long steps become unreachable on small screens.
    const view = await renderFills();
    await press(view, 'Next');
    expect(view.getByTestId('wizard-step-scroll')).toBeTruthy();
    expect(view.queryByTestId('wizard-step-fills')).toBeNull();
  });

  it('gives the step body flex so the chain reaches the child', async () => {
    // The specific regression: a body without `flex: 1` leaves a flex:1 map
    // measuring against a content-sized parent, and it collapses to minHeight.
    const view = await renderFills();
    const body = view.getByTestId('fill-name').parent;
    const flattened = StyleSheet.flatten(body?.props?.style);
    expect(flattened).toMatchObject({ flex: 1 });
  });

  it('does not slide a fills step, and does slide an ordinary one', async () => {
    // A fills step can swap its subtree after mount (a map waiting for its
    // opening centre). That stranded the entering transform and left the step
    // permanently offset to the right, with the footer — which lives outside
    // the animated wrapper — staying put.
    const view = await renderFills();
    expect(view.getByTestId('wizard-step-slide').props.entering).toBeUndefined();

    await press(view, 'Next');
    expect(view.getByTestId('wizard-step-slide').props.entering).toBeDefined();
  });
});
