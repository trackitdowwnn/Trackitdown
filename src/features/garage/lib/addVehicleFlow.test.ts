/**
 * WHAT:  Smoke tests for the add-a-car flow config — that it is built from the
 *        SHARED vehicle steps (not a second copy), that its zod keys really
 *        match AddVehicleAnswers, and that the garage's two deliberate
 *        divergences from posting hold: photos are optional here, and the
 *        garage-only plate/nickname steps never block the save.
 * WHY:   The framework can't tie a step schema's keys to the answers shape (see
 *        wizard/types.ts LIMITATION), so a typo'd key compiles but never
 *        validates — every flow needs this net. The step-id comparison against
 *        the posting flow is the real point though: it is the regression test
 *        for the whole shared-sub-flow design. If someone ever forks the seven
 *        steps back into two copies, this fails.
 * LINKS: src/features/garage/lib/addVehicleFlow.tsx;
 *        src/features/vehicles/post/lib/vehicleSteps.tsx, docs/TESTING.md.
 */

import { buildVehicleSteps } from '@/features/vehicles';

import { buildAddVehicleFlow } from './addVehicleFlow';

// Stub the step components so the config loads without the picker/map native
// graph (the same treatment postACarFlow.test gives its own steps).
jest.mock('@/features/vehicles', () => ({
  buildVehicleSteps: jest.requireActual('@/features/vehicles/post/lib/vehicleSteps')
    .buildVehicleSteps,
}));
jest.mock('@/features/vehicles/post/components/postSteps', () => ({
  MakeStep: () => null,
  ModelStep: () => null,
  ColourStep: () => null,
  BodyTypeStep: () => null,
  YearStep: () => null,
  DistinctiveFeaturesStep: () => null,
  PhotosStep: () => null,
}));
jest.mock('../components/garageSteps', () => ({
  PlateStep: () => null,
  NicknameStep: () => null,
}));

const flow = buildAddVehicleFlow();
const steps = flow.phases.flatMap((phase) => phase.steps);
const stepById = (id: string) => {
  const step = steps.find((s) => s.id === id);
  if (!step) throw new Error(`no step ${id}`);
  return step;
};
const passes = (id: string, answers: Record<string, unknown>) =>
  stepById(id).schema.safeParse(answers).success;

describe('add-vehicle flow structure', () => {
  it('is one phase with no intro — a calm peacetime task, not the posting wizard', () => {
    expect(flow.phases).toHaveLength(1);
    expect(flow.phases[0].intro).toBeUndefined();
  });

  it('uses the SHARED vehicle steps, in the same order as posting', () => {
    const shared = buildVehicleSteps({ minPhotos: 0 }).map((s) => s.id);
    const ids = steps.map((s) => s.id);

    // The garage's own steps bracket the shared slice: plate first, nickname last.
    expect(ids[0]).toBe('plate');
    expect(ids[ids.length - 1]).toBe('nickname');
    expect(ids.slice(1, -1)).toEqual(shared);
  });

  it('saves rather than pays — the CTA promises no charge', () => {
    expect(flow.finalCtaLabel).toBe('Save to my garage');
  });
});

describe('garage-only steps never block the save', () => {
  it('plate is optional and validates a real plate', () => {
    expect(stepById('plate').optional).toBe(true);
    expect(passes('plate', { plate: 'AB12CDE' })).toBe(true);
    expect(passes('plate', { plate: '' })).toBe(false); // gates its own Next only
  });

  it('nickname is optional', () => {
    expect(stepById('nickname').optional).toBe(true);
    expect(passes('nickname', { nickname: "Mum's Golf" })).toBe(true);
  });

  // REGRESSION (2026-07-27): `optional: true` only exempts a step from the FINAL
  // CTA gate — its own schema still gates its own Next. So an optional step whose
  // schema demands input is a DEAD END unless it renders a skip affordance. The
  // plate step shipped without one, and an owner who didn't have their plate to
  // hand could not get past the FIRST screen of the flow. That the two garage
  // steps DO render one is asserted behaviourally in garageSteps.test.tsx; this
  // pins the property that makes it necessary.
  it('plate and nickname gate their own Next when empty (so both need a skip)', () => {
    expect(passes('plate', {})).toBe(false);
    expect(passes('nickname', {})).toBe(false);
  });

  it('shows "Not provided" on review rather than a blank', () => {
    expect(stepById('plate').reviewValue?.({})).toBe('Not provided');
    expect(stepById('nickname').reviewValue?.({})).toBe('Not provided');
  });
});

describe('the garage relaxes photos, unlike posting', () => {
  it('accepts a car with NO photos — adding one must stay a 60-second job', () => {
    expect(passes('photos', { photos: [] })).toBe(true);
    expect(stepById('photos').optional).toBe(true);
  });

  it('still caps at 6, matching create_post', () => {
    const photo = { uri: 'file://a.jpg', width: 10, height: 10 };
    expect(passes('photos', { photos: Array(6).fill(photo) })).toBe(true);
    expect(passes('photos', { photos: Array(7).fill(photo) })).toBe(false);
  });
});

describe('shared step schemas match AddVehicleAnswers keys', () => {
  it('gates make, model and colour — the required identity', () => {
    expect(passes('make', { make: 'BMW' })).toBe(true);
    expect(passes('make', { make: '  ' })).toBe(false);
    expect(passes('model', { model: '320d' })).toBe(true);
    expect(passes('colour', { colour: 'Blue' })).toBe(true);
  });

  it('bounds the year to the posts CHECK so a saved car can always be posted', () => {
    expect(passes('year', { year: 2019 })).toBe(true);
    expect(passes('year', { year: 1899 })).toBe(false);
    expect(passes('year', { year: 2101 })).toBe(false);
    expect(passes('year', {})).toBe(true); // optional
  });

  it('folds the chosen make into the model question', () => {
    const question = stepById('model').question;
    expect(typeof question === 'function' && question({ make: 'BMW' })).toBe('Which BMW model?');
  });
});
