/**
 * WHAT:  Wiring tests for OnboardingScreen — four slides with position
 *        labels, the pinned safety copy, Next → Get started label swap,
 *        Skip visibility and persistence, completion, Android back
 *        behaviour, revisit mode, and the slide-view funnel logging.
 * WHY:   This is the app's front door and first funnel; a wiring slip here
 *        strands new users before auth or loses the skip/complete signal.
 *        Animation internals are mocked at the boundary (same pattern as
 *        MoneySlider.test.tsx): we assert states and callbacks, not frames.
 * LINKS: src/features/auth/screens/OnboardingScreen.tsx; docs/TESTING.md.
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { BackHandler, Dimensions } from 'react-native';

import { ONBOARDING_SAFETY_LINE } from '../lib/onboardingSlides';
import { ONBOARDING_STORAGE_KEY } from '../lib/onboardingStorage';
import { OnboardingScreen } from './OnboardingScreen';

import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

const mockScrollTo = jest.fn();
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const ReactNative = require('react-native');
  // A ScrollView stand-in whose imperative scrollTo we can assert against.
  const MockScrollView = React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    React.useImperativeHandle(ref, () => ({ scrollTo: mockScrollTo }));
    return React.createElement(ReactNative.View, props, props.children as never);
  });
  MockScrollView.displayName = 'MockScrollView';
  return {
    __esModule: true,
    default: {
      View: ReactNative.View,
      Text: ReactNative.Text,
      ScrollView: MockScrollView,
      createAnimatedComponent: (component: unknown) => component,
    },
    interpolate: () => 0,
    interpolateColor: () => '#000000',
    useAnimatedScrollHandler: () => () => {},
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => true,
    useSharedValue: (initial: unknown) => ({ value: initial }),
  };
});

const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockCanGoBack = true;
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mockReplace,
    back: mockBack,
    canGoBack: () => mockCanGoBack,
  }),
  useLocalSearchParams: () => mockParams,
}));

const mockLogInfo = jest.fn();
jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    // Getter: the screen's module-scope createLogger() runs before this
    // file's consts initialise; resolving at call time dodges the TDZ.
    get info() {
      return mockLogInfo;
    },
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

const WIDTH = Dimensions.get('window').width;

/** Registered hardware-back handlers, so tests can press "back". */
let backHandlers: (() => boolean)[];

/** Swipe to a page by firing the pager's momentum-settle event. */
async function settleOnPage(pager: unknown, page: number) {
  await act(async () => {
    fireEvent(pager as never, 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: page * WIDTH } },
    });
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockParams = {};
  mockCanGoBack = true;
  backHandlers = [];
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    backHandlers.push(handler as () => boolean);
    return { remove: jest.fn() };
  });
});

describe('slides', () => {
  it('renders all four with position + copy in one announced label', async () => {
    const { getByTestId } = await render(<OnboardingScreen />);
    expect(getByTestId('onboarding-slide-0').props.accessibilityLabel).toMatch(
      /^Slide 1 of 4\. Your car, stolen\? Post it\./,
    );
    expect(getByTestId('onboarding-slide-3').props.accessibilityLabel).toMatch(/^Slide 4 of 4\./);
  });

  it('slide 3 carries the exact safety wording', async () => {
    // SAFETY: pinned word-for-word — the report-don't-approach seed.
    const { getByTestId, getByText } = await render(<OnboardingScreen />);
    expect(getByTestId('onboarding-slide-2').props.accessibilityLabel).toContain(
      ONBOARDING_SAFETY_LINE,
    );
    expect(getByText(ONBOARDING_SAFETY_LINE)).toBeTruthy();
  });
});

describe('progress and the CTA', () => {
  it('CTA reads Next until the last slide, then Get started', async () => {
    const { getByTestId } = await render(<OnboardingScreen />);
    expect(getByTestId('onboarding-cta').props.accessibilityLabel).toBe('Next');
    await settleOnPage(getByTestId('onboarding-pager'), 3);
    expect(getByTestId('onboarding-cta').props.accessibilityLabel).toBe('Get started');
  });

  it('pressing Next scrolls to the next page without finishing', async () => {
    const { getByTestId } = await render(<OnboardingScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('onboarding-cta'));
    });
    expect(mockScrollTo).toHaveBeenCalledWith(expect.objectContaining({ x: WIDTH }));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('button-only walkthrough completes WITHOUT momentum events (reduce motion)', async () => {
    // Regression pin: non-animated programmatic scrolls fire no momentum
    // event, so page state must advance at the press, not at the settle.
    const { getByTestId } = await render(<OnboardingScreen />);
    const cta = getByTestId('onboarding-cta');
    for (let press = 0; press < 3; press += 1) {
      await act(async () => {
        fireEvent.press(cta);
      });
    }
    expect(getByTestId('onboarding-cta').props.accessibilityLabel).toBe('Get started');
    await act(async () => {
      fireEvent.press(cta);
    });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)/explore'));
  });

  it('Get started on the last slide persists the flag and enters the app as a guest', async () => {
    const { getByTestId } = await render(<OnboardingScreen />);
    await settleOnPage(getByTestId('onboarding-pager'), 3);
    await act(async () => {
      fireEvent.press(getByTestId('onboarding-cta'));
    });
    await waitFor(() =>
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(ONBOARDING_STORAGE_KEY, 'true'),
    );
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/explore');
    expect(mockLogInfo).toHaveBeenCalledWith('Onboarding completed', { atSlide: 4 });
  });
});

describe('skip', () => {
  it('shows on early slides, persists the flag, and enters the app as a guest', async () => {
    const { getByText } = await render(<OnboardingScreen />);
    await act(async () => {
      fireEvent.press(getByText('Skip'));
    });
    await waitFor(() =>
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(ONBOARDING_STORAGE_KEY, 'true'),
    );
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/explore');
    expect(mockLogInfo).toHaveBeenCalledWith('Onboarding skipped', { atSlide: 1 });
  });

  it('disappears on the last slide', async () => {
    const { getByTestId, queryByText } = await render(<OnboardingScreen />);
    await settleOnPage(getByTestId('onboarding-pager'), 3);
    expect(queryByText('Skip')).toBeNull();
  });
});

describe('Android back', () => {
  it('exits normally from slide 1 (handler declines)', async () => {
    await render(<OnboardingScreen />);
    const handled = backHandlers.at(-1)?.();
    expect(handled).toBe(false);
  });

  it('goes back a slide from later slides', async () => {
    const { getByTestId } = await render(<OnboardingScreen />);
    await settleOnPage(getByTestId('onboarding-pager'), 2);
    let handled: boolean | undefined;
    await act(async () => {
      handled = backHandlers.at(-1)?.();
    });
    expect(handled).toBe(true);
    expect(mockScrollTo).toHaveBeenCalledWith(expect.objectContaining({ x: WIDTH }));
  });
});

describe('revisit mode (settings re-view)', () => {
  it('exits via back without touching the flag', async () => {
    mockParams = { revisit: '1' };
    const { getByText } = await render(<OnboardingScreen />);
    await act(async () => {
      fireEvent.press(getByText('Skip'));
    });
    expect(mockBack).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});

describe('funnel logging', () => {
  it('logs each newly settled slide', async () => {
    const { getByTestId } = await render(<OnboardingScreen />);
    expect(mockLogInfo).toHaveBeenCalledWith('Onboarding slide viewed', {
      slide: 1,
      revisit: false,
    });
    await settleOnPage(getByTestId('onboarding-pager'), 1);
    expect(mockLogInfo).toHaveBeenCalledWith('Onboarding slide viewed', {
      slide: 2,
      revisit: false,
    });
  });
});
