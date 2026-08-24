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
import { StyleSheet } from 'react-native';

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
    expect(view.getByTestId('onboarding-map-alert-far', HIDDEN)).toBeTruthy();
    expect(view.getByTestId('onboarding-map-home', HIDDEN)).toBeTruthy();
  });

  it('survives an unknown stage rather than rendering nothing', async () => {
    // Defensive: `mapStage` is typed, but a slide added without one would fall
    // through to index -1 and, unclamped, hide every layer at once.
    const view = await render(<OnboardingMap stage={'nonsense' as OnboardingMapStage} />);

    expect(view.getByTestId('onboarding-map', HIDDEN)).toBeTruthy();
  });
});

describe('⚠️ what each stage actually SHOWS', () => {
  // The whole point of the component, and it was untested. Every layer is
  // mounted at every stage, so the previous "is it there?" assertions passed
  // for the draft that fired the alert a slide late, put the focal pin at the
  // wrong step, and rendered the post and spot slides identically.
  const opacityOf = (view: ReturnType<typeof render> extends Promise<infer V> ? V : never, id: string) =>
    StyleSheet.flatten(view.getByTestId(id, HIDDEN).props.style)?.opacity;

  const shown = async (stage: OnboardingMapStage) => {
    const view = await render(<OnboardingMap stage={stage} />);
    return {
      focal: opacityOf(view, 'onboarding-map-focal'),
      near: opacityOf(view, 'onboarding-map-alert'),
      far: opacityOf(view, 'onboarding-map-alert-far'),
      home: opacityOf(view, 'onboarding-map-home'),
    };
  };

  it('scatter: cars nearby, nothing of yours yet', async () => {
    expect(await shown('scatter')).toEqual({ focal: 0, near: 0, far: 0, home: 0 });
  });

  it('posted: your car appears and the alert leaves it', async () => {
    // The alert must be visible HERE, on the slide whose body says people
    // nearby are told. The draft gated it on the next slide, so the one screen
    // that claimed it showed no alert at all.
    expect(await shown('posted')).toEqual({ focal: 1, near: 1, far: 0, home: 0 });
  });

  it('alerted: the alert reaches the neighbours — a NEW picture', async () => {
    // Distinct from `posted`. One gate for both rings made these two slides
    // pixel-identical: four named stages, three pictures.
    expect(await shown('alerted')).toEqual({ focal: 1, near: 1, far: 1, home: 0 });
  });

  it('recovered: the alert is over and the car settles', async () => {
    expect(await shown('recovered')).toEqual({ focal: 1, near: 0, far: 0, home: 1 });
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
