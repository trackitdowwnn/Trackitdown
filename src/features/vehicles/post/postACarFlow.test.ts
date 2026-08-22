/**
 * WHAT:  Smoke tests for the post-a-car flow config — structure (3 phases +
 *        review), per-step zod gating (the keys actually match PostACarAnswers,
 *        which TypeScript can't check), and the review-value formatting.
 * WHY:   The framework's types can't tie a step schema's keys to the answers
 *        shape (see wizard/types.ts LIMITATION), so a typo'd key would compile
 *        but never validate — this file is the required per-flow safety net.
 *        The step components are mocked out so the config loads without the
 *        map/slider/picker native graph.
 * LINKS: src/features/vehicles/post/postACarFlow.tsx, docs/TESTING.md.
 */

import { POST_A_CAR_INITIAL_ANSWERS, postACarFlow } from './postACarFlow';
import type { PostACarAnswers } from './types';

// Stub the step components + their exported consts so the config loads without
// pulling in AppMap / MoneySlider / PhotoGridPicker native deps. (babel-jest
// hoists these jest.mock calls above the imports above.)
jest.mock('./components/postSteps', () => ({
  MakeStep: () => null,
  ModelStep: () => null,
  ColourStep: () => null,
  BodyTypeStep: () => null,
  YearStep: () => null,
  DistinctiveFeaturesStep: () => null,
  PhotosStep: () => null,
  LastSeenWhenStep: () => null,
  LastSeenWhereStep: () => null,
  DescriptionStep: () => null,
  PricingModeStep: () => null,
  BountyStep: () => null,
  MIN_BOUNTY_PENCE: 5000,
  MAX_BOUNTY_PENCE: 500000,
  DEFAULT_BOUNTY_PENCE: 25000,
}));

const stepById = (id: string) => {
  const step = postACarFlow.phases.flatMap((phase) => phase.steps).find((s) => s.id === id);
  if (!step) throw new Error(`no step ${id}`);
  return step;
};

const passes = (id: string, answers: Partial<PostACarAnswers>) =>
  stepById(id).schema.safeParse(answers).success;

describe('postACarFlow structure', () => {
  it('has three phases, a review, and a high-information final CTA', () => {
    expect(postACarFlow.phases).toHaveLength(3);
    expect(postACarFlow.phases.map((p) => p.id)).toEqual(['car', 'when-where', 'bounty']);
    expect(postACarFlow.review).toBeDefined();
    // The final CTA is dynamic — it names the amount the owner is about to pay,
    // in BOTH pricing modes. A payment button is never vague about the sum.
    expect(typeof postACarFlow.finalCtaLabel).toBe('function');
    const label = postACarFlow.finalCtaLabel as (a: Partial<PostACarAnswers>) => string;
    expect(label({ pricingMode: 'bounty', bountyAmountPence: 25000 })).toBe('Post & pay £250');
    // No-reward listing: the CTA names the FEE, not the slider's retained value.
    expect(label({ pricingMode: 'fee', bountyAmountPence: 25000 })).toBe('Post & pay £5');
    // Falls back to the seeded default when the bounty answer is absent.
    expect(label({})).toMatch(/^Post & pay £/);
  });

  it('every step has an id, question, component, schema, and a review value', () => {
    const steps = postACarFlow.phases.flatMap((p) => p.steps);
    expect(steps).toHaveLength(12);
    for (const step of steps) {
      expect(step.id).toBeTruthy();
      expect(step.question).toBeTruthy();
      expect(step.component).toBeTruthy();
      expect(typeof step.schema.safeParse).toBe('function');
      expect(step.reviewValue).toBeDefined();
    }
  });

  it('seeds a starting bounty so the slider step begins valid', () => {
    expect(passes('bounty', POST_A_CAR_INITIAL_ANSWERS)).toBe(true);
  });

  // ADR-0014: the pricing choice.
  it('does NOT seed a pricing mode — the owner must choose', () => {
    // Both defaults are wrong: 'bounty' makes the £50 minimum feel pre-agreed
    // (the barrier this change removes), 'fee' nudges them off a reward that
    // makes their car more likely to be found. So Next stays disabled.
    expect(POST_A_CAR_INITIAL_ANSWERS.pricingMode).toBeUndefined();
    expect(passes('pricing-mode', POST_A_CAR_INITIAL_ANSWERS)).toBe(false);
  });

  it('gates the pricing step on a real choice', () => {
    expect(passes('pricing-mode', {})).toBe(false);
    expect(passes('pricing-mode', { pricingMode: 'bounty' })).toBe(true);
    expect(passes('pricing-mode', { pricingMode: 'fee' })).toBe(true);
  });

  it('walks past the bounty slider when there is no reward to set', () => {
    const when = stepById('bounty').when;
    expect(when).toBeDefined();
    const visible = (answers: Partial<PostACarAnswers>) => when?.(answers) ?? true;
    expect(visible({ pricingMode: 'fee' })).toBe(false);
    expect(visible({ pricingMode: 'bounty' })).toBe(true);
    // Mode not chosen yet: the step stays visible, so a half-filled flow never
    // silently skips the money question.
    expect(visible({})).toBe(true);
  });

  it('reviews a no-reward listing as the fee, not as a bounty', () => {
    const review = stepById('pricing-mode').reviewValue;
    expect(review?.({ pricingMode: 'fee' })).toBe('No reward · £5 fee');
    expect(review?.({ pricingMode: 'bounty' })).toBe('Reward offered');
  });
});

describe('step gating', () => {
  it('make is its own step and requires a non-empty make', () => {
    expect(passes('make', {})).toBe(false);
    expect(passes('make', { make: '' })).toBe(false);
    expect(passes('make', { make: 'BMW' })).toBe(true);
  });

  it('model is its own step and requires a non-empty model', () => {
    expect(passes('model', { make: 'BMW' })).toBe(false);
    expect(passes('model', { make: 'BMW', model: '' })).toBe(false);
    expect(passes('model', { make: 'BMW', model: '3 Series' })).toBe(true);
  });

  it('the model step title folds in the chosen make ("Which BMW model?")', () => {
    const { question } = stepById('model');
    // Dynamic question: a function of the answers so far (the make picked in
    // the previous step). No make yet → the generic title.
    expect(typeof question).toBe('function');
    const resolve = (answers: Partial<PostACarAnswers>) =>
      typeof question === 'function' ? question(answers) : question;
    expect(resolve({ make: 'BMW' })).toBe('Which BMW model?');
    expect(resolve({ make: '  Land Rover  ' })).toBe('Which Land Rover model?');
    expect(resolve({})).toBe('Which model?');
    expect(resolve({ make: '   ' })).toBe('Which model?');
  });

  it('colour is its own step and requires a non-empty colour', () => {
    expect(passes('colour', {})).toBe(false);
    expect(passes('colour', { colour: '' })).toBe(false);
    expect(passes('colour', { colour: 'Blue' })).toBe(true);
  });

  it('year is its own step, optional but range-bound', () => {
    // Optional — untouched advances.
    expect(passes('year', {})).toBe(true);
    expect(passes('year', { year: 2019 })).toBe(true);
    // Out-of-range year is rejected at the step (posts.year CHECK is 1900–2100).
    expect(passes('year', { year: 19 })).toBe(false);
    expect(passes('year', { year: 2200 })).toBe(false);
  });

  it('photos require 3 to 6', () => {
    const photo = { uri: 'file://a', width: 10, height: 10 };
    expect(passes('photos', { photos: [photo, photo] })).toBe(false);
    expect(passes('photos', { photos: [photo, photo, photo] })).toBe(true);
    expect(passes('photos', { photos: Array(7).fill(photo) })).toBe(false);
  });

  it('bounty must be within £50–£5,000', () => {
    expect(passes('bounty', { bountyAmountPence: 4999 })).toBe(false);
    expect(passes('bounty', { bountyAmountPence: 25000 })).toBe(true);
    expect(passes('bounty', { bountyAmountPence: 500001 })).toBe(false);
  });

  it('last-seen-where needs a settled location', () => {
    expect(passes('last-seen-where', {})).toBe(false);
    expect(
      passes('last-seen-where', {
        location: { latitude: 1, longitude: 2, addressLabel: 'Manchester' },
      }),
    ).toBe(true);
  });

  it('description gates Next on 20+ characters, but stays SKIPPABLE', () => {
    // Two rules pulling in opposite directions, both of which must hold. The
    // schema blocks Next on a two-word description that would help nobody pick
    // this car out of a car park...
    expect(passes('description', {})).toBe(false);
    expect(passes('description', { descRecognise: 'blue one' })).toBe(false);
    // ...whitespace cannot buy its way past the minimum (the on-screen counter
    // trims too, so the count and the button always agree)...
    expect(passes('description', { descRecognise: ' '.repeat(40) })).toBe(false);
    expect(
      passes('description', { descRecognise: 'Silver Golf, dent on the rear nearside door' }),
    ).toBe(true);
    // ...and 1000 is the ceiling, mirroring posts.desc_recognise's own CHECK so
    // the client can never compose a row the database will reject.
    expect(passes('description', { descRecognise: 'x'.repeat(1000) })).toBe(true);
    expect(passes('description', { descRecognise: 'x'.repeat(1001) })).toBe(false);

    // ...while `optional` stops the REVIEW screen re-checking that schema at
    // submit. Without it, skipping the step would leave the post unpublishable
    // — the gate would have become a trap.
    expect(stepById('description').optional).toBe(true);
  });

  it('the body-type step is REQUIRED (Next gated on a pick; "Not sure" satisfies it)', () => {
    expect(passes('body-type', {})).toBe(false);
    expect(passes('body-type', { bodyType: 'SUV' })).toBe(true);
    expect(passes('body-type', { bodyType: 'Not sure' })).toBe(true);
    expect(stepById('body-type').reviewValue?.({ bodyType: 'SUV' })).toBe('SUV');
    expect(stepById('body-type').reviewValue?.({})).toBe('Not provided');
  });

  it('distinctive features gates Next on ≥1 mark (empty disables Next — use None to add)', () => {
    expect(passes('distinctive-features', {})).toBe(false); // untouched — Next disabled
    expect(passes('distinctive-features', { distinctiveFeatures: [] })).toBe(false); // empty
    expect(
      passes('distinctive-features', {
        distinctiveFeatures: [{ photo: { uri: 'a', width: 1, height: 1 }, description: 'Dent' }],
      }),
    ).toBe(true);
  });

  it('distinctive features is OPTIONAL, so skipping it (0 marks) does not block Post & pay', () => {
    // The step's Next needs ≥1 mark, but it must be skippable to submission —
    // otherwise "None to add" is a dead end (the review CTA stays disabled).
    expect(stepById('distinctive-features').optional).toBe(true);
  });
});

describe('review values', () => {
  it('formats the car, description and bounty summaries', () => {
    const answers: Partial<PostACarAnswers> = {
      make: 'BMW',
      model: '320d',
      colour: 'Blue',
      year: 2019,
      descRecognise: 'Dented rear door',
      bountyAmountPence: 30000,
    };
    expect(stepById('make').reviewValue?.(answers)).toBe('BMW');
    expect(stepById('model').reviewValue?.(answers)).toBe('320d');
    expect(stepById('colour').reviewValue?.(answers)).toBe('Blue');
    expect(stepById('year').reviewValue?.(answers)).toBe('2019');
    expect(stepById('description').reviewValue?.(answers)).toBe('Dented rear door');
    expect(stepById('bounty').reviewValue?.(answers)).toBe('£300');
  });

  it('shows friendly placeholders when optional fields are empty', () => {
    expect(stepById('distinctive-features').reviewValue?.({})).toBe('None added');
    expect(stepById('description').reviewValue?.({})).toBe('Not added');
    expect(stepById('year').reviewValue?.({})).toBe('Not provided');
  });

  it('appends the colour note to the colour review when present (wrapped/other)', () => {
    expect(
      stepById('colour').reviewValue?.({
        colour: 'Multicolour / wrapped',
        colourNote: 'matte black wrap over silver',
      }),
    ).toBe('Multicolour / wrapped — matte black wrap over silver');
    // A plain colour with no note shows just the colour.
    expect(stepById('colour').reviewValue?.({ colour: 'Blue' })).toBe('Blue');
  });

  it('reviews distinctive features as a count', () => {
    expect(
      stepById('distinctive-features').reviewValue?.({
        distinctiveFeatures: [
          { photo: { uri: 'a', width: 1, height: 1 }, description: 'Dent' },
          { photo: { uri: 'b', width: 1, height: 1 }, description: 'Sticker' },
        ],
      }),
    ).toBe('2 added');
    expect(
      stepById('description').reviewValue?.({ descRecognise: 'Blue, dented rear door' }),
    ).toBe('Blue, dented rear door');
    // Blank description reviews as "Not added".
    expect(stepById('description').reviewValue?.({})).toBe('Not added');
  });
});
