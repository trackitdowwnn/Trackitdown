/**
 * WHAT:  Wiring tests for OnboardingScreen — the four slides and their position
 *        labels, the pinned safety copy, the single full-width control and its
 *        "Continue" → "Get started" relabel, the progress dots, the X's
 *        visibility/placement/persistence, completion, Android back behaviour,
 *        revisit mode, and the slide-view funnel logging.
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
 *        only way forward is the way a user has: press the control. `advanceBy`
 *        is that, and it is deliberately the ONLY way this suite moves — a
 *        helper that reached into state would stop these tests from proving the
 *        control still advances the screen.
 * LINKS: src/features/auth/screens/OnboardingScreen.tsx; docs/TESTING.md.
 */

import { act, fireEvent, render, waitFor, within, type RenderResult } from '@testing-library/react-native';
import * as RN from 'react-native';
import { BackHandler, StyleSheet } from 'react-native';

import { displayFontScaleCap, sizes } from '@/shared/theme';

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
    // The map hero's layers. Opacity is not asserted here — OnboardingMap.test
    // owns the stages — but the hook must exist or the screen throws on render.
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    // The trail dots' stagger. Passthrough, same as the official mock — added
    // when TrailDot arrived, because this inline mock predates it and the
    // walkthrough tests only dodged the missing function by running at the
    // host's default fontScale 2, where the map band never mounts.
    withDelay: (_delayMs: unknown, animation: unknown) => animation,
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
 * Walk forward the only way a user can: by pressing the button.
 *
 * ⚠️ BY ROLE AND NAME, not testID (2026-09-03). The ring FAB carried
 * `onboarding-cta`; the reference rebuild replaced it with the shared `Button`,
 * which takes no testID — and rather than widen a component used app-wide just
 * to be findable here, this presses what a user presses: the control named
 * "Continue".
 *
 * ⚠️ Re-queried on every press, never cached. The control's LABEL changes on
 * the last step ("Continue" → "Get started"), and a held reference would go on
 * firing at a node that has left the tree — passing while proving nothing.
 *
 * ⚠️ `advanceBy`, NOT `advanceTo`. It presses n times from wherever the screen
 * currently is; it does not navigate to page n. The two only coincide when the
 * caller is on slide 1, which every caller but one is — and the exception
 * (`LAST_PAGE - 1` from slide 1, meaning "two more") is exactly the reading the
 * old name got wrong. Named for what it does, so reordering a test cannot
 * silently assert a different slide.
 */
async function advanceBy(getByRole: RenderResult['getByRole'], steps: number) {
  for (let step = 0; step < steps; step += 1) {
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Continue' }));
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
    const { getByTestId, getByRole } = await render(<OnboardingScreen />);
    expect(getByTestId('onboarding-slide-0').props.accessibilityLabel).toMatch(
      /^Slide 1 of 4\. Stolen cars, on one map\./,
    );

    await advanceBy(getByRole, LAST_PAGE);

    expect(getByTestId(`onboarding-slide-${LAST_PAGE}`).props.accessibilityLabel).toMatch(
      /^Slide 4 of 4\./,
    );
  });

  // The stepping contract itself: the old pager kept all four slides mounted,
  // and if that ever came back every "is it gone?" assertion in this file would
  // start passing for the wrong reason.
  it('mounts only the current slide', async () => {
    const { getByTestId, queryByTestId, getByRole } = await render(<OnboardingScreen />);
    expect(getByTestId('onboarding-slide-0')).toBeTruthy();
    expect(queryByTestId('onboarding-slide-1')).toBeNull();

    await advanceBy(getByRole, 1);

    expect(getByTestId('onboarding-slide-1')).toBeTruthy();
    expect(queryByTestId('onboarding-slide-0')).toBeNull();
  });

  it('slide 3 carries the exact safety wording', async () => {
    // SAFETY: pinned word-for-word — the report-don't-approach seed.
    const { getByTestId, getByText, getByRole } = await render(<OnboardingScreen />);
    await advanceBy(getByRole, 2);
    expect(getByTestId('onboarding-slide-2').props.accessibilityLabel).toContain(
      ONBOARDING_SAFETY_LINE,
    );
    expect(getByText(ONBOARDING_SAFETY_LINE)).toBeTruthy();
  });
});

describe('progress and the CTA', () => {
  // ⚠️ REBUILT 2026-09-03 to the Life360 reference. The control was a ring FAB
  // for slides 1–3 that swapped IDENTITY for a full-width button on the last;
  // it is now one full-width button throughout that changes LABEL. What pins
  // that decision is the COUNT, for the reason set out in the test below — a
  // screen that somehow showed two controls would pass the "Continue" lookup
  // on its own.
  it('is one full-width button throughout, relabelled on the last slide', async () => {
    const { getByTestId, getByRole, queryByRole } = await render(<OnboardingScreen />);
    expect(getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(queryByRole('button', { name: 'Get started' })).toBeNull();
    // ⚠️ COUNT THE FOOTER'S CONTROLS, do not assert the old ring's testID is
    // absent. `onboarding-cta` no longer exists anywhere in the repo, so a
    // queryByTestId for it cannot fail and guards nothing — TESTING.md's "a
    // test that invents the number it checks". One button is the actual claim:
    // it fails the day a second control comes back to this row.
    expect(within(getByTestId('onboarding-footer')).getAllByRole('button')).toHaveLength(1);

    await advanceBy(getByRole, LAST_PAGE);

    // "Get started" is a different promise from "Continue": it is the press
    // that FINISHES the intro rather than advancing it, and the funnel records
    // the two differently.
    expect(getByRole('button', { name: 'Get started' })).toBeTruthy();
    expect(queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  // The dots are the progress the reference does not carry, because it is one
  // screen rather than a sequence. They replace the ring's arc.
  it('shows progress as dots, and drops them on the last slide', async () => {
    const { getByTestId, queryByTestId, getByRole } = await render(<OnboardingScreen />);
    expect(getByTestId('onboarding-dots').props.accessibilityLabel).toBe('Step 1 of 4');

    await advanceBy(getByRole, 1);
    expect(getByTestId('onboarding-dots').props.accessibilityLabel).toBe('Step 2 of 4');

    // Nothing left to be a step THROUGH once "Get started" is the only move.
    await advanceBy(getByRole, LAST_PAGE - 1);
    expect(queryByTestId('onboarding-dots')).toBeNull();
  });

  // ⚠️ COLUMN ON EVERY SLIDE, and this is mechanical rather than cosmetic.
  // Button's `fullWidth` is `alignSelf: 'stretch'`, which stretches the CROSS
  // axis: in a row that is the VERTICAL, so the button would hug its own text
  // and grow tall instead of spanning the width. The old footer was a row and
  // had to flip direction for the last slide; one direction throughout is what
  // makes the button full-width everywhere. Nothing else here would notice if
  // it reverted.
  it('lays the footer out as a column on every slide', async () => {
    const { getByTestId, getByRole } = await render(<OnboardingScreen />);
    expect(StyleSheet.flatten(getByTestId('onboarding-footer').props.style).flexDirection).toBe(
      'column',
    );

    await advanceBy(getByRole, LAST_PAGE);

    expect(StyleSheet.flatten(getByTestId('onboarding-footer').props.style).flexDirection).toBe(
      'column',
    );
  });

  it('pressing Continue moves on without finishing', async () => {
    const { getByTestId, getByRole } = await render(<OnboardingScreen />);
    await advanceBy(getByRole, 1);
    expect(getByTestId('onboarding-slide-1')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('button-only walkthrough reaches the end and completes', async () => {
    const { getByRole } = await render(<OnboardingScreen />);
    await advanceBy(getByRole, LAST_PAGE);
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Get started' }));
    });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)/explore'));
  });

  it('Get started on the last slide persists the flag and enters the app as a guest', async () => {
    const { getByRole } = await render(<OnboardingScreen />);
    await advanceBy(getByRole, LAST_PAGE);
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
  // ⚠️ Queried by ROLE, not text: since 2026-09-03 Skip is an X glyph over the
  // map, not a worded button. Its accessibility label is still "Skip" because
  // that is the ACTION — "Close" would suggest a dialog the reader had opened.
  it('persists the flag and enters the app as a guest', async () => {
    const { getByRole } = await render(<OnboardingScreen />);
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Skip' }));
    });
    await waitFor(() =>
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(ONBOARDING_STORAGE_KEY, 'true'),
    );
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/explore');
    expect(mockLogInfo).toHaveBeenCalledWith('Onboarding skipped', {
      atSlide: 1,
    });
  });

  // ⚠️ IT STAYS ON THE LAST SLIDE NOW, which is a deliberate reversal. The old
  // Skip was hidden there because "Get started" sat in its place and two worded
  // buttons would have competed. The X is chrome in the opposite corner, so it
  // does not compete — and someone who reaches slide 4 and does not want to
  // continue keeps the escape they had on every slide before it.
  //
  // The funnel keeps the distinction that makes this worth having: bailing on
  // slide 4 records `skipped`, pressing Get started records `completed`.
  it('stays available on the last slide, and still records a skip', async () => {
    const { getByRole } = await render(<OnboardingScreen />);
    await advanceBy(getByRole, LAST_PAGE);

    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Skip' }));
    });

    expect(mockTrack).toHaveBeenCalledWith('skipped');
    expect(mockLogInfo).toHaveBeenCalledWith('Onboarding skipped', { atSlide: LAST_PAGE + 1 });
  });

  // ⚠️ IT MUST NOT LIVE IN THE MAP BAND. Past 1.3× text the hero is not
  // rendered at all, and a Skip nested inside it would take the only way out of
  // the intro with it — a reader at large type locked into four slides. It is
  // an absolute overlay for exactly this reason, and this is the test that says
  // so: at 2× the map is gone and Skip is not.
  it('survives the map being dropped at large text sizes', async () => {
    jest
      .spyOn(RN.Dimensions, 'get')
      .mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 2 });

    const { getByRole, queryByTestId } = await render(<OnboardingScreen />);

    expect(queryByTestId('onboarding-map')).toBeNull();
    expect(getByRole('button', { name: 'Skip' })).toBeTruthy();
  });

  // ⚠️ PRESENT IS NOT THE SAME AS NOT-IN-THE-WAY, which the test above does not
  // distinguish. With the band gone the stage starts at the top of the screen
  // directly under the floating X, and `justifyContent: 'flex-end'` stops
  // applying the moment the copy outgrows the scroll view — which at 2× is
  // precisely when it does. The headline then begins at y=0 and scrolls UNDER a
  // chip that does not scroll with it. The reserved room is the fix, so it is
  // the thing asserted.
  it('reserves room for the X once the map is gone', async () => {
    jest
      .spyOn(RN.Dimensions, 'get')
      .mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 2 });

    const { getByTestId } = await render(<OnboardingScreen />);
    const big = StyleSheet.flatten(
      getByTestId('onboarding-stage-scroll').props.contentContainerStyle,
    );

    expect(big.paddingTop).toBeGreaterThanOrEqual(sizes.touchTarget);
  });

  // fontScale pinned explicitly, for the reason the map-hero block records: the
  // host's default is not 1, so "no padding" has to be asserted at a size that
  // actually renders the band.
  it('reserves none of it while the hero still holds that room', async () => {
    jest
      .spyOn(RN.Dimensions, 'get')
      .mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });

    const { getByTestId } = await render(<OnboardingScreen />);
    const normal = StyleSheet.flatten(
      getByTestId('onboarding-stage-scroll').props.contentContainerStyle,
    );

    expect(normal.paddingTop).toBeUndefined();
  });
});

describe('Android back', () => {
  it('exits normally from slide 1 (handler declines)', async () => {
    await render(<OnboardingScreen />);
    const handled = backHandlers.at(-1)?.();
    expect(handled).toBe(false);
  });

  it('goes back a slide from later slides', async () => {
    const { getByTestId, getByRole } = await render(<OnboardingScreen />);
    await advanceBy(getByRole, 2);

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
    const { getByRole } = await render(<OnboardingScreen />);

    expect(mockStartRun).toHaveBeenCalled();
    expect(mockTrack).toHaveBeenCalledWith('slide_viewed', 1);

    await advanceBy(getByRole, 2);
    expect(mockTrack).toHaveBeenCalledWith('slide_viewed', 2);
  });

  it('records how the run ended', async () => {
    const { getByRole } = await render(<OnboardingScreen />);

    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Skip' }));
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

    const { getByRole } = await render(<OnboardingScreen />);
    await advanceBy(getByRole, 2);

    expect(mockStartRun).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
  });
});

describe('revisit mode (settings re-view)', () => {
  it('exits via back without touching the flag', async () => {
    mockParams = { revisit: '1' };
    const { getByRole } = await render(<OnboardingScreen />);
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Skip' }));
    });
    expect(mockBack).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});

describe('funnel logging', () => {
  it('logs each newly reached slide', async () => {
    const { getByRole } = await render(<OnboardingScreen />);
    expect(mockLogInfo).toHaveBeenCalledWith('Onboarding slide viewed', {
      slide: 1,
      revisit: false,
    });

    await advanceBy(getByRole, 1);

    expect(mockLogInfo).toHaveBeenCalledWith('Onboarding slide viewed', {
      slide: 2,
      revisit: false,
    });
  });
});
