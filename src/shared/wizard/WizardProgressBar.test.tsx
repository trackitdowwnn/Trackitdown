/**
 * WHAT:  Tests for WizardProgressBar — one segment per phase filled to its
 *        fraction, the screen-reader label and percentage, and the rule that
 *        nothing animates on mount: a segment only animates when it changes.
 * WHY:   The old dot-and-pill bar stood still across a whole phase and ran
 *        eight JS-thread animations as the form slid up (2026-10-08, "janky,
 *        slow and not smooth"). These pin the replacement's behaviour.
 * LINKS: src/shared/wizard/WizardProgressBar.tsx; docs/DESIGN_SYSTEM.md.
 */

import { act, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { WizardProgressBar } from './WizardProgressBar';

// A double whose shared values hold plain numbers and whose withTiming is
// recorded, so "animated" and "set" can be told apart.
const mockWithTiming = jest.fn((value: number) => value);
let mockReduceMotion = false;
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { View } = require('react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { useRef } = require('react');
  return {
    __esModule: true,
    default: { View },
    Easing: { out: (fn: unknown) => fn, cubic: () => 0, linear: () => 0 },
    useSharedValue: (initial: number) => useRef({ value: initial }).current,
    useAnimatedStyle: (fn: () => object) => fn(),
    withTiming: (value: number) => mockWithTiming(value),
    useReducedMotion: () => mockReduceMotion,
  };
});

/** Each segment's fill width, as a percentage string. */
function fillWidths(view: Awaited<ReturnType<typeof render>>) {
  return view.getAllByTestId('wizard-progress-segment').map((segment) => {
    const fill = segment.children[0] as unknown as { props: { style: object } };
    return (StyleSheet.flatten(fill.props.style) as { width?: string }).width;
  });
}

beforeEach(() => {
  mockWithTiming.mockClear();
  mockReduceMotion = false;
});

describe('WizardProgressBar', () => {
  it('draws one segment per phase, each filled to its fraction', async () => {
    const view = await render(<WizardProgressBar fills={[1, 0.5, 0]} label="Step 2 of 3" />);
    expect(fillWidths(view)).toEqual(['100%', '50%', '0%']);
  });

  it('is one progressbar for screen readers, with a label and percentage', async () => {
    const view = await render(<WizardProgressBar fills={[1, 0.5, 0]} label="Step 2 of 3" />);
    const bar = view.getByLabelText('Step 2 of 3');
    expect(bar.props.accessibilityRole).toBe('progressbar');
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 50 });
  });

  it('animates NOTHING on mount — the bar is simply there', async () => {
    await render(<WizardProgressBar fills={[1, 0.25, 0]} label="Step 2 of 3" />);
    expect(mockWithTiming).not.toHaveBeenCalled();
  });

  it('animates only the segment that changed, when it changes', async () => {
    const view = await render(<WizardProgressBar fills={[1, 0.25, 0]} label="Step 2 of 3" />);
    await act(async () => {
      view.rerender(<WizardProgressBar fills={[1, 0.5, 0]} label="Step 2 of 3" />);
    });
    expect(mockWithTiming).toHaveBeenCalledTimes(1);
    expect(mockWithTiming).toHaveBeenCalledWith(0.5);
  });

  it('jumps instead of animating under reduced motion', async () => {
    mockReduceMotion = true;
    const view = await render(<WizardProgressBar fills={[0.25]} label="Step 1 of 1" />);
    await act(async () => {
      view.rerender(<WizardProgressBar fills={[0.5]} label="Step 1 of 1" />);
    });
    expect(mockWithTiming).not.toHaveBeenCalled();
  });
});
