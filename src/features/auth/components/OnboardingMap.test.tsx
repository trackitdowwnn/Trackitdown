/**
 * WHAT:  Tests for the onboarding map hero — that every stage renders, that it
 *        stays out of the accessibility tree, and that its layers appear in the
 *        order the story needs.
 * WHY:   This is the third attempt at a hero above the onboarding words; the
 *        first two were removed. The things worth pinning are the ones that
 *        made the others wrong rather than merely unfinished: it must say
 *        nothing to a screen reader (the slide's own single node already
 *        announces the whole copy, and a decorative picture that speaks would
 *        interrupt it), and the recovery stage must not arrive early or with a
 *        flourish.
 * LINKS: ./OnboardingMap.tsx; ../screens/OnboardingScreen.tsx (holds the stage);
 *        ../lib/onboardingSlides.ts (which slide asks for which stage).
 */

import { render } from '@testing-library/react-native';

import { ONBOARDING_SLIDES } from '../lib/onboardingSlides';
import { OnboardingMap, type OnboardingMapStage } from './OnboardingMap';

const STAGES: OnboardingMapStage[] = ['scatter', 'posted', 'alerted', 'recovered'];

/** The map is decorative, so every query needs the hidden-elements flag — the
 *  same way OnboardingRingFab's arc is reached. */
const HIDDEN = { includeHiddenElements: true } as const;

describe('stages', () => {
  it.each(STAGES)('renders at stage %s', async (stage) => {
    const view = await render(<OnboardingMap stage={stage} />);

    expect(view.getByTestId('onboarding-map', HIDDEN)).toBeTruthy();
    // Every layer is always mounted — the stage changes opacity, not the tree,
    // so nothing has to re-enter mid-story.
    expect(view.getByTestId('onboarding-map-pins', HIDDEN)).toBeTruthy();
    expect(view.getByTestId('onboarding-map-focal', HIDDEN)).toBeTruthy();
    expect(view.getByTestId('onboarding-map-alert', HIDDEN)).toBeTruthy();
    expect(view.getByTestId('onboarding-map-home', HIDDEN)).toBeTruthy();
  });

  it('survives an unknown stage rather than rendering nothing', async () => {
    // Defensive: `mapStage` is typed, but a slide added without one would fall
    // through to index -1 and, unclamped, hide every layer at once.
    const view = await render(<OnboardingMap stage={'nonsense' as OnboardingMapStage} />);

    expect(view.getByTestId('onboarding-map', HIDDEN)).toBeTruthy();
  });
});

describe('accessibility', () => {
  it('⚠️ says nothing — the slide announces the whole screen', async () => {
    // Reachable ONLY with includeHiddenElements, which is the proof it is out
    // of the tree. A decorative picture that spoke would interrupt the slide's
    // own single node mid-sentence.
    const view = await render(<OnboardingMap stage="scatter" />);

    expect(view.queryByTestId('onboarding-map')).toBeNull();
    expect(view.getByTestId('onboarding-map', HIDDEN)).toBeTruthy();
  });

  it('is not touchable, so it cannot eat the Skip or the ring', async () => {
    const view = await render(<OnboardingMap stage="scatter" />);

    expect(view.getByTestId('onboarding-map', HIDDEN).props.pointerEvents).toBe('none');
  });
});

describe('the slides agree with it', () => {
  it('asks for each stage exactly once, in story order', async () => {
    // The map accumulates one car's story; two slides asking for the same
    // picture would mean a step that shows nothing new.
    expect(ONBOARDING_SLIDES.map((slide) => slide.mapStage)).toEqual(STAGES);
  });
});
