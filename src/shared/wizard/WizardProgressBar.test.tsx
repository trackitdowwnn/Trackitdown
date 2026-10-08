/**
 * WHAT:  Tests for WizardProgressBar — one segment per phase filled to its
 *        fraction (a fill that MOVES within its clipped track), hidden until
 *        measured, the screen-reader label and percentage, and the rule that
 *        nothing animates on mount: a segment only animates when it changes.
 * WHY:   The old dot-and-pill bar stood still across a whole phase and ran
 *        eight JS-thread animations as the form slid up (2026-10-08, "janky,
 *        slow and not smooth"). These pin the replacement's behaviour.
 * LINKS: src/shared/wizard/WizardProgressBar.tsx; docs/DESIGN_SYSTEM.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { WizardProgressBar } from './WizardProgressBar';

// A double whose shared values hold plain numbers and whose withTiming is
// recorded, so "animated" and "set" can be told apart. Animated styles are
// computed on each render, as the real ones are on each frame.
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

type View = Awaited<ReturnType<typeof render>>;

/** Measure every track at `width` (re-rendering so the styles read it). */
async function measure(view: View, width: number, rerender: () => void) {
  await act(async () => {
    view.getAllByTestId('wizard-progress-segment').forEach((segment) =>
      fireEvent(segment, 'layout', { nativeEvent: { layout: { width } } }),
    );
  });
  await act(async () => rerender());
}

/** Each segment's fill: its translateX and opacity. */
function fills(view: View) {
  return view.getAllByTestId('wizard-progress-segment').map((segment) => {
    const fill = segment.children[0] as unknown as { props: { style: object } };
    const style = StyleSheet.flatten(fill.props.style) as {
      opacity?: number;
      transform?: { translateX: number }[];
    };
    return { x: style.transform?.[0]?.translateX, opacity: style.opacity };
  });
}

beforeEach(() => {
  mockWithTiming.mockClear();
  mockReduceMotion = false;
});

describe('WizardProgressBar', () => {
  it('draws one segment per phase, each filled to its fraction once measured', async () => {
    const bar = <WizardProgressBar fills={[1, 0.5, 0]} label="Your car, part 2 of 3" percent={50} />;
    const view = await render(bar);
    // A fresh element, so the bar re-renders and reads the measured width.
    await measure(view, 100, () => view.rerender(<WizardProgressBar {...bar.props} />));
    expect(fills(view)).toEqual([
      { x: 0, opacity: 1 },
      { x: -50, opacity: 1 },
      { x: -100, opacity: 1 },
    ]);
  });

  it('shows no fill until its track is measured — never a full bar for a frame', async () => {
    const view = await render(<WizardProgressBar fills={[0.25]} label="Step 1 of 4" percent={25} />);
    expect(fills(view)[0].opacity).toBe(0);
  });

  it('is one progressbar for screen readers, with the label and percentage it is given', async () => {
    const view = await render(
      <WizardProgressBar fills={[1, 0.5, 0]} label="Your car, part 2 of 3" percent={53} />,
    );
    const bar = view.getByLabelText('Your car, part 2 of 3');
    expect(bar.props.accessibilityRole).toBe('progressbar');
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 53 });
  });

  it('animates NOTHING on mount — the bar is simply there', async () => {
    await render(<WizardProgressBar fills={[1, 0.25, 0]} label="x" percent={40} />);
    expect(mockWithTiming).not.toHaveBeenCalled();
  });

  it('animates only the segment that changed, when it changes', async () => {
    const view = await render(<WizardProgressBar fills={[1, 0.25, 0]} label="x" percent={40} />);
    await act(async () => {
      view.rerender(<WizardProgressBar fills={[1, 0.5, 0]} label="x" percent={50} />);
    });
    expect(mockWithTiming).toHaveBeenCalledTimes(1);
    expect(mockWithTiming).toHaveBeenCalledWith(0.5);
  });

  it('jumps instead of animating under reduced motion', async () => {
    mockReduceMotion = true;
    const view = await render(<WizardProgressBar fills={[0.25]} label="x" percent={25} />);
    await act(async () => {
      view.rerender(<WizardProgressBar fills={[0.5]} label="x" percent={50} />);
    });
    expect(mockWithTiming).not.toHaveBeenCalled();
  });
});
