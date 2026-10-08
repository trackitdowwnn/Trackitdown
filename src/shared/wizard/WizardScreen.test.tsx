/**
 * WHAT:  Wiring tests for WizardScreen — the controller↔chrome integration
 *        the unit suites can't see: intro renders with Back hidden, zod
 *        gating disables/enables the primary button, the review Edit link
 *        jumps and Done returns, Android hardware back mirrors in-flow Back
 *        (exit-confirm on the first screen), step-launched edit spurs (Back
 *        and hardware back cancel a spur into the first screen), and where a
 *        step's footerNote renders (footer, or the body at large text). And
 *        the moves themselves (2026-10-08): a leaving screen exits the way
 *        the move goes, a map step's neighbour fades, one move at a time, the
 *        keyboard drops on every move.
 * WHY:   navigation.test.ts proves the logic and this file proves the
 *        screen actually obeys it; a wiring slip (wrong prop, missing
 *        handler) would ship a wizard whose buttons lie.
 * LINKS: src/shared/wizard/WizardScreen.tsx, docs/TESTING.md (Tier 2
 *        screen states).
 */

import { act, fireEvent, render, within } from '@testing-library/react-native';
import {
  AccessibilityInfo,
  Alert,
  BackHandler,
  Dimensions,
  Keyboard,
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

// Mock at the boundary: WizardScreen needs Animated.View, the layout
// animation builders, LayoutAnimationConfig and the progress bar's shared
// values. Each builder carries its NAME, and Animated.View records the
// `exiting` it had on its LAST render before unmounting — the one Reanimated
// actually plays, and the whole of the exit-direction bug.
const mockUnmountedExits: (string | undefined)[] = [];
let mockReduceMotion = true;
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { View } = require('react-native');
  const builder = (name: string) => {
    const chain: Record<string, unknown> = { __name: name };
    chain.duration = () => chain;
    chain.easing = () => chain;
    chain.reduceMotion = () => chain;
    return chain;
  };
  function MockAnimatedView(props: { exiting?: { __name?: string } }) {
    const last = React.useRef(props);
    last.current = props;
    React.useEffect(
      () => () => {
        mockUnmountedExits.push(last.current.exiting?.__name);
      },
      [],
    );
    return React.createElement(View, props);
  }
  return {
    __esModule: true,
    default: { View: MockAnimatedView },
    Easing: { out: (fn: unknown) => fn, quad: () => 0, cubic: () => 0 },
    ReduceMotion: { System: 'system' },
    SlideInLeft: builder('SlideInLeft'),
    SlideInRight: builder('SlideInRight'),
    SlideOutLeft: builder('SlideOutLeft'),
    SlideOutRight: builder('SlideOutRight'),
    FadeIn: builder('FadeIn'),
    FadeOut: builder('FadeOut'),
    LayoutAnimationConfig: ({ children }: { children: unknown }) => children,
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: (fn: () => object) => fn(),
    withTiming: (value: unknown) => value,
    // Deterministic by default: no transition lock. The lock's own tests
    // turn motion back on.
    useReducedMotion: () => mockReduceMotion,
  };
});

/** The builder name an entering/exiting prop carries in this double. */
const animName = (value: unknown) => (value as { __name?: string } | undefined)?.__name;

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
    // Several phases: the bar is named by the phase it is in.
    expect(view.getByLabelText('About you, part 1 of 2')).toBeTruthy();
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
    expect(view.getByLabelText('Preferences, part 2 of 2')).toBeTruthy();
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

  it('⚠️ registers hardware back ONCE, however the answers and screens change', async () => {
    // Re-registering on each change put the wizard's handler above an open
    // step sheet's (Android runs the newest first), so Back stepped the
    // wizard with the sheet still up.
    const addSpy = jest.spyOn(BackHandler, 'addEventListener');
    try {
      const { view } = await renderWizard();
      await press(view, 'Get started');
      await act(async () => {
        fireEvent.press(view.getByTestId('fill-name'));
      });
      expect(addSpy.mock.calls.filter(([event]) => event === 'hardwareBackPress')).toHaveLength(1);
    } finally {
      addSpy.mockRestore();
    }
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

  it('never animates a fills step; its neighbour FADES rather than slides', async () => {
    // A fills step can swap its subtree after mount (a map waiting for its
    // opening centre). That stranded the entering transform and left the step
    // permanently offset to the right, with the footer — which lives outside
    // the animated wrapper — staying put. And a neighbour sliding across a map
    // that is simply there read as the app lurching (2026-10-08).
    mockUnmountedExits.length = 0;
    const view = await renderFills();
    expect(view.getByTestId('wizard-step-slide').props.entering).toBeUndefined();

    await press(view, 'Next'); // map → plain
    expect(mockUnmountedExits).toEqual([undefined]); // the map just goes
    expect(animName(view.getByTestId('wizard-step-slide').props.entering)).toBe('FadeIn');

    await press(view, 'Back'); // plain → map
    expect(mockUnmountedExits).toEqual([undefined, 'FadeOut']);
    expect(view.getByTestId('wizard-step-slide').props.entering).toBeUndefined();
  });

  it('⚠️ does not slide the OPENING screen in, but does once the user has moved', async () => {
    // The opening slide raced the route's own slide-up and the safe-area
    // inset: Reanimated finished it on a stale frame, parking the step body
    // over the header, where it swallowed every tap on the X (2026-09-30,
    // report flow). Nothing slides in from anywhere on the first screen.
    const { view } = await renderWizard();
    expect(view.getByTestId('wizard-step-slide').props.entering).toBeUndefined();

    await press(view, 'Get started');
    expect(view.getByTestId('wizard-step-slide').props.entering).toBeDefined();
    await press(view, 'Back');
    // Back on the opening screen by a move: that one slides, as a move should.
    expect(view.getByTestId('wizard-step-slide').props.entering).toBeDefined();
  });
});

describe('the progress bar', () => {
  it('names the STEP in a one-phase flow ("Step 2 of 3"), not the phase', async () => {
    const onePhase: WizardFlow<Answers> = {
      id: 'one-phase',
      finalCtaLabel: 'Send',
      phases: [
        {
          id: 'only',
          title: 'Only',
          steps: [flow.phases[0].steps[0], flow.phases[1].steps[0], { ...flow.phases[0].steps[0], id: 'again' }],
        },
      ],
    };
    const view = await render(<WizardScreen flow={onePhase} onExit={jest.fn()} onComplete={jest.fn()} />);
    expect(view.getByLabelText('Step 1 of 3')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByTestId('fill-name'));
    });
    await press(view, 'Next');
    expect(view.getByLabelText('Step 2 of 3')).toBeTruthy();
  });

  it('stays full while editing from review — a detour is not progress lost', async () => {
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
    await press(view, 'Next'); // review
    const onReview = view.getByLabelText('Review').props.accessibilityValue;

    await act(async () => {
      fireEvent.press(view.getAllByRole('button', { name: /^Edit/ })[0]);
    });
    expect(view.getByText("What's your name?")).toBeTruthy(); // on the spur
    expect(view.getByLabelText('Review').props.accessibilityValue).toEqual(onReview);
  });
});

describe('moving between screens', () => {
  beforeEach(() => {
    mockUnmountedExits.length = 0;
  });
  afterEach(() => {
    mockReduceMotion = true;
    jest.restoreAllMocks();
  });

  // THE bug (2026-10-08, "janky, slow and not smooth"): Reanimated plays a
  // leaving view's exit from its LAST render. When the move and the swap
  // landed in one commit, a screen left by Back still carried the exit from
  // the Next that brought it in — both screens slid left, through each other.
  it('⚠️ a screen left by Back exits to the RIGHT, even though it arrived by Next', async () => {
    const { view } = await renderWizard();
    await press(view, 'Get started'); // intro → name, forwards
    expect(mockUnmountedExits).toEqual(['SlideOutLeft']);

    await press(view, 'Back'); // name → intro, backwards
    expect(mockUnmountedExits).toEqual(['SlideOutLeft', 'SlideOutRight']);
    expect(animName(view.getByTestId('wizard-step-slide').props.entering)).toBe('SlideInLeft');
  });

  it('…and one left by Next after a Back exits to the left again', async () => {
    const { view } = await renderWizard();
    await press(view, 'Get started');
    await press(view, 'Back');
    await press(view, 'Get started');
    expect(mockUnmountedExits).toEqual(['SlideOutLeft', 'SlideOutRight', 'SlideOutLeft']);
    expect(animName(view.getByTestId('wizard-step-slide').props.entering)).toBe('SlideInRight');
  });

  it('drops the keyboard on every move', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const { view } = await renderWizard();
    await press(view, 'Get started');
    expect(dismiss).toHaveBeenCalledTimes(1);
    await press(view, 'Back');
    expect(dismiss).toHaveBeenCalledTimes(2);
  });

  describe('one move at a time', () => {
    beforeEach(() => {
      mockReduceMotion = false;
    });

    /** Longer than one move's transition (motion.standard). */
    const waitOutTheMove = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });

    it('a double-tapped Next moves ONCE', async () => {
      const { view } = await renderWizard();
      await press(view, 'Get started');
      await act(async () => {
        fireEvent.press(view.getByTestId('fill-name'));
      });
      await waitOutTheMove();
      const next = view.getByRole('button', { name: 'Next' });
      await act(async () => {
        fireEvent.press(next);
        fireEvent.press(next);
      });
      // Phase 2's intro, not past it.
      expect(view.getByText('Your preferences')).toBeTruthy();
    });

    it('ignores the hardware back during a move, then honours it', async () => {
      const handlers: (() => boolean)[] = [];
      jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
        handlers.push(handler as () => boolean);
        return { remove: jest.fn() };
      });
      const { view } = await renderWizard();
      await press(view, 'Get started');

      await act(async () => {
        handlers.forEach((handler) => handler());
      });
      expect(view.getByText("What's your name?")).toBeTruthy(); // still here

      await waitOutTheMove();
      await act(async () => {
        handlers.forEach((handler) => handler());
      });
      expect(view.getByText('Tell us about you')).toBeTruthy();
    });

    it('ignores the hardware back on the FIRST screen during a move — it would leave the flow', async () => {
      const handlers: (() => boolean)[] = [];
      jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
        handlers.push(handler as () => boolean);
        return { remove: jest.fn() };
      });
      const { view, onExit } = await renderWizard();
      await press(view, 'Get started');
      await waitOutTheMove();
      await press(view, 'Back'); // back on the first screen, mid-move

      await act(async () => {
        handlers.forEach((handler) => handler());
      });
      expect(onExit).not.toHaveBeenCalled();
    });

    it('tells the step when its move has finished', async () => {
      const seen: (boolean | undefined)[] = [];
      const Probe = ({ settled }: WizardStepProps<Answers>) => {
        seen.push(settled);
        return null;
      };
      const probeFlow: WizardFlow<Answers> = {
        ...flow,
        phases: [{ ...flow.phases[0], steps: [{ ...flow.phases[0].steps[0], component: Probe }] }],
      };
      const view = await render(
        <WizardScreen flow={probeFlow} onExit={jest.fn()} onComplete={jest.fn()} />,
      );
      await press(view, 'Get started');
      expect(seen[0]).toBe(false); // mounted mid-move
      await waitOutTheMove();
      expect(seen[seen.length - 1]).toBe(true);
    });
  });
});

/**
 * Step-launched edit spurs (2026-10-02) — a flow with no review screen whose
 * LAST step is its own check-and-send (the report flow's ConfirmStep) and
 * sends the user back to change one thing via `editStep`.
 *
 * Intro-less on purpose: the spur's target is the FIRST screen, which is the
 * case that broke (isFirstScreen hid Back and the hardware back offered to
 * discard the whole flow instead of cancelling the edit).
 */
describe('step-launched edit spurs', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function FirstStep({ setAnswers, editStep }: WizardStepProps<Answers>) {
    return (
      <>
        <Pressable testID="fill-name" onPress={() => setAnswers({ name: 'Jane' })}>
          <Text>fill name</Text>
        </Pressable>
        <Text>{editStep ? 'can-edit' : 'no-edit'}</Text>
      </>
    );
  }

  function CheckStep({ answers, editStep, busy }: WizardStepProps<Answers>) {
    return (
      <>
        <Text>Name is {answers.name ?? 'unset'}</Text>
        <Text>{busy ? 'busy' : 'idle'}</Text>
        <Pressable testID="edit-name" onPress={() => editStep?.('name')}>
          <Text>edit name</Text>
        </Pressable>
        <Pressable testID="edit-unknown" onPress={() => editStep?.(['nope', 'name'])}>
          <Text>edit by fallback</Text>
        </Pressable>
      </>
    );
  }

  const speedFlow: WizardFlow<Answers> = {
    id: 'spur-test',
    finalCtaLabel: 'Send report',
    phases: [
      {
        id: 'only',
        title: 'Report',
        steps: [
          {
            id: 'name',
            question: "What's your name?",
            component: FirstStep,
            schema: z.object({ name: z.string().min(1) }),
            ctaLabel: 'Continue',
          },
          {
            id: 'check',
            question: 'Check and send',
            component: CheckStep,
            schema: z.object({ name: z.string().min(1) }),
            footerNote: 'Only the owner sees this.',
          },
        ],
      },
    ],
  };

  async function renderSpurFlow(onComplete: jest.Mock = jest.fn()) {
    const onExit = jest.fn();
    const view = await render(
      <WizardScreen flow={speedFlow} onExit={onExit} onComplete={onComplete} />,
    );
    await act(async () => {
      fireEvent.press(view.getByTestId('fill-name'));
    });
    await press(view, 'Continue');
    expect(view.getByText('Check and send')).toBeTruthy();
    return { view, onExit };
  }

  it('Edit jumps to the step, the CTA reads Done, and Done returns to the check', async () => {
    const { view } = await renderSpurFlow();
    await act(async () => {
      fireEvent.press(view.getByTestId('edit-name'));
    });
    expect(view.getByText("What's your name?")).toBeTruthy();
    expect(view.getByRole('button', { name: 'Done' })).toBeTruthy();

    await press(view, 'Done');
    expect(view.getByText('Check and send')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Send report' })).toBeTruthy();
  });

  it('takes the first step id that exists from a list', async () => {
    const { view } = await renderSpurFlow();
    await act(async () => {
      fireEvent.press(view.getByTestId('edit-unknown'));
    });
    expect(view.getByText("What's your name?")).toBeTruthy();
  });

  it('⚠️ shows Back on a spur into the FIRST screen, and Back cancels the edit', async () => {
    const { view } = await renderSpurFlow();
    await act(async () => {
      fireEvent.press(view.getByTestId('edit-name'));
    });
    await press(view, 'Back');
    expect(view.getByText('Check and send')).toBeTruthy();
    expect(view.getByText('Name is Jane')).toBeTruthy();
  });

  it('⚠️ hardware back on that spur cancels the edit, never offers to discard', async () => {
    let hardwareBack: (() => boolean) | undefined;
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((
      _event: string,
      handler: () => boolean,
    ) => {
      hardwareBack = handler;
      return { remove: jest.fn() };
    }) as unknown as typeof BackHandler.addEventListener);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { view, onExit } = await renderSpurFlow();
    await act(async () => {
      fireEvent.press(view.getByTestId('edit-name'));
    });

    await act(async () => {
      expect(hardwareBack?.()).toBe(true);
    });
    expect(view.getByText('Check and send')).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
  });

  it('offers no editStep while on a spur (no spur from a spur)', async () => {
    const { view } = await renderSpurFlow();
    await act(async () => {
      fireEvent.press(view.getByTestId('edit-name'));
    });
    expect(view.getByText('no-edit')).toBeTruthy();
  });

  it('offers editStep on an ordinary screen', async () => {
    const view = await render(
      <WizardScreen flow={speedFlow} onExit={jest.fn()} onComplete={jest.fn()} />,
    );
    expect(view.getByText('can-edit')).toBeTruthy();
  });

  it('goes inert while the send is in flight', async () => {
    let finish: () => void = () => {};
    const onComplete = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { view } = await renderSpurFlow(onComplete);
    await press(view, 'Send report');
    expect(view.getByText('busy')).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByTestId('edit-name'));
    });
    expect(view.getByText('Check and send')).toBeTruthy();
    await act(async () => {
      finish();
    });
  });

  it('shows a step’s footerNote on that step only', async () => {
    // Ordinary text size (RN's jest Dimensions default is fontScale 2).
    jest
      .spyOn(Dimensions, 'get')
      .mockReturnValue({ width: 390, height: 844, scale: 2, fontScale: 1 });
    const view = await render(
      <WizardScreen flow={speedFlow} onExit={jest.fn()} onComplete={jest.fn()} />,
    );
    expect(view.queryByText('Only the owner sees this.')).toBeNull();
    await act(async () => {
      fireEvent.press(view.getByTestId('fill-name'));
    });
    await press(view, 'Continue');
    expect(view.getByText('Only the owner sees this.')).toBeTruthy();
    // In the fixed footer at ordinary sizes, not in the scrolling body.
    expect(
      within(view.getByTestId('wizard-step-scroll')).queryByText('Only the owner sees this.'),
    ).toBeNull();
  });

  it('moves the footerNote into the scrolling body at large text sizes', async () => {
    // The footer never scrolls: a note wrapped to five lines there ate a third
    // of a small phone. Past the fills threshold it ends the body instead.
    jest
      .spyOn(Dimensions, 'get')
      .mockReturnValue({ width: 390, height: 844, scale: 2, fontScale: 1.6 });
    const view = await render(
      <WizardScreen flow={speedFlow} onExit={jest.fn()} onComplete={jest.fn()} />,
    );
    await act(async () => {
      fireEvent.press(view.getByTestId('fill-name'));
    });
    await press(view, 'Continue');
    expect(
      within(view.getByTestId('wizard-step-scroll')).getByText('Only the owner sees this.'),
    ).toBeTruthy();
    expect(view.getAllByText('Only the owner sees this.')).toHaveLength(1);
  });
});
