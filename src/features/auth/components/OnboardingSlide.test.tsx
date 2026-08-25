/**
 * WHAT:  Tests for OnboardingSlide — the whole spoken label, the headline's
 *        weight runs resolving to real font families, and the safety pill.
 * WHY:   No test covered this component before 2026-08-08. The screen's suite
 *        anchors only the START of slide 1's label (`toMatch(/^Slide 1 of 4…/)`),
 *        so a mangled tail — a dropped body sentence, a doubled space, a lost
 *        safety line — was invisible. These assert the label in full.
 *
 *        The fontWeight pin is the one place the design system's "weight is a
 *        FAMILY, never fontWeight" rule can actually be enforced. Break it and
 *        Android synthesises a fake bold on top of Satoshi-Black, at which
 *        point the emphasised and plain runs stop being distinguishable — a
 *        platform-specific failure no reviewer on a Mac would ever see.
 * LINKS: ./OnboardingSlide.tsx; ../lib/onboardingSlides.ts;
 *        src/shared/theme/typography.ts; docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';

import { typography } from '@/shared/theme';

import { ONBOARDING_SAFETY_LINE, ONBOARDING_SLIDES } from '../lib/onboardingSlides';
import { OnboardingSlide } from './OnboardingSlide';

async function renderSlide(index: number) {
  return render(
    <OnboardingSlide
      slide={ONBOARDING_SLIDES[index]}
      index={index}
      total={ONBOARDING_SLIDES.length}
    />,
  );
}

describe('the spoken label', () => {
  // In full, not anchored: the tail is where the damage hides.
  it('announces position, headline and body as one sentence', async () => {
    const { getByTestId } = await renderSlide(0);
    expect(getByTestId('onboarding-slide-0').props.accessibilityLabel).toBe(
      'Slide 1 of 4. Stolen cars, on one map. ' +
        'Owners list cars that have gone missing. ' +
        'People passing keep an eye out.',
    );
  });

  // SAFETY: the safety line is appended separately, so a `toContain` check
  // would pass even with a completely mangled headline. This pins the whole.
  it('appends the safety line to the spot-it slide, in full', async () => {
    const { getByTestId } = await renderSlide(2);
    expect(getByTestId('onboarding-slide-2').props.accessibilityLabel).toBe(
      'Slide 3 of 4. Spot it? Report it — from a distance. ' +
        'Snap a photo in the app and we handle the rest. ' +
        `${ONBOARDING_SAFETY_LINE}`,
    );
  });

  it('renders the safety wording on screen too, not only to a reader', async () => {
    const { getByText } = await renderSlide(2);
    expect(getByText(ONBOARDING_SAFETY_LINE)).toBeTruthy();
  });
});

describe('the headline weights', () => {
  it('sets emphasised runs in Black and plain runs in Regular', async () => {
    const { getByText } = await renderSlide(1);

    // "Your car, stolen? Post it." — the instruction is emphasised, the
    // reader's situation is not.
    const emphasised = getByText(' Post it.');
    const plain = getByText('Your car, stolen?');

    expect(emphasised.props.style).toEqual(
      expect.objectContaining({
        fontFamily: typography.displayHero.fontFamily,
      }),
    );
    expect(plain.props.style ?? {}).not.toEqual(
      expect.objectContaining({
        fontFamily: typography.displayHero.fontFamily,
      }),
    );
  });

  // "Weight is expressed as a FAMILY, never fontWeight" (DESIGN_SYSTEM.md).
  it('never reaches for fontWeight', async () => {
    const view = await renderSlide(3);
    expect(JSON.stringify(view.toJSON())).not.toMatch(/fontWeight/);
  });
});
