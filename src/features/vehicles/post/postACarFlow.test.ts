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
  YearStep: () => null,
  DistinctiveMarksStep: () => null,
  PhotosStep: () => null,
  LastSeenWhenStep: () => null,
  LastSeenWhereStep: () => null,
  TheftContextStep: () => null,
  BountyStep: () => null,
  VerificationStep: () => null,
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
    expect(postACarFlow.phases.map((p) => p.id)).toEqual(['car', 'when-where', 'bounty-proof']);
    expect(postACarFlow.review).toBeDefined();
    expect(postACarFlow.finalCtaLabel).toBe('Post my car');
  });

  it('every step has an id, question, component, schema, and a review value', () => {
    const steps = postACarFlow.phases.flatMap((p) => p.steps);
    expect(steps).toHaveLength(11);
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

  it('last-seen-where needs a settled location; verification needs an image', () => {
    expect(passes('last-seen-where', {})).toBe(false);
    expect(
      passes('last-seen-where', {
        location: { latitude: 1, longitude: 2, addressLabel: 'Manchester' },
      }),
    ).toBe(true);
    expect(passes('verification', {})).toBe(false);
    expect(passes('verification', { verification: { uri: 'file://v', width: 10, height: 10 } })).toBe(
      true,
    );
  });

  it('theft context is optional (always advanceable)', () => {
    expect(passes('theft-context', {})).toBe(true);
  });

  it('distinctive marks gates Next on ≥1 mark (empty disables Next — use None to add)', () => {
    expect(passes('distinctive-marks', {})).toBe(false); // untouched — Next disabled
    expect(passes('distinctive-marks', { distinctiveFeatures: [] })).toBe(false); // empty
    expect(
      passes('distinctive-marks', {
        distinctiveFeatures: [{ photo: { uri: 'a', width: 1, height: 1 }, description: 'Dent' }],
      }),
    ).toBe(true);
  });
});

describe('review values', () => {
  it('formats the car, features, theft and bounty summaries', () => {
    const answers: Partial<PostACarAnswers> = {
      make: 'BMW',
      model: '320d',
      colour: 'Blue',
      year: 2019,
      stolenFrom: 'driveway',
      keysTaken: 'yes',
      bountyAmountPence: 30000,
    };
    expect(stepById('make').reviewValue?.(answers)).toBe('BMW');
    expect(stepById('model').reviewValue?.(answers)).toBe('320d');
    expect(stepById('colour').reviewValue?.(answers)).toBe('Blue');
    expect(stepById('year').reviewValue?.(answers)).toBe('2019');
    expect(stepById('theft-context').reviewValue?.(answers)).toBe('Driveway · keys taken');
    expect(stepById('bounty').reviewValue?.(answers)).toBe('£300');
  });

  it('shows friendly placeholders when optional fields are empty', () => {
    expect(stepById('distinctive-marks').reviewValue?.({})).toBe('None added');
    expect(stepById('theft-context').reviewValue?.({})).toBe('Not added');
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

  it('reviews distinctive marks as a count', () => {
    expect(
      stepById('distinctive-marks').reviewValue?.({
        distinctiveFeatures: [
          { photo: { uri: 'a', width: 1, height: 1 }, description: 'Dent' },
          { photo: { uri: 'b', width: 1, height: 1 }, description: 'Sticker' },
        ],
      }),
    ).toBe('2 added');
    expect(
      stepById('theft-context').reviewValue?.({ keysTaken: 'no', descDrives: 'Rattles' }),
    ).toBe('keys not taken · Rattles');
  });
});
