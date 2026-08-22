/**
 * WHAT:  Tests for the wizard's review screen — which rows appear, the two
 *        optional slots, and edit-jump by id.
 * WHY:   This screen is the last thing between a person and a card charge, and
 *        it had no test file at all until 2026-08-22. The row-visibility rules
 *        in particular are subtle and money-facing: a step walked past by
 *        `when` normally KEEPS its review row on purpose, and opts out only
 *        when its answer is a seed nobody chose. Getting that backwards shows
 *        a sum that will never be charged next to the one that will.
 * LINKS: ./ReviewStep.tsx; ./navigation.ts (reviewGroups, stepFlatIndex);
 *        src/features/vehicles/post/postACarFlow.tsx (the flow this protects).
 */

import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { z } from 'zod';

import { ReviewStep } from './ReviewStep';
import type { WizardFlow } from './types';

interface DemoAnswers {
  name: string;
  colour: string;
  reward: string;
  mode: 'reward' | 'fee';
}

const Noop = () => null;

/** Screens: 0 intro · 1 name · 2 colour · 3 intro · 4 mode · 5 reward · 6 review. */
function buildFlow(overrides: Partial<WizardFlow<DemoAnswers>> = {}): WizardFlow<DemoAnswers> {
  return {
    id: 'test-flow',
    finalCtaLabel: 'Publish',
    review: { title: 'Check your answers' },
    phases: [
      {
        id: 'about',
        title: 'About you',
        intro: { headline: 'About you', body: 'Two questions.' },
        steps: [
          {
            id: 'name',
            question: "What's your name?",
            component: Noop,
            schema: z.object({ name: z.string() }),
            reviewValue: (a) => a.name ?? '',
          },
          {
            id: 'colour',
            question: 'Favourite colour?',
            component: Noop,
            schema: z.object({ colour: z.string() }),
            reviewValue: (a) => a.colour ?? '',
          },
        ],
      },
      {
        id: 'money',
        title: 'Reward',
        intro: { headline: 'Reward', body: 'One question.' },
        steps: [
          {
            id: 'mode',
            question: 'Offer a reward?',
            component: Noop,
            schema: z.object({ mode: z.enum(['reward', 'fee']) }),
            reviewLabel: 'Listing',
            reviewValue: (a) => (a.mode === 'fee' ? 'No reward' : 'Reward offered'),
          },
          {
            id: 'reward',
            question: 'How much?',
            component: Noop,
            schema: z.object({ reward: z.string() }),
            reviewLabel: 'Reward',
            // Seeded, exactly like the real bounty step — so it has a value
            // even for someone who never saw the question.
            reviewValue: (a) => a.reward ?? '',
            when: (a) => a.mode !== 'fee',
            hideReviewWhenSkipped: true,
          },
        ],
      },
    ],
    ...overrides,
  };
}

const ANSWERS: Partial<DemoAnswers> = {
  name: 'Sam',
  colour: 'Blue',
  mode: 'reward',
  reward: '£250',
};

describe('rows', () => {
  it('shows every answer under its phase heading', async () => {
    const view = await render(<ReviewStep flow={buildFlow()} answers={ANSWERS} onEdit={jest.fn()} />);

    expect(view.getByText('About you')).toBeTruthy();
    expect(view.getByText('Sam')).toBeTruthy();
    expect(view.getByText('Blue')).toBeTruthy();
    expect(view.getByText('£250')).toBeTruthy();
  });

  it('falls back to an em-dash rather than an empty row', async () => {
    const view = await render(<ReviewStep flow={buildFlow()} answers={{ ...ANSWERS, colour: '' }} onEdit={jest.fn()} />);

    expect(view.getByText('—')).toBeTruthy();
  });

  it('⚠️ HIDES a skipped step that opted out, and its now-empty group', async () => {
    // The real bug this guards: in fee mode the posting wizard showed
    // "Bounty £250" — seeded, never chosen, never charged — directly above
    // "Post & pay £5".
    const view = await render(
      <ReviewStep flow={buildFlow()} answers={{ ...ANSWERS, mode: 'fee' }} onEdit={jest.fn()} />,
    );

    expect(view.getByText('No reward')).toBeTruthy();
    expect(view.queryByText('£250')).toBeNull();
  });

  it('KEEPS a skipped step that did not opt out', async () => {
    // The framework default, and the behaviour the garage's plate step relies
    // on: a real answer nobody was asked for is exactly the one worth showing.
    const flow = buildFlow();
    flow.phases[1].steps[1].hideReviewWhenSkipped = false;

    const view = await render(<ReviewStep flow={flow} answers={{ ...ANSWERS, mode: 'fee' }} onEdit={jest.fn()} />);

    expect(view.getByText('£250')).toBeTruthy();
  });

  it('drops a phase heading with nothing left under it', async () => {
    // Hiding a row can empty a whole phase, and a heading with no rows beneath
    // it is a rendering artefact, not a section.
    const flow = buildFlow();
    flow.phases[1].steps[0].reviewValue = undefined; // no mode row either

    const view = await render(
      <ReviewStep flow={flow} answers={{ ...ANSWERS, mode: 'fee' }} onEdit={jest.fn()} />,
    );

    expect(view.queryByText('Reward')).toBeNull();
    // The other phase is untouched.
    expect(view.getByText('About you')).toBeTruthy();
  });
});

describe('the blocking gate', () => {
  it('names how many answers are missing, and marks the rows', async () => {
    // The dead end this replaces: twelve rows, a greyed-out pay button, and
    // nothing saying which one it meant.
    const view = await render(
      <ReviewStep flow={buildFlow()} answers={{ ...ANSWERS, name: undefined }} onEdit={jest.fn()} />,
    );

    expect(view.getByText('One answer still needs your attention before you can finish.'))
      .toBeTruthy();
    expect(view.getByText('Needs another look')).toBeTruthy();
  });

  it('⚠️ KEEPS the value beside the flag', async () => {
    // The gate fails on TOO FEW as well as none — photos at 2 of 3, a bounty
    // under the floor. Replacing the value with "needs an answer" told them
    // something false and hid the very thing they need to see to fix it.
    const flow = buildFlow();
    // A colour is present but too short for the schema: a real answer, refused.
    flow.phases[0].steps[1].schema = z.object({ colour: z.string().min(10) });

    const view = await render(
      <ReviewStep flow={flow} answers={ANSWERS} onEdit={jest.fn()} />,
    );

    expect(view.getByText('Blue')).toBeTruthy();
    expect(view.getByText('Needs another look')).toBeTruthy();
  });

  it('says nothing at all when everything is answered', async () => {
    const view = await render(
      <ReviewStep flow={buildFlow()} answers={ANSWERS} onEdit={jest.fn()} />,
    );

    expect(view.queryByText('Needs an answer')).toBeNull();
  });
});

describe('editing', () => {
  it('jumps to a row’s own flat index', async () => {
    const onEdit = jest.fn();
    const view = await render(<ReviewStep flow={buildFlow()} answers={ANSWERS} onEdit={onEdit} />);

    fireEvent.press(view.getByLabelText('Edit Favourite colour?'));

    expect(onEdit).toHaveBeenCalledWith(2);
  });

  it('resolves the header slot’s step id to a flat index', async () => {
    // The slot is handed an id so a flow never does index arithmetic against a
    // screen list the framework builds.
    const onEdit = jest.fn();
    const flow = buildFlow({
      review: {
        title: 'Check your answers',
        header: (_answers, editStep) => (
          <Text accessibilityRole="button" onPress={() => editStep('reward')}>
            Change the reward
          </Text>
        ),
      },
    });
    const view = await render(<ReviewStep flow={flow} answers={ANSWERS} onEdit={onEdit} />);

    fireEvent.press(view.getByText('Change the reward'));

    expect(onEdit).toHaveBeenCalledWith(5);
  });

  it('takes the first CANDIDATE that exists, for a composed flow', async () => {
    // The prefilled post flow drops the photos step when the saved car already
    // has enough, so its preview offers [photos, vehicle-summary]. Hard-wired
    // to a step that composition removed, the Edit did nothing at all.
    const onEdit = jest.fn();
    const flow = buildFlow({
      review: {
        header: (_answers, editStep) => (
          <Text accessibilityRole="button" onPress={() => editStep(['gone', 'colour'])}>
            Change it
          </Text>
        ),
      },
    });
    const view = await render(<ReviewStep flow={flow} answers={ANSWERS} onEdit={onEdit} />);

    fireEvent.press(view.getByText('Change it'));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(2); // the colour step
  });

  it('no-ops on an unknown step id rather than jumping somewhere arbitrary', async () => {
    const onEdit = jest.fn();
    const flow = buildFlow({
      review: {
        header: (_answers, editStep) => (
          <Text accessibilityRole="button" onPress={() => editStep('nope')}>
            Broken link
          </Text>
        ),
      },
    });
    const view = await render(<ReviewStep flow={flow} answers={ANSWERS} onEdit={onEdit} />);

    fireEvent.press(view.getByText('Broken link'));

    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe('slots', () => {
  it('renders the header above and the footer below', async () => {
    const flow = buildFlow({
      review: {
        title: 'Check your answers',
        header: () => <Text>PREVIEW</Text>,
        footer: () => <Text>WHAT YOU PAY</Text>,
      },
    });
    const view = await render(<ReviewStep flow={flow} answers={ANSWERS} onEdit={jest.fn()} />);

    expect(view.getByText('PREVIEW')).toBeTruthy();
    expect(view.getByText('WHAT YOU PAY')).toBeTruthy();
  });

  it('renders unchanged for a flow that supplies neither', async () => {
    // The other three wizards on this screen pass no slots at all.
    const view = await render(<ReviewStep flow={buildFlow()} answers={ANSWERS} onEdit={jest.fn()} />);

    expect(view.getByText('Check your answers')).toBeTruthy();
    expect(view.getByText('Sam')).toBeTruthy();
  });
});
