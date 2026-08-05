/**
 * WHAT:  Tests for OnboardingPlate — the shared registration-plate hero: the
 *        mark itself, all four status stamps mounted for cross-fading, the
 *        bounty on the payoff state only, and its silence to assistive tech.
 * WHY:   The plate is the whole point of the redesigned intro, and two of its
 *        properties fail SILENTLY. If the stamps stop being mounted together
 *        the cross-fade turns into a pop, and nothing else in the suite would
 *        notice. If the block ever becomes accessible, a screen-reader user
 *        hears a registration mark spelled out between them and the actual
 *        message — the slides already announce the full copy.
 * LINKS: src/features/auth/components/OnboardingPlate.tsx;
 *        src/features/auth/lib/onboardingSlides.ts; docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';

import {
  ONBOARDING_BOUNTY,
  ONBOARDING_PLATE,
  ONBOARDING_SLIDES,
} from '../lib/onboardingSlides';
import { OnboardingPlate } from './OnboardingPlate';

const scrollX = { value: 0, get: () => 0, set: () => {} } as never;

// No return annotation: render() is async here, so its result type is the
// promise's — let TypeScript infer it rather than restating it wrongly.
function renderPlate(reduceMotion = false) {
  return render(<OnboardingPlate scrollX={scrollX} pageWidth={390} reduceMotion={reduceMotion} />);
}

/** The whole block is hidden from assistive tech, and RNTL skips hidden
 *  subtrees by default — so every query here must opt back in. That the
 *  plain queries find NOTHING is the point of the accessibility test below. */
const HIDDEN = { includeHiddenElements: true } as const;

describe('OnboardingPlate', () => {
  it('shows the registration mark and the country band', async () => {
    const view = await renderPlate();

    expect(view.getByText(ONBOARDING_PLATE, HIDDEN)).toBeTruthy();
    // The band is what makes a white rectangle read as a numberplate.
    expect(view.getByText('UK', HIDDEN)).toBeTruthy();
  });

  it('mounts every status stamp at once so they can cross-fade', async () => {
    const view = await renderPlate();

    // All four present simultaneously — opacity, not mounting, is what
    // selects the visible one. Swap that and the swipe pops instead of fades.
    for (const slide of ONBOARDING_SLIDES) {
      expect(view.getByText(slide.stamp, HIDDEN)).toBeTruthy();
    }
  });

  it('names the bounty on the recovery state and nowhere else', async () => {
    const view = await renderPlate();

    expect(view.getAllByText(`${ONBOARDING_BOUNTY} paid`, HIDDEN)).toHaveLength(1);
  });

  it('stays out of the accessibility tree entirely', async () => {
    const view = await renderPlate();

    // Nothing inside it is reachable by a normal query — which is exactly
    // what a screen reader sees.
    expect(view.queryByText(ONBOARDING_PLATE)).toBeNull();

    const block = view.getByTestId('onboarding-plate', HIDDEN);
    expect(block.props.accessibilityElementsHidden).toBe(true);
    expect(block.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('renders the same content under reduced motion', async () => {
    // Reduced motion drops the drift, never the information.
    const view = await renderPlate(true);

    expect(view.getByText(ONBOARDING_PLATE, HIDDEN)).toBeTruthy();
    expect(view.getByText(ONBOARDING_SLIDES[0].stamp, HIDDEN)).toBeTruthy();
  });

  it('carries no placeholder emoji — the art slot is gone, not hidden', async () => {
    // Regression pin for the redesign: the old intro drew 🚗 📣 📸 🎉 in grey
    // circles, and the 🎉 in particular was the wrong register for someone
    // whose car had just been stolen.
    const view = await renderPlate();

    expect(JSON.stringify(view.toJSON())).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});
