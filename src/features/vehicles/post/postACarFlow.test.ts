/**
 * WHAT:  Smoke tests for the post-a-car flow config — structure (3 phases +
 *        review), per-step zod gating (the keys actually match PostACarAnswers,
 *        which TypeScript can't check), the plate step's onContinue calling the
 *        availability check, and the review-value formatting.
 * WHY:   The framework's types can't tie a step schema's keys to the answers
 *        shape (see wizard/types.ts LIMITATION), so a typo'd key would compile
 *        but never validate — this file is the required per-flow safety net.
 *        The step components are mocked out so the config loads without the
 *        map/slider/picker native graph.
 * LINKS: src/features/vehicles/post/postACarFlow.tsx, docs/TESTING.md.
 */

import { checkPlateAvailable } from './api/postApi';
import { POST_A_CAR_INITIAL_ANSWERS, postACarFlow } from './postACarFlow';
import type { PostACarAnswers } from './types';

// Stub the step components + their exported consts so the config loads without
// pulling in AppMap / MoneySlider / PhotoGridPicker native deps. (babel-jest
// hoists these jest.mock calls above the imports above.)
jest.mock('./components/postSteps', () => ({
  PlateStep: () => null,
  CarDetailsStep: () => null,
  FeaturesStep: () => null,
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

jest.mock('./api/postApi', () => ({
  checkPlateAvailable: jest.fn(),
  // Real (pure) canon logic — the flow's plate gating/review depend on it.
  plateCanon: (plate: string | null | undefined) =>
    (plate ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase(),
}));

const mockCheckPlateAvailable = checkPlateAvailable as jest.Mock;

const stepById = (id: string) => {
  const step = postACarFlow.phases.flatMap((phase) => phase.steps).find((s) => s.id === id);
  if (!step) throw new Error(`no step ${id}`);
  return step;
};

const passes = (id: string, answers: Partial<PostACarAnswers>) =>
  stepById(id).schema.safeParse(answers).success;

beforeEach(() => mockCheckPlateAvailable.mockReset());

describe('postACarFlow structure', () => {
  it('has three phases, a review, and a high-information final CTA', () => {
    expect(postACarFlow.phases).toHaveLength(3);
    expect(postACarFlow.phases.map((p) => p.id)).toEqual(['car', 'when-where', 'bounty-proof']);
    expect(postACarFlow.review).toBeDefined();
    expect(postACarFlow.finalCtaLabel).toBe('Post my car');
  });

  it('every step has an id, question, component, schema, and a review value', () => {
    const steps = postACarFlow.phases.flatMap((p) => p.steps);
    expect(steps).toHaveLength(9);
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
  it('plate is optional (blank/absent advances), but a typed plate needs ≥2 chars', () => {
    expect(passes('plate', {})).toBe(true); // untouched — can skip (plate-less)
    expect(passes('plate', { plate: '' })).toBe(true); // blank — plate-less
    expect(passes('plate', { plate: 'A' })).toBe(false); // typed but too short
    expect(passes('plate', { plate: 'AB12CDE' })).toBe(true);
  });

  it('plate onContinue skips the availability check when blank', async () => {
    const plate = stepById('plate');
    await plate.onContinue?.({ plate: '   ' });
    expect(mockCheckPlateAvailable).not.toHaveBeenCalled();
    await plate.onContinue?.({});
    expect(mockCheckPlateAvailable).not.toHaveBeenCalled();
  });

  it('treats a punctuation-only plate as blank (advances, reviews "No plate")', () => {
    const plate = stepById('plate');
    expect(passes('plate', { plate: '--' })).toBe(true); // canon empty → plate-less
    expect(plate.reviewValue?.({ plate: '--' })).toBe('No plate');
    expect(plate.reviewValue?.({ plate: 'AB12 CDE' })).toBe('AB12 CDE');
    expect(plate.reviewValue?.({})).toBe('No plate');
  });

  it('details need make, model and colour; year is optional but range-bound', () => {
    expect(passes('details', { make: 'BMW', model: '320d' })).toBe(false);
    expect(passes('details', { make: 'BMW', model: '320d', colour: 'Blue' })).toBe(true);
    expect(passes('details', { make: 'BMW', model: '320d', colour: 'Blue', year: 2019 })).toBe(true);
    // Out-of-range year is rejected at the step (posts.year CHECK is 1900–2100).
    expect(passes('details', { make: 'BMW', model: '320d', colour: 'Blue', year: 19 })).toBe(false);
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

  it('features and theft context are optional (always advanceable)', () => {
    expect(passes('features', {})).toBe(true);
    expect(passes('theft-context', {})).toBe(true);
  });
});

describe('plate onContinue', () => {
  it('runs the availability check and propagates its rejection', async () => {
    const plate = stepById('plate');
    mockCheckPlateAvailable.mockResolvedValueOnce(undefined);
    await plate.onContinue?.({ plate: 'AB12CDE' });
    expect(mockCheckPlateAvailable).toHaveBeenCalledWith('AB12CDE');

    mockCheckPlateAvailable.mockRejectedValueOnce(new Error('That plate already has an active post.'));
    await expect(plate.onContinue?.({ plate: 'XX99XXX' })).rejects.toThrow(
      'That plate already has an active post.',
    );
  });
});

describe('review values', () => {
  it('formats the car, features, theft and bounty summaries', () => {
    const answers: Partial<PostACarAnswers> = {
      make: 'BMW',
      model: '320d',
      colour: 'Blue',
      year: 2019,
      featureKeys: ['tow_bar', 'dashcam'],
      stolenFrom: 'driveway',
      keysTaken: 'yes',
      bountyAmountPence: 30000,
    };
    expect(stepById('details').reviewValue?.(answers)).toBe('BMW 320d, Blue (2019)');
    expect(stepById('features').reviewValue?.(answers)).toBe('Tow bar, Dashcam');
    expect(stepById('theft-context').reviewValue?.(answers)).toBe('Driveway · keys taken');
    expect(stepById('bounty').reviewValue?.(answers)).toBe('£300');
  });

  it('shows friendly placeholders when optional fields are empty', () => {
    expect(stepById('features').reviewValue?.({})).toBe('None added');
    expect(stepById('theft-context').reviewValue?.({})).toBe('Not added');
  });

  it('appends the guided descriptions so they show on review', () => {
    expect(
      stepById('features').reviewValue?.({ featureKeys: ['dashcam'], descRecognise: 'Big dent' }),
    ).toBe('Dashcam · Big dent');
    expect(stepById('features').reviewValue?.({ descRecognise: 'Big dent' })).toBe('Big dent');
    expect(
      stepById('theft-context').reviewValue?.({ keysTaken: 'no', descDrives: 'Rattles' }),
    ).toBe('keys not taken · Rattles');
  });
});
