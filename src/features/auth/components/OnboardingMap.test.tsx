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

/** The map is decorative — `accessibilityElementsHidden` plus
 *  `no-hide-descendants` — so it is out of the queryable tree entirely and
 *  every query here needs the hidden-elements flag to reach it. That it is
 *  unreachable WITHOUT the flag is itself asserted, below. */
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
      trail: opacityOf(view, 'onboarding-map-trail'),
      trailHome: opacityOf(view, 'onboarding-map-trail-home'),
    };
  };

  it('scatter: cars nearby, nothing of yours yet', async () => {
    expect(await shown('scatter')).toEqual({
      focal: 0,
      near: 0,
      far: 0,
      home: 0,
      trail: 0,
      trailHome: 0,
    });
  });

  it('posted: your car appears and the alert leaves it', async () => {
    // The alert must be visible HERE, on the slide whose body says people
    // nearby are told. The draft gated it on the next slide, so the one screen
    // that claimed it showed no alert at all.
    //
    // ⚠️ AND STILL NO TRAIL. Sightings are what people do AFTER they are
    // alerted; a report on the screen that announces the post would be a
    // sighting of a car nobody had been told about.
    expect(await shown('posted')).toEqual({
      focal: 1,
      near: 1,
      far: 0,
      home: 0,
      trail: 0,
      trailHome: 0,
    });
  });

  it('alerted: the alert reaches the neighbours — a NEW picture', async () => {
    // Distinct from `posted`, and since 2026-09-05 by SUBSTITUTION rather than
    // addition: the outer ring REPLACES the inner one, so the alert reads as a
    // pulse propagating outward instead of a bullseye stacking up under the
    // trail on the busiest slide. (The two-ring version answered "the post and
    // spot slides were pixel-identical" by putting both rings up at once; one
    // ring per step answers it with less ink.)
    expect(await shown('alerted')).toEqual({
      focal: 1,
      near: 0,
      far: 1,
      home: 0,
      trail: 1,
      trailHome: 0,
    });
  });

  it('recovered: the alert is over and the car settles', async () => {
    expect(await shown('recovered')).toEqual({
      focal: 1,
      near: 0,
      far: 0,
      home: 1,
      trail: 1,
      trailHome: 1,
    });
  });

  // ⚠️ THE INVARIANT BEHIND ALL FOUR, stated once so a future stage cannot
  // quietly break it: the picture only ever GAINS as the story moves, except
  // the alert rings, which are a moment rather than a state. The recovery slide
  // is the one this protects — before the trail's last leg existed it was the
  // only step whose picture purely subtracted, which is a strange note to end
  // an intro on.
  it('never leaves a slide with less than the one before, rings aside', async () => {
    const marks = (s: Awaited<ReturnType<typeof shown>>): number[] => [
      s.focal,
      s.home,
      s.trail,
      s.trailHome,
    ];
    const story = [
      marks(await shown('scatter')),
      marks(await shown('posted')),
      marks(await shown('alerted')),
      marks(await shown('recovered')),
    ];

    for (let i = 1; i < story.length; i += 1) {
      story[i].forEach((value, layer) => {
        expect(value).toBeGreaterThanOrEqual(story[i - 1][layer]);
      });
    }
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

  it('is not touchable, so it cannot eat the X or the button', async () => {
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
