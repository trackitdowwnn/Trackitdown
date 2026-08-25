/**
 * WHAT:  Wiring tests for OnboardingScreen — the four slides and their position
 *        labels, the pinned safety copy, the ring-FAB → "Get started" control
 *        swap, Skip visibility/placement/persistence, completion, Android back
 *        behaviour, revisit mode, and the slide-view funnel logging.
 * WHY:   This is the app's front door and first funnel; a wiring slip here
 *        strands new users before auth or loses the skip/complete signal.
 *        Animation internals are mocked at the boundary — the same builder
 *        double as src/shared/wizard/WizardScreen.test.tsx, because this screen
 *        now runs the same layout animations. We assert states and callbacks,
 *        never frames.
 *
 *        ONE SLIDE IS MOUNTED AT A TIME (2026-08-08), which changed nearly
 *        every test here. The screen used to be a paging ScrollView with all
 *        four slides in the tree, so a test could reach slide 4 by firing a
 *        `momentumScrollEnd` at the pager and could assert on any slide at any
 *        moment. Stepping is now an unmount/mount keyed on the page, so the
 *        only way forward is the way a user has: press the control. `advanceTo`
 *        is that, and it is deliberately the ONLY way this suite moves — a
 *        helper that reached into state would stop these tests from proving the
 *        control still advances the screen.
 * LINKS: src/features/auth/screens/OnboardingScreen.tsx; docs/TESTING.md.
 */

import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import * as RN from 'react-native';
import { BackHandler, StyleSheet } from 'react-native';

import { displayFontScaleCap } from '@/shared/theme';

import { ONBOARDING_SAFETY_LINE, ONBOARDING_SLIDES } from '../lib/onboardingSlides';
import { ONBOARDING_STORAGE_KEY } from '../lib/onboardingStorage';
import { OnboardingScreen } from './OnboardingScreen';

import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock(
  'react-native-safe-area-context',
  () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
    require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { View } = require('react-native');
  // The entering/exiting builders are chainable and inert: this suite asserts
  // WHICH slide is mounted, never how it arrived.
  const builder = () => {
    const chain: Record<string, unknown> = {};
    chain.duration = () => chain;
    chain.easing = () => chain;
    chain.reduceMotion = () => chain;
    return chain;
  };
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (component: unknown) => component },
    // motionEasing runs Easing.out(Easing.cubic) at MODULE scope — both must
    // exist here or importing the screen throws before a single test runs.
    Easing: { out: (fn: unknown) => fn, cubic: () => 0 },
    ReduceMotion: { System: 'system' },
    SlideInLeft: builder(),
    SlideInRight: builder(),
    SlideOutLeft: builder(),
    SlideOutRight: builder(),
    // The ring's arc. Returning {} is right for THIS suite: the animated value
    // is never asserted here, and the ring's static strokeDashoffset — the one
    // that carries the truth — is a plain prop that survives the mock.
    // OnboardingRingFab.test.tsx is where progress is pinned.
    useAnimatedProps: () => ({}),
    // The map hero's layers. Opacity is not asserted here — OnboardingMap.test
    // owns the stages — but the hook must exist or the screen throws on render.
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    withTiming: (toValue: unknown) => toValue,
    useReducedMotion: () => true,
    useSharedValue: (initial: unknown) => ({ value: initial }),
  };
});

const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockCanGoBack = true;
let mockParams: Record<string, string> = {};
// The funnel reaches the supabase client, which throws at import without env
// vars. Mocked at the module boundary, which is also how the calls are asserted.
const mockStartRun = jest.fn();
const mockEndRun = jest.fn();
const mockTrack = jest.fn();
jest.mock('../lib/onboardingFunnel', () => ({
  startOnboardingRun: () => mockStartRun(),
  endOnboardingRun: () => mockEndRun(),
  trackOnboardingStep: (...args: unknown[]) => mockTrack(...args),
}));

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

const LAST_PAGE = ONBOARDING_SLIDES.length - 1;

/** Registered hardware-back handlers, so tests can press "back". */
let backHandlers: (() => boolean)[];

/**
 * Walk forward the only way a user can: by pressing the ring.
 *
 * ⚠️ The control is re-queried on every press, never cached. It UNMOUNTS on the
 * last step (the footer swaps to "Get started"), and a held reference would go
 * on firing at a node that has left the tree — passing while proving nothing.
 */
async function advanceTo(getByTestId: (id: string) => unknown, page: number) {
  for (let step = 0; step < page; step += 1) {
    await act(async () => {
      fireEvent.press(getByTestId('onboarding-cta') as never);
    });
  }
}

// ⚠️ RESTORE, not just clear. `jest.clearAllMocks()` resets a spy’s calls but
// keeps its implementation, and jest-expo sets no `restoreMocks`. The map-hero
// tests spy on `Dimensions.get`, so without this they pinned the file's
// fontScale from that point on and every later test rendered through the
// map-hidden branch — which is exactly how a layout bug in that branch went
// unnoticed by 126 passing tests.
afterEach(() => {
  jest.restoreAllMocks();
});

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

describe('the map hero', () => {
  const HIDDEN = { includeHiddenElements: true } as const;

  /**
   * Both cases pin fontScale explicitly.
   *
   * ⚠️ Through `Dimensions.get`, which is what `useWindowDimensions` reads.
   * Spying on the hook itself does nothing here — the screen holds a direct
   * binding to it — and jest-expo reports fontScale 2 by default, so the
   * large-text test passed while proving nothing and the ordinary-size one
   * could never pass at all.
   */
  const atFontScale = (fontScale: number) => {
    jest
      .spyOn(RN.Dimensions, 'get')
      .mockReturnValue({ width: 390, height: 844, scale: 3, fontScale });
  };

  it('is there at ordinary text sizes', async () => {
    atFontScale(1);

    const view = await render(<OnboardingScreen />);

    expect(view.getByTestId('onboarding-map', HIDDEN)).toBeTruthy();
  });

  it('still shows at exactly the cap, matching the wizard', async () => {
    // DESIGN_SYSTEM states the rule as "stops filling ABOVE 1.3×", and
    // WizardScreen implements it as `<=`. This screen is the rule’s second
    // consumer; the two must not disagree about the boundary.
    atFontScale(displayFontScaleCap);

    const view = await render(<OnboardingScreen />);

    expect(view.getByTestId('onboarding-map', HIDDEN)).toBeTruthy();
  });

  it('⚠️ yields the screen once text is scaled past the cap', async () => {
    atFontScale(displayFontScaleCap + 0.1);

    const view = await render(<OnboardingScreen />);

    expect(view.queryByTestId('onboarding-map', HIDDEN)).toBeNull();
    // The words are still there, and still the whole point.
    expect(view.getByTestId('onboarding-slide-0')).toBeTruthy();
  });

  it('⚠️ leaves no dead space when the map is gone', async () => {
    // The stage must be the FILL, not a 0.45 flex child. Yoga floors a total
    // grow factor below 1, so a lone 0.45 child took 45% of the free space and
    // left ~42% of the screen blank under the footer — at exactly the text size
    // this branch exists to serve, and hidden from every other test in this
    // file by a leaked Dimensions spy.
    atFontScale(displayFontScaleCap + 0.1);

    const view = await render(<OnboardingScreen />);
    const stage = view.getByTestId('onboarding-step-slide');

    expect(StyleSheet.flatten(stage.props.style)).toEqual(
      expect.objectContaining({ flex: 1 }),
    );
  });
});

describe('slides', () => {
  it('shows each slide in turn with position + copy in one announced label', async () => {
    const { getByTestId } = await render(<OnboardingScreen />);
    expect(getByTestId('onboarding-slide-0').props.accessibilityLabel).toMatch(
      /^Slide 1 of 4\. Stolen cars, on one map\./,
    );

    await advanceTo(getByTestId, LAST_PAGE);

    expect(getByTestId(`onboarding-slide-${LAST_PAGE}`).props.accessibilityLabel).toMatch(
      /^Slide 4 of 4\./,
    );
  });

  // The stepping contract itself: the old pager kept all four slides mounted,
  // and if that ever came back every "is it gone?" assertion in this file would
  // start passing for the wrong reason.
  it('mounts only the current slide', async () => {
    const { getByTestId, queryByTestId } = await render(<OnboardingScreen />);
    expect(getByTestId('onboarding-slide-0')).toBeTruthy();
    expect(queryByTestId('onboarding-slide-1')).toBeNull();

    await advanceTo(getByTestId, 1);

    expect(getByTestId('onboarding-slide-1')).toBeTruthy();
    expect(queryByTestId('onboarding-slide-0')).toBeNull();
  });

  it('slide 3 carries the exact safety wording', async () => {
    // SAFETY: pinned word-for-word — the report-don't-approach seed.
    const { getByTestId, getByText } = await render(<OnboardingScreen />);
    await advanceTo(getByTestId, 2);
    expect(getByTestId('onboarding-slide-2').props.accessibilityLabel).toContain(
      ONBOARDING_SAFETY_LINE,
    );
    expect(getByText(ONBOARDING_SAFETY_LINE)).toBeTruthy();
  });
});

describe('progress and the CTA', () => {
  // The control does not change LABEL any more, it changes IDENTITY: a ring
  // FAB for slides 1–3, then one full-width "Get started". Asserting the ring
  // is GONE is the half that pins the design decision — a screen that showed
  // both would otherwise pass on the "Get started" lookup alone.
  it('swaps the ring FAB for a full-width Get started on the last slide', async () => {
    const { getByTestId, queryByTestId, getByRole, queryByRole } = await render(
      <OnboardingScreen />,
    );
    expect(getByTestId('onboarding-cta').props.accessibilityLabel).toBe('Next');
    expect(queryByRole('button', { name: 'Get started' })).toBeNull();

    await advanceTo(getByTestId, LAST_PAGE);

    expect(getByRole('button', { name: 'Get started' })).toBeTruthy();
    expect(queryByTestId('onboarding-cta')).toBeNull();
  });

  // Button's `fullWidth` is alignSelf: 'stretch', which stretches the CROSS
  // axis — so in the footer's row direction "Get started" would hug its own
  // text and grow to the ring's height instead of spanning the width. The
  // direction has to flip with the control, and nothing else here would notice
  // if it stopped.
  it('lays the last slide out for one full-width button, not a row', async () => {
    const { getByTestId } = await render(<OnboardingScreen />);
    const footer = getByTestId('onboarding-footer');
    expect(StyleSheet.flatten(footer.props.style).flexDirection).toBe('row');

    await advanceTo(getByTestId, LAST_PAGE);

    expect(StyleSheet.flatten(getByTestId('onboarding-footer').props.style).flexDirection).toBe(
      'column',
    );
  });

  it('pressing Next moves on without finishing', async () => {
    const { getByTestId } = await render(<OnboardingScreen />);
    await advanceTo(getByTestId, 1);
    expect(getByTestId('onboarding-slide-1')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('button-only walkthrough reaches the end and completes', async () => {
    const { getByTestId, getByRole } = await render(<OnboardingScreen />);
    await advanceTo(getByTestId, LAST_PAGE);
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Get started' }));
    });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)/explore'));
  });

  it('Get started on the last slide persists the flag and enters the app as a guest', async () => {
    const { getByTestId, getByRole } = await render(<OnboardingScreen />);
    await advanceTo(getByTestId, LAST_PAGE);
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Get started' }));
    });
    await waitFor(() =>
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(ONBOARDING_STORAGE_KEY, 'true'),
    );
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/explore');
    expect(mockLogInfo).toHaveBeenCalledWith('Onboarding completed', {
      atSlide: 4,
    });
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
    expect(mockLogInfo).toHaveBeenCalledWith('Onboarding skipped', {
      atSlide: 1,
    });
  });

  it('disappears on the last slide', async () => {
    const { getByTestId, queryByText } = await render(<OnboardingScreen />);
    await advanceTo(getByTestId, LAST_PAGE);
    expect(queryByText('Skip')).toBeNull();
  });

  // Skip and the next control are ONE footer row (2026-08-08); Skip used to sit
  // in its own strip at the top-right. Asserted as containment rather than
  // position — the design decision is "these two live together", and nothing
  // else in this suite would notice if Skip drifted back up.
  it('sits in the footer beside the next control, not in its own row', async () => {
    const { getByTestId } = await render(<OnboardingScreen />);
    const footer = within(getByTestId('onboarding-footer'));
    expect(footer.getByText('Skip')).toBeTruthy();
    expect(footer.getByTestId('onboarding-cta')).toBeTruthy();
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
    await advanceTo(getByTestId, 2);

    let handled: boolean | undefined;
    await act(async () => {
      handled = backHandlers.at(-1)?.();
    });

    expect(handled).toBe(true);
    // Back is a real step backwards, not merely a swallowed event.
    expect(getByTestId('onboarding-slide-1')).toBeTruthy();
  });
});

describe('⚠️ the completion funnel', () => {
  it('opens a run and counts each slide reached', async () => {
    const { getByTestId } = await render(<OnboardingScreen />);

    expect(mockStartRun).toHaveBeenCalled();
    expect(mockTrack).toHaveBeenCalledWith('slide_viewed', 1);

    await advanceTo(getByTestId, 2);
    expect(mockTrack).toHaveBeenCalledWith('slide_viewed', 2);
  });

  it('records how the run ended', async () => {
    const { getByText } = await render(<OnboardingScreen />);

    await act(async () => {
      fireEvent.press(getByText('Skip'));
    });

    expect(mockTrack).toHaveBeenCalledWith('skipped');
  });

  it('⚠️ counts NOTHING in revisit mode', async () => {
    // Re-reading the intro from Profile → "How Trackitdown works" is not a
    // journey through onboarding. Counting it would inflate both ends of the
    // funnel with people who already finished, and drift the completion rate —
    // the one number this exists to produce — upward every time the tour was
    // browsed.
    mockParams = { revisit: '1' };

    const { getByTestId } = await render(<OnboardingScreen />);
    await advanceTo(getByTestId, 2);

    expect(mockStartRun).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
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
  it('logs each newly reached slide', async () => {
    const { getByTestId } = await render(<OnboardingScreen />);
    expect(mockLogInfo).toHaveBeenCalledWith('Onboarding slide viewed', {
      slide: 1,
      revisit: false,
    });

    await advanceTo(getByTestId, 1);

    expect(mockLogInfo).toHaveBeenCalledWith('Onboarding slide viewed', {
      slide: 2,
      revisit: false,
    });
  });
});
