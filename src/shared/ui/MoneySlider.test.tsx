/**
 * WHAT:  Wiring tests for MoneySlider — rendered value and panel maths,
 *        tap-on-track commits, accessibility increment/decrement stepping,
 *        manual-entry commit and clamping, and the disabled state.
 * WHY:   The maths suites prove the mapping; this file proves the component
 *        obeys it — a wiring slip here writes a wrong bounty. Animation
 *        internals are mocked at the boundary (same pattern as
 *        WizardScreen.test.tsx): we assert values and callbacks, not frames.
 * LINKS: src/shared/ui/MoneySlider.tsx, src/shared/ui/moneySliderMath.ts,
 *        docs/TESTING.md (Tier 1 money, Tier 2 screen states).
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { defaultBountyPanelCopy, MoneySlider, penceAmountSchema } from './MoneySlider';

jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { View } = require('react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { useRef } = require('react');
  return {
    __esModule: true,
    default: {
      View,
      createAnimatedComponent: (component: unknown) => component,
    },
    Easing: { out: (fn: unknown) => fn, cubic: () => 0 },
    useAnimatedProps: () => ({}),
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => true,
    // Like the real hook, the box must survive re-renders.
    useSharedValue: (initial: unknown) => useRef({ value: initial }).current,
    withSequence: (...values: unknown[]) => values[values.length - 1],
    withTiming: (value: unknown) => value,
  };
});

jest.mock('react-native-worklets', () => ({
  // On the JS thread in tests, scheduling on the RN runtime is a direct call.
  scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => fn(...args),
}));

/** The pan handlers the component registered, so tests can synthesise touches. */
const mockPanHandlers: Record<string, (event?: { x: number }) => void> = {};
jest.mock('react-native-gesture-handler', () => {
  const chain = () => {
    const gesture: Record<string, unknown> = {};
    for (const method of ['enabled', 'minDistance']) {
      gesture[method] = () => gesture;
    }
    for (const method of ['onBegin', 'onStart', 'onUpdate', 'onFinalize']) {
      gesture[method] = (handler: (event?: { x: number }) => void) => {
        mockPanHandlers[method] = handler;
        return gesture;
      };
    }
    return gesture;
  };
  return {
    Gesture: { Pan: chain },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});

/** Bounty config from the spec: £50–£5,000, £25 steps to £500 then £50. */
const bountyProps = {
  minPence: 5000,
  maxPence: 500000,
  snapSteps: [{ upToPence: 50000, stepPence: 2500 }, { stepPence: 5000 }],
  onChangePence: jest.fn(),
  testID: 'bounty',
};

const action = (name: string) => ({ nativeEvent: { actionName: name } });

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockPanHandlers)) {
    delete mockPanHandlers[key];
  }
});

describe('MoneySlider rendering', () => {
  it('shows the formatted value on the hero and announces it on the track', async () => {
    const { getByTestId } = await render(<MoneySlider {...bountyProps} valuePence={20000} />);
    expect(getByTestId('bounty-hero').props.accessibilityLabel).toBe(
      'Edit amount, currently £200',
    );
    expect(getByTestId('bounty-track').props.accessibilityValue).toEqual({
      min: 50,
      max: 5000,
      now: 200,
      text: '£200',
    });
  });

  it('renders the transparency panel with the live 95/5 breakdown', async () => {
    const { getByText } = await render(
      <MoneySlider {...bountyProps} valuePence={20000} panel={defaultBountyPanelCopy} />,
    );
    expect(getByText(/they receive £190 and our platform fee is £10/)).toBeTruthy();
    expect(getByText(/£200 is held securely/)).toBeTruthy();
  });

  it('hides the panel when no copy is provided', async () => {
    const { queryByText } = await render(<MoneySlider {...bountyProps} valuePence={20000} />);
    expect(queryByText(/held securely/)).toBeNull();
  });

  it('clamps an out-of-range controlled value', async () => {
    const { getByTestId } = await render(<MoneySlider {...bountyProps} valuePence={600000} />);
    expect(getByTestId('bounty-track').props.accessibilityValue).toEqual({
      min: 50,
      max: 5000,
      now: 5000,
      text: '£5,000',
    });
  });
});

describe('track touches', () => {
  /** Give the track a real width so touch positions map to amounts. */
  const layTrack = async (track: Parameters<typeof fireEvent>[0]) => {
    await act(async () => {
      fireEvent(track, 'layout', { nativeEvent: { layout: { width: 328 } } });
    });
  };

  it('a plain tap commits the snapped value at the touch point', async () => {
    const onChangePence = jest.fn();
    const { getByTestId } = await render(
      <MoneySlider {...bountyProps} onChangePence={onChangePence} valuePence={5000} />,
    );
    await layTrack(getByTestId('bounty-track'));
    await act(async () => {
      mockPanHandlers.onBegin({ x: 328 }); // tap the far right end
      mockPanHandlers.onStart({ x: 328 });
      mockPanHandlers.onFinalize();
    });
    expect(onChangePence).toHaveBeenCalledWith(500000);
  });

  it('a touch cancelled before activation (parent scroll won) commits nothing', async () => {
    const onChangePence = jest.fn();
    const { getByTestId } = await render(
      <MoneySlider {...bountyProps} onChangePence={onChangePence} valuePence={5000} />,
    );
    await layTrack(getByTestId('bounty-track'));
    await act(async () => {
      mockPanHandlers.onBegin({ x: 328 }); // touch-down, then the scroll claims it
      mockPanHandlers.onFinalize();
    });
    expect(onChangePence).not.toHaveBeenCalled();
  });

  it('drag frames only emit on snap-grid crossings', async () => {
    const onChangePence = jest.fn();
    const { getByTestId } = await render(
      <MoneySlider {...bountyProps} onChangePence={onChangePence} valuePence={5000} />,
    );
    await layTrack(getByTestId('bounty-track'));
    await act(async () => {
      mockPanHandlers.onBegin({ x: 148 });
      mockPanHandlers.onStart({ x: 148 });
      mockPanHandlers.onUpdate({ x: 150 }); // still snaps to £1,050 — no second emit
      mockPanHandlers.onFinalize();
    });
    expect(onChangePence).toHaveBeenCalledTimes(1);
  });

  it('reconciles with a parent that rejects the change — re-tapping re-emits', async () => {
    // The parent never updates valuePence, so after the post-drag reconcile
    // the slider must treat the prop value as current again.
    const onChangePence = jest.fn();
    const { getByTestId } = await render(
      <MoneySlider {...bountyProps} onChangePence={onChangePence} valuePence={5000} />,
    );
    await layTrack(getByTestId('bounty-track'));
    for (let tap = 0; tap < 2; tap += 1) {
      await act(async () => {
        mockPanHandlers.onBegin({ x: 328 });
        mockPanHandlers.onStart({ x: 328 });
        mockPanHandlers.onFinalize();
      });
    }
    expect(onChangePence).toHaveBeenCalledTimes(2);
    expect(onChangePence).toHaveBeenLastCalledWith(500000);
  });
});

describe('accessibility stepping', () => {
  it('increments by one snap step (£25 below £500)', async () => {
    const onChangePence = jest.fn();
    const { getByTestId } = await render(
      <MoneySlider {...bountyProps} onChangePence={onChangePence} valuePence={20000} />,
    );
    fireEvent(getByTestId('bounty-track'), 'accessibilityAction', action('increment'));
    expect(onChangePence).toHaveBeenCalledWith(22500);
  });

  it('crossing the £500 boundary lands on the £50 grid', async () => {
    const onChangePence = jest.fn();
    const { getByTestId } = await render(
      <MoneySlider {...bountyProps} onChangePence={onChangePence} valuePence={50000} />,
    );
    fireEvent(getByTestId('bounty-track'), 'accessibilityAction', action('increment'));
    expect(onChangePence).toHaveBeenCalledWith(55000);
  });

  it('does not fire below min', async () => {
    const onChangePence = jest.fn();
    const { getByTestId } = await render(
      <MoneySlider {...bountyProps} onChangePence={onChangePence} valuePence={5000} />,
    );
    fireEvent(getByTestId('bounty-track'), 'accessibilityAction', action('decrement'));
    expect(onChangePence).not.toHaveBeenCalled();
  });

  it('clamps a step that lands on a bound', async () => {
    const onChangePence = jest.fn();
    const { getByTestId } = await render(
      <MoneySlider {...bountyProps} onChangePence={onChangePence} valuePence={497500} />,
    );
    fireEvent(getByTestId('bounty-track'), 'accessibilityAction', action('increment'));
    expect(onChangePence).toHaveBeenCalledWith(500000);
  });

  it('is inert when disabled', async () => {
    const onChangePence = jest.fn();
    const { getByTestId } = await render(
      <MoneySlider {...bountyProps} onChangePence={onChangePence} valuePence={20000} disabled />,
    );
    fireEvent(getByTestId('bounty-track'), 'accessibilityAction', action('increment'));
    expect(onChangePence).not.toHaveBeenCalled();
  });
});

describe('manual entry', () => {
  it('commits an exact typed amount without snapping (£237 stays £237)', async () => {
    const onChangePence = jest.fn();
    const { getByTestId } = await render(
      <MoneySlider {...bountyProps} onChangePence={onChangePence} valuePence={20000} />,
    );
    await act(async () => {
      fireEvent.press(getByTestId('bounty-hero'));
    });
    const input = getByTestId('bounty-input');
    await act(async () => {
      fireEvent.changeText(input, '237');
    });
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });
    expect(onChangePence).toHaveBeenCalledWith(23700);
  });

  it('clamps typed amounts below min and above max', async () => {
    const onChangePence = jest.fn();
    const { getByTestId } = await render(
      <MoneySlider {...bountyProps} onChangePence={onChangePence} valuePence={20000} />,
    );
    await act(async () => {
      fireEvent.press(getByTestId('bounty-hero'));
    });
    const input = getByTestId('bounty-input');
    await act(async () => {
      fireEvent.changeText(input, '2');
    });
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });
    expect(onChangePence).toHaveBeenCalledWith(5000);

    await act(async () => {
      fireEvent.press(getByTestId('bounty-hero'));
    });
    const input2 = getByTestId('bounty-input');
    await act(async () => {
      fireEvent.changeText(input2, '99999');
    });
    await act(async () => {
      fireEvent(input2, 'submitEditing');
    });
    expect(onChangePence).toHaveBeenLastCalledWith(500000);
  });

  it('selects the prefilled amount and shows the range while editing', async () => {
    const { getByTestId, getByText } = await render(
      <MoneySlider {...bountyProps} valuePence={20000} />,
    );
    await act(async () => {
      fireEvent.press(getByTestId('bounty-hero'));
    });
    expect(getByTestId('bounty-input').props.selectTextOnFocus).toBe(true);
    expect(getByText('Between £50 and £5,000')).toBeTruthy();
  });

  it('strips non-digits while typing (whole pounds only)', async () => {
    const { getByTestId } = await render(<MoneySlider {...bountyProps} valuePence={20000} />);
    await act(async () => {
      fireEvent.press(getByTestId('bounty-hero'));
    });
    await act(async () => {
      fireEvent.changeText(getByTestId('bounty-input'), '2x3.7');
    });
    expect(getByTestId('bounty-input').props.value).toBe('237');
  });

  it('keeps the current value when nothing is typed', async () => {
    const onChangePence = jest.fn();
    const { getByTestId } = await render(
      <MoneySlider {...bountyProps} onChangePence={onChangePence} valuePence={20000} />,
    );
    await act(async () => {
      fireEvent.press(getByTestId('bounty-hero'));
    });
    const input = getByTestId('bounty-input');
    await act(async () => {
      fireEvent.changeText(input, '');
    });
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });
    expect(onChangePence).not.toHaveBeenCalled();
  });

  it('does not open the editor when disabled', async () => {
    const { getByTestId, queryByTestId } = await render(
      <MoneySlider {...bountyProps} valuePence={20000} disabled />,
    );
    fireEvent.press(getByTestId('bounty-hero'));
    expect(queryByTestId('bounty-input')).toBeNull();
  });
});

describe('penceAmountSchema', () => {
  it('accepts in-range integer pence and rejects floats and out-of-range', () => {
    const schema = penceAmountSchema(5000, 500000);
    expect(schema.safeParse(23700).success).toBe(true);
    expect(schema.safeParse(4999).success).toBe(false);
    expect(schema.safeParse(500001).success).toBe(false);
    expect(schema.safeParse(23700.5).success).toBe(false);
  });
});
