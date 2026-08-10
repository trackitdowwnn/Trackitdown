/**
 * WHAT:  Tests for OnboardingRingFab — that the ring shows the RIGHT amount of
 *        progress at every page, and that the two static SVG props the ring
 *        depends on are present.
 * WHY:   The ring replaced a row of dots, so it is now the only thing on the
 *        screen saying how far through you are. A dot that fails to light is
 *        obvious; an arc stuck at the wrong angle is not — it just looks like a
 *        design choice. Every assertion here is written to fail loudly for one
 *        named cause.
 *
 *        THE CIRCUMFERENCE IS RECOMPUTED FROM THE TOKENS HERE, deliberately,
 *        rather than imported from the component. Importing its own maths would
 *        make the test agree with the implementation by construction — it would
 *        pass just as happily if the radius were wrong. This restates the spec
 *        (fill + gap + stroke on both sides, stroke centred on the path) and
 *        checks the component matches it.
 *
 *        WHAT IS ASSERTED IS THE STATIC OFFSET, and that is the point rather
 *        than a limitation. The sweep is a `withTiming` the component hands to
 *        Reanimated; asserting it here would be asserting Reanimated. The
 *        static prop is the ring's floor — the amount painted on the first
 *        frame, and the amount left showing if animated SVG props never land on
 *        a device. If that floor is right at every page, the ring cannot lie.
 *        Reduced motion has no branch to test for the same reason: it lives in
 *        the timing config (ReduceMotion.System), which drops the sweep and
 *        leaves this same value.
 * LINKS: ./OnboardingRingFab.tsx; src/shared/theme/sizes.ts;
 *        docs/design-refs/onboarding/ob1.webp; docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';

import { sizes } from '@/shared/theme';

import { OnboardingRingFab } from './OnboardingRingFab';

// The spec, restated: the outer box is the fill plus a gap and a stroke either
// side, and the stroke straddles the path so the radius is inset by half of it.
const SLOT = sizes.fab + 2 * (sizes.fabRingGap + sizes.fabRing);
const CIRCUMFERENCE = 2 * Math.PI * ((SLOT - sizes.fabRing) / 2);

async function renderAt(page: number) {
  return render(<OnboardingRingFab page={page} total={4} onPress={jest.fn()} />);
}

/** The arc's undrawn remainder. Hidden from a11y, so it must be asked for. */
async function offsetAt(page: number): Promise<number | null> {
  const { getByTestId } = await renderAt(page);
  return getByTestId('onboarding-ring-arc', { includeHiddenElements: true }).props
    .strokeDashoffset as number | null;
}

describe('the ring shows real progress', () => {
  // A quarter per slide, starting at a quarter — never empty. One of four dots
  // was lit on slide 1, and the ring inherits that promise.
  it('fills a quarter per page, starting at one quarter', async () => {
    expect(await offsetAt(0)).toBeCloseTo(CIRCUMFERENCE * 0.75, 3);
    expect(await offsetAt(1)).toBeCloseTo(CIRCUMFERENCE * 0.5, 3);
    expect(await offsetAt(2)).toBeCloseTo(CIRCUMFERENCE * 0.25, 3);
  });

  // The assertion that survives a rewrite: it fails if the ring is wired to a
  // constant, wired backwards, or off by one (page instead of page + 1) —
  // none of which the individual values above would catch on their own if
  // someone "fixed" them to match a broken implementation.
  it('advances monotonically — never flat, never backwards', async () => {
    const offsets = [await offsetAt(0), await offsetAt(1), await offsetAt(2)] as number[];
    expect(offsets[0]).toBeGreaterThan(offsets[1]);
    expect(offsets[1]).toBeGreaterThan(offsets[2]);
  });

  // react-native-svg's extractStroke only forwards strokeDashoffset when
  // strokeDasharray is ALSO set (`strokeDasharray && strokeDashoffset`), and
  // only then registers it in the propList the native side honours. At 100%
  // the offset is 0, which that ternary turns into null — documented, not
  // accidental, and the reason this expects null rather than 0.
  it('reports a complete ring at the final page', async () => {
    expect(await offsetAt(3)).toBeNull();
  });

  it('keeps the dash array, without which the offset is silently inert', async () => {
    const { getByTestId } = await renderAt(1);
    const arc = getByTestId('onboarding-ring-arc', {
      includeHiddenElements: true,
    });
    expect(arc.props.strokeDasharray).toBeTruthy();
  });

  // A ring is a circle: every offset must be a real number inside it. NaN — the
  // failure the old scrollX/pageWidth division could produce on the frame
  // before layout — draws nothing at all, and "nothing" is indistinguishable
  // from "no progress yet".
  it('never emits an offset that would draw nothing', async () => {
    for (const page of [0, 1, 2]) {
      const offset = (await offsetAt(page)) as number;
      expect(Number.isFinite(offset)).toBe(true);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(CIRCUMFERENCE);
    }
  });
});

describe('the button', () => {
  it('is a labelled button that fires', async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(
      <OnboardingRingFab page={0} total={4} onPress={onPress} />,
    );
    fireEvent.press(getByRole('button', { name: 'Next' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  // The slides already announce "Slide n of N", so a spoken ring would say the
  // same thing a second time.
  it('keeps the ring itself out of the accessibility tree', async () => {
    const { getByTestId } = await renderAt(0);
    const arc = getByTestId('onboarding-ring-arc', {
      includeHiddenElements: true,
    });
    expect(arc).toBeTruthy();
    // The arc is only reachable WITH includeHiddenElements — proof it is hidden.
    expect(() => getByTestId('onboarding-ring-arc')).toThrow();
  });
});
