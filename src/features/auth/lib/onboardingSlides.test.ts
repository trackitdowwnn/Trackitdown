/**
 * WHAT:  Pins the onboarding copy — every headline flattened back to a literal
 *        string, the safety line's placement, and the weight contrast that
 *        makes the headlines readable as designed.
 * WHY:   The headlines became weight RUNS on 2026-08-08, and the split is
 *        invisible in the rendered output: "People " + "nearby" reads exactly
 *        like "People" + " nearby" on screen, and both look right. Only the
 *        accessibility label can tell them apart, because it concatenates the
 *        runs — so a join(' ') where join('') belongs would double every space
 *        in every spoken label while the screen stayed perfect. Nothing else in
 *        the suite would notice. These literals are that guard.
 *
 *        The strings below are the PRODUCT WORDING. They are written out in
 *        full rather than derived, so changing the copy has to be a deliberate
 *        edit here as well as in the data.
 * LINKS: ./onboardingSlides.ts; ../types.ts (why runs, and the join rule);
 *        ../components/OnboardingSlide.tsx; docs/TESTING.md.
 */

import { headlineText, ONBOARDING_SAFETY_LINE, ONBOARDING_SLIDES } from './onboardingSlides';

describe('the copy, character for character', () => {
  it('flattens each headline to exactly the sentence it was written as', () => {
    const spoken = ONBOARDING_SLIDES.map((slide) => headlineText(slide.headline));
    expect(spoken).toEqual([
      // The premise, added 2026-08-23: the flow used to open mid-story on
      // 'Your car, stolen?', which assumes the reader already knows what this
      // app is. Nobody seeing this screen does.
      'Stolen cars, on one map.',
      'Your car, stolen? Post it.',
      'Spot it? Report it — from a distance.',
      'Recovered — bounty paid.',
    ]);
  });

  // The specific failure the literals above exist to catch, stated once on its
  // own so the reason survives a refactor of the list.
  it('never doubles a space when joining runs', () => {
    for (const slide of ONBOARDING_SLIDES) {
      expect(headlineText(slide.headline)).not.toMatch(/ {2}/);
    }
  });
});

describe('the weight contrast', () => {
  // A headline flattened back to one run would render as a single weight and
  // lose the alternation the design is built on — while every copy assertion
  // above still passed, because the words would be unchanged.
  it('gives every headline both an emphasised and a plain run', () => {
    for (const slide of ONBOARDING_SLIDES) {
      const emphasised = slide.headline.filter((run) => run.emphasis);
      const plain = slide.headline.filter((run) => !run.emphasis);
      expect(emphasised.length).toBeGreaterThan(0);
      expect(plain.length).toBeGreaterThan(0);
    }
  });

  it('never leaves a run empty', () => {
    for (const slide of ONBOARDING_SLIDES) {
      for (const run of slide.headline) {
        expect(run.text.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('the safety line', () => {
  // SAFETY: the report-don't-approach seed. Word-for-word, on the spot-it
  // slide and nowhere else — repeating it would dilute it, moving it would put
  // it somewhere the reader has no reason to be looking.
  it('carries the exact wording, on the spot-it slide alone', () => {
    const carrying = ONBOARDING_SLIDES.filter((slide) => slide.safetyLine);
    expect(carrying).toHaveLength(1);
    expect(carrying[0].key).toBe('spot');
    expect(carrying[0].safetyLine).toBe('Never approach or follow a vehicle.');
    expect(ONBOARDING_SAFETY_LINE).toBe('Never approach or follow a vehicle.');
  });
});
