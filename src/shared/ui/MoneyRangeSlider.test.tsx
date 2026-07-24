/**
 * WHAT:  Wiring tests for MoneyRangeSlider — the ordered readout, per-thumb
 *        accessibility stepping, and the ordering clamp that stops the two
 *        thumbs crossing (low never exceeds high, high never drops below low).
 * WHY:   A range filter that lets min pass max emits a nonsense query; the
 *        maths suite proves the shared curve/snap, this proves the dual-thumb
 *        component obeys it. Animation internals are mocked at the boundary
 *        (same pattern as MoneySlider.test.tsx) — we assert values, not frames.
 * LINKS: src/shared/ui/MoneyRangeSlider.tsx, src/shared/ui/moneySliderMath.ts,
 *        docs/TESTING.md (Tier 1 money).
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react-native';

import { MoneyRangeSlider } from './MoneyRangeSlider';

jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { View } = require('react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { useRef } = require('react');
  return {
    __esModule: true,
    default: { View },
    Easing: { out: (fn: unknown) => fn, cubic: () => 0 },
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => true,
    useSharedValue: (initial: unknown) => useRef({ value: initial }).current,
    withTiming: (value: unknown) => value,
  };
});

jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => fn(...args),
}));

jest.mock('react-native-gesture-handler', () => {
  const chain = () => {
    const gesture: Record<string, unknown> = {};
    for (const method of ['enabled', 'minDistance', 'onBegin', 'onStart', 'onUpdate', 'onFinalize']) {
      gesture[method] = () => gesture;
    }
    return gesture;
  };
  return {
    Gesture: { Pan: chain },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});

/** Bounty config from the spec: £50–£5,000, £25 steps to £500 then £50. */
const rangeProps = {
  minPence: 5000,
  maxPence: 500000,
  snapSteps: [{ upToPence: 50000, stepPence: 2500 }, { stepPence: 5000 }],
  testID: 'range',
};

const action = (name: string) => ({ nativeEvent: { actionName: name } });

/** Render with the track laid out so the thumbs mount (width > 0 gate). Every
 *  act() is awaited so nothing leaks into the next test's render (overlapping
 *  act() calls otherwise blank the tree — this component animates on mount). */
async function renderLaidOut(props: Partial<React.ComponentProps<typeof MoneyRangeSlider>> = {}) {
  const onChange = props.onChange ?? jest.fn();
  const view = await render(
    <MoneyRangeSlider
      {...rangeProps}
      valuePence={props.valuePence ?? { minPence: 5000, maxPence: 500000 }}
      onChange={onChange}
      disabled={props.disabled}
    />,
  );
  await act(async () => {
    fireEvent(view.getByTestId('range-track'), 'layout', {
      nativeEvent: { layout: { width: 328 } },
    });
  });
  return { view, onChange };
}

/** Fire a thumb's increment/decrement inside an awaited act. */
async function step(view: Awaited<ReturnType<typeof render>>, thumb: 'low' | 'high', name: string) {
  await act(async () => {
    fireEvent(view.getByTestId(`range-${thumb}`), 'accessibilityAction', action(name));
  });
}

afterEach(cleanup);
beforeEach(() => jest.clearAllMocks());

describe('readout', () => {
  it('shows the ordered range and marks an open-ended top with "+"', async () => {
    const { view } = await renderLaidOut({ valuePence: { minPence: 20000, maxPence: 500000 } });
    expect(view.getByTestId('range-readout').props.children).toBe('£200 – £5,000+');
  });

  it('shows a plain top when below the ceiling', async () => {
    const { view } = await renderLaidOut({ valuePence: { minPence: 20000, maxPence: 100000 } });
    expect(view.getByTestId('range-readout').props.children).toBe('£200 – £1,000');
  });

  it('normalises an inverted controlled value (min never renders above max)', async () => {
    const { view } = await renderLaidOut({ valuePence: { minPence: 300000, maxPence: 100000 } });
    // high clamps up to low → both £3,000; ordered, never "£3,000 – £1,000".
    expect(view.getByTestId('range-readout').props.children).toBe('£3,000 – £3,000');
  });
});

describe('per-thumb a11y stepping', () => {
  it('increments the low thumb by one snap step', async () => {
    const { view, onChange } = await renderLaidOut({
      valuePence: { minPence: 20000, maxPence: 500000 },
    });
    await step(view, 'low', 'increment');
    expect(onChange).toHaveBeenCalledWith({ minPence: 22500, maxPence: 500000 });
  });

  it('increments the high thumb by one snap step', async () => {
    const { view, onChange } = await renderLaidOut({
      valuePence: { minPence: 5000, maxPence: 100000 },
    });
    await step(view, 'high', 'increment');
    // £1,000 is above the £500 tier, so the step is £50.
    expect(onChange).toHaveBeenCalledWith({ minPence: 5000, maxPence: 105000 });
  });

  it('does not fire the low thumb below min', async () => {
    const { view, onChange } = await renderLaidOut({
      valuePence: { minPence: 5000, maxPence: 500000 },
    });
    await step(view, 'low', 'decrement');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is inert when disabled', async () => {
    const { view, onChange } = await renderLaidOut({
      valuePence: { minPence: 20000, maxPence: 300000 },
      disabled: true,
    });
    await step(view, 'low', 'increment');
    await step(view, 'high', 'decrement');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('ordering clamp', () => {
  it('the low thumb never steps above the high thumb', async () => {
    // Thumbs adjacent (both on the £25 grid): incrementing low would land on
    // £300, but high is £300 — it pins to high, no crossing, and since that
    // equals the current low+step target it still emits the clamped value.
    const { view, onChange } = await renderLaidOut({
      valuePence: { minPence: 297500, maxPence: 300000 },
    });
    await step(view, 'low', 'increment');
    expect(onChange).toHaveBeenCalledWith({ minPence: 300000, maxPence: 300000 });
  });

  it('a low thumb already touching the high thumb does not emit on increment', async () => {
    const { view, onChange } = await renderLaidOut({
      valuePence: { minPence: 300000, maxPence: 300000 },
    });
    await step(view, 'low', 'increment');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the high thumb never steps below the low thumb', async () => {
    const { view, onChange } = await renderLaidOut({
      valuePence: { minPence: 100000, maxPence: 105000 },
    });
    // Decrement high from £1,050 by £50 → £1,000, still above low (£1,000)…
    await step(view, 'high', 'decrement');
    expect(onChange).toHaveBeenCalledWith({ minPence: 100000, maxPence: 100000 });
  });
});

describe('accessibility value', () => {
  it('each thumb announces its own end of the range', async () => {
    const { view } = await renderLaidOut({ valuePence: { minPence: 20000, maxPence: 100000 } });
    expect(view.getByTestId('range-low').props.accessibilityValue).toEqual({
      min: 50,
      max: 5000,
      now: 200,
      text: '£200',
    });
    expect(view.getByTestId('range-high').props.accessibilityValue).toEqual({
      min: 50,
      max: 5000,
      now: 1000,
      text: '£1,000',
    });
    expect(view.getByTestId('range-low').props.accessibilityLabel).toBe('Amount range, minimum');
    expect(view.getByTestId('range-high').props.accessibilityLabel).toBe('Amount range, maximum');
  });
});
