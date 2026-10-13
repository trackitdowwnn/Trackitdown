/**
 * WHAT:  Tests for ProgressSteps — the marker per state, and what a screen
 *        reader hears.
 * WHY:   The markers are the only visual difference between done, in progress
 *        and to come; the spoken label is the only one for a screen reader, so
 *        it must carry the state in words.
 * LINKS: ./ProgressSteps.tsx.
 */

import { render } from '@testing-library/react-native';
import * as RN from 'react-native';
import { StyleSheet } from 'react-native';

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
