/**
 * WHAT:  Tests for ProgressSteps — the marker per state, and what a screen
 *        reader hears.
 * WHY:   The markers are the only visual difference between done, in progress
 *        and to come; the spoken label is the only one for a screen reader, so
 *        it must carry the state in words.
 * LINKS: ./ProgressSteps.tsx.
 */

import { act, fireEvent, render, within } from '@testing-library/react-native';
import * as RN from 'react-native';
import { StyleSheet } from 'react-native';
import * as Reanimated from 'react-native-reanimated';

import { sizes, typography } from '../theme';

import { ProgressSteps, type ProgressStep } from './ProgressSteps';

/** ⚠️ Through `Dimensions.get`, which `useWindowDimensions` reads — jest-expo
 *  reports 2 by default, so every case pins it (ReportCard.test's trap). */
const atFontScale = (fontScale: number) => {
  jest
    .spyOn(RN.Dimensions, 'get')
    .mockReturnValue({ width: 390, height: 844, scale: 3, fontScale });
};

afterEach(() => {
  jest.restoreAllMocks();
});

/** The marker's top offset — the wrapper around the marker carries it. */
const markerOffset = (view: Awaited<ReturnType<typeof render>>, id: string) =>
  StyleSheet.flatten(view.getByTestId(id).parent?.props.style)?.marginTop ?? 0;

const STEPS: ProgressStep[] = [
  { id: 'a', label: 'Your details', state: 'done' },
  { id: 'b', label: 'Stripe’s check', state: 'current', detail: 'Usually a few minutes.' },
  { id: 'c', label: 'Payouts on', state: 'upcoming' },
];

describe('ProgressSteps', () => {
  beforeEach(() => atFontScale(1));

  it('draws one marker per state', async () => {
    const view = await render(<ProgressSteps steps={STEPS} />);
    expect(view.getByTestId('step-done-a')).toBeTruthy();
    expect(view.getByTestId('step-current-b')).toBeTruthy();
    expect(view.getByTestId('step-upcoming-c')).toBeTruthy();
  });

  it('shows the detail under its step', async () => {
    const view = await render(<ProgressSteps steps={STEPS} />);
    expect(view.getByText('Usually a few minutes.')).toBeTruthy();
  });

  it('speaks position, label and state in words, then the detail', async () => {
    const view = await render(<ProgressSteps steps={STEPS} />);
    expect(view.getByLabelText('Step 1 of 3, Your details, done.')).toBeTruthy();
    expect(
      view.getByLabelText('Step 2 of 3, Stripe’s check, in progress. Usually a few minutes.'),
    ).toBeTruthy();
    expect(view.getByLabelText('Step 3 of 3, Payouts on, not started.')).toBeTruthy();
  });
});

describe('⚠️ the marker stays on the label’s first line at any text size', () => {
  // A constant offset rode the marker up to the cap tops at 2× (UI review,
  // 2026-10-13); the line box is lineHeight × fontScale, the marker fixed.
  it('at 1×, the label is the shorter, so the marker sits at the top', async () => {
    atFontScale(1);
    const view = await render(<ProgressSteps steps={STEPS} />);
    expect(markerOffset(view, 'step-current-b')).toBe(0);
  });

  it('at 2×, the marker comes down to the middle of the first line', async () => {
    atFontScale(2);
    const view = await render(<ProgressSteps steps={STEPS} />);
    const firstLine = typography.cardTitle.lineHeight * 2;
    expect(markerOffset(view, 'step-current-b')).toBe((firstLine - sizes.timelineRailColumn) / 2);
    // Each row measures its OWN label: done and upcoming use body type.
    const bodyLine = typography.body.lineHeight * 2;
    expect(markerOffset(view, 'step-done-a')).toBe((bodyLine - sizes.timelineRailColumn) / 2);
  });
});

describe('ProgressSteps v2 — dates, "needs you", one action, heading, collapse (2026-10-14)', () => {
  beforeEach(() => atFontScale(1));

  it('a date sits beside the label, and is spoken with it', async () => {
    const view = await render(
      <ProgressSteps
        steps={[{ id: 'a', label: 'Reward sent', state: 'done', meta: '13 October' }]}
      />,
    );
    expect(view.getByText('13 October')).toBeTruthy();
    expect(view.getByLabelText('Step 1 of 1, Reward sent, done. 13 October.')).toBeTruthy();
  });

  it('⚠️ "needs you" is a SHAPE ("!") and a spoken state — never colour alone', async () => {
    const view = await render(
      <ProgressSteps
        steps={[
          { id: 'a', label: 'Your details', state: 'done' },
          { id: 'b', label: 'ID check', state: 'attention', detail: 'A quick photo ID check.' },
        ]}
      />,
    );
    expect(view.getByTestId('step-attention-b')).toBeTruthy();
    expect(view.getByLabelText(/ID check, needs you\. A quick photo ID check\./)).toBeTruthy();
  });

  it('the one action shows under a current or attention step, and does its job', async () => {
    const onPress = jest.fn();
    const view = await render(
      <ProgressSteps
        steps={[
          { id: 'a', label: 'Done', state: 'done', action: { label: 'Never shown', onPress } },
          { id: 'b', label: 'ID check', state: 'attention', action: { label: 'Start the check', onPress } },
        ]}
      />,
    );
    expect(view.queryByText('Never shown')).toBeNull();
    await act(async () => {
      fireEvent.press(view.getByText('Start the check'));
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('⚠️ the action sits OUTSIDE the spoken stop — a screen reader can reach it', async () => {
    const view = await render(
      <ProgressSteps
        steps={[
          {
            id: 'b',
            label: 'ID check',
            state: 'attention',
            action: { label: 'Start the check', onPress: jest.fn() },
          },
        ]}
      />,
    );
    const stop = view.getByLabelText(/ID check, needs you/);
    // The button is not a descendant of the accessible stop (which would swallow it).
    expect(within(stop).queryByText('Start the check')).toBeNull();
    expect(view.getByText('Start the check')).toBeTruthy();
  });

  it('names the tracker with a heading', async () => {
    const view = await render(<ProgressSteps steps={STEPS} heading="Your reward" />);
    expect(view.getByRole('header', { name: 'Your reward' })).toBeTruthy();
  });

  it('a finished road starts as one line, and opens into the full list', async () => {
    const view = await render(
      <ProgressSteps
        steps={STEPS}
        testID="road"
        collapsed={{ summary: 'Paid 16 October · £190', expandLabel: 'View details' }}
      />,
    );
    expect(view.getByText('Paid 16 October · £190')).toBeTruthy();
    expect(view.queryByTestId('road-done-a')).toBeNull();

    await act(async () => {
      fireEvent.press(view.getByTestId('road-expand'));
    });
    expect(view.getByTestId('road-done-a')).toBeTruthy();
    expect(view.queryByText('Paid 16 October · £190')).toBeNull();
  });
});

describe('ProgressSteps — a step that is working (2026-10-14)', () => {
  beforeEach(() => atFontScale(1));

  const working: ProgressStep[] = [
    { id: 'a', label: 'Your details', state: 'done' },
    { id: 'b', label: 'ID check', state: 'current', detail: 'Checking now.', working: true },
  ];

  it('the current marker breathes only when the step says it is working', async () => {
    const view = await render(<ProgressSteps steps={working} />);
    expect(view.getByTestId('step-current-b-working')).toBeTruthy();

    const still = await render(<ProgressSteps steps={STEPS} />);
    expect(still.queryByTestId('step-current-b-working')).toBeNull();
  });

  it('`working` on a step that is not current draws nothing extra', async () => {
    const view = await render(
      <ProgressSteps steps={[{ id: 'a', label: 'Done', state: 'done', working: true }]} />,
    );
    expect(view.queryByTestId('step-done-a-working')).toBeNull();
  });

  it('⚠️ Reduce Motion: still a dot, just a still one — and the words still say it', async () => {
    jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    const view = await render(<ProgressSteps steps={working} />);
    expect(view.getByTestId('step-current-b-working')).toBeTruthy();
    expect(view.getByLabelText(/ID check, in progress\. Checking now\./)).toBeTruthy();
  });
});
