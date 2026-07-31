/**
 * WHAT:  Config smoke test for the alert wizard — the shape each MATCHER
 *        selection produces, gating, review copy, and the name auto-suggestion
 *        following the last step before `name`.
 * WHY:   MANDATORY for every flow in this codebase. `WizardStep.schema` is a
 *        bare `z.ZodType`, so TypeScript cannot tie its keys to the answers
 *        type: a typo'd key COMPILES and the step then simply never
 *        validates — Next stays dead with no error anywhere. Only a test that
 *        actually runs each schema against real answers catches it.
 *
 *        The per-matcher shapes are asserted because the flow is now BUILT, not
 *        declared: an off-by-one in the "which step seeds the name" slice would
 *        either drop a step or leave an area-only alert unnameable, and both
 *        look fine until the wizard is on screen.
 *        The step components are mocked so this loads without the map, the
 *        slider or the pickers (postACarFlow.test.ts does the same).
 * LINKS: ./alertFlow.tsx, ./alertName.ts, ./alertMatchers.ts;
 *        src/shared/wizard/types.ts;
 *        src/features/garage/lib/addVehicleFlow.test.ts (the model).
 */

import { flattenFlow } from '@/shared/wizard';

import { ALERT_INITIAL_ANSWERS, buildAlertFlow, DEFAULT_ALERT_RADIUS_MILES } from './alertFlow';
import type { AlertMatcher } from '../types';

jest.mock('../components/alertSteps', () => ({
  AreaStep: () => null,
  CarStep: () => null,
  FiltersStep: () => null,
  NameStep: () => null,
}));

const ALL: AlertMatcher[] = ['area', 'car', 'bounty'];

const stepsFor = (matchers: AlertMatcher[]) =>
  buildAlertFlow(matchers).phases.flatMap((phase) => phase.steps);
const idsFor = (matchers: AlertMatcher[]) => stepsFor(matchers).map((step) => step.id);

const flow = buildAlertFlow(ALL);
const steps = stepsFor(ALL);
const stepById = (id: string) => {
  const step = steps.find((s) => s.id === id);
  if (!step) throw new Error(`no step ${id}`);
  return step;
};
const passes = (id: string, answers: Record<string, unknown>) =>
  stepById(id).schema.safeParse(answers).success;

const AREA = { location: { latitude: 51.5, longitude: -0.13 } };

describe('shape', () => {
  it('is one phase with no intro and a review — a calm settings task', () => {
    // No intro: this is not the posting wizard's "sorry this happened" moment.
    // But it DOES review, because an alert is invisible once saved and this is
    // the only chance to notice you set 1 mile instead of 10.
    expect(flow.phases).toHaveLength(1);
    expect(flow.phases[0].intro).toBeUndefined();
    expect(flow.review).toBeDefined();
    expect(flattenFlow(flow).map((screen) => screen.kind)).toEqual([
      'step',
      'step',
      'step',
      'step',
      'review',
    ]);
  });

  it('asks area, car, filters, name — in that order — when everything is ticked', () => {
    expect(idsFor(ALL)).toEqual(['area', 'car', 'filters', 'name']);
  });

  it('asks only area and name when nothing is ticked', () => {
    // The whole point of the picker: "anything near home" is two screens, not
    // four with two left untouched.
    expect(idsFor(['area'])).toEqual(['area', 'name']);
  });

  it('includes only the criteria step that was ticked', () => {
    expect(idsFor(['area', 'car'])).toEqual(['area', 'car', 'name']);
    expect(idsFor(['area', 'bounty'])).toEqual(['area', 'filters', 'name']);
  });

  it('always ends on the name step, whatever is ticked', () => {
    // The name gates submission, so it must never be the one dropped.
    for (const matchers of [['area'], ['area', 'car'], ['area', 'bounty'], ALL] as AlertMatcher[][]) {
      expect(idsFor(matchers).at(-1)).toBe('name');
      expect(idsFor(matchers)[0]).toBe('area');
    }
  });

  it('emits the area step even if area is somehow absent from the matchers', () => {
    // point/radius_m are NOT NULL: a flow without the area step could only
    // produce a row the server refuses.
    expect(idsFor([])).toEqual(['area', 'name']);
  });

  it('every step is renderable and reviewable', () => {
    for (const step of steps) {
      expect(step.question).toBeTruthy();
      expect(step.component).toBeTruthy();
      expect(typeof step.schema.safeParse).toBe('function');
      expect(step.reviewValue).toBeTruthy();
    }
  });

  it('promises no charge — this is free, unlike the posting wizard', () => {
    expect(flow.finalCtaLabel).toBe('Save alert');
  });
});

describe('gating', () => {
  it('requires an area', () => {
    expect(passes('area', {})).toBe(false);
    expect(passes('area', AREA)).toBe(true);
  });

  it('requires a name, and rejects whitespace or an over-long one', () => {
    expect(passes('name', {})).toBe(false);
    expect(passes('name', { name: '   ' })).toBe(false);
    expect(passes('name', { name: 'Home' })).toBe(true);
    expect(passes('name', { name: 'x'.repeat(81) })).toBe(false);
  });

  it('never blocks on criteria — asking for a car step is not promising to fill it', () => {
    expect(passes('car', {})).toBe(true);
    expect(passes('filters', {})).toBe(true);
  });

  it('seeds a radius so the area step opens valid, not at zero', () => {
    expect(ALERT_INITIAL_ANSWERS.radiusMiles).toBe(DEFAULT_ALERT_RADIUS_MILES);
  });

  it('starts new alerts at 5 miles', () => {
    // The LITERAL on purpose. Comparing the seed against the constant only
    // proves they agree — both could drift to 50 and the test would pass while
    // every new alert opened on a county-wide view. This is also what the map
    // now frames itself to, so it is a camera default as much as a filter.
    expect(DEFAULT_ALERT_RADIUS_MILES).toBe(5);
  });

  it('defaults the privacy toggle ON', () => {
    // SAFETY: coarsening is the default, not the opt-in.
    expect(ALERT_INITIAL_ANSWERS.approximate).toBe(true);
  });
});

describe('review copy', () => {
  it('describes the area with its radius', () => {
    expect(stepById('area').reviewValue?.({ ...AREA, radiusMiles: 10, placeLabel: 'Luton' })).toBe(
      '10 miles around Luton',
    );
  });

  it('falls back to "the pin" when there is no place label', () => {
    // Editing an existing alert has no label — we store a point, not a name.
    expect(stepById('area').reviewValue?.({ ...AREA, radiusMiles: 10 })).toBe(
      '10 miles around the pin',
    );
  });

  it('says "Any car" rather than leaving the row blank', () => {
    expect(stepById('car').reviewValue?.({})).toBe('Any car');
    expect(stepById('car').reviewValue?.({ colour: 'Blue', make: 'BMW', model: '320d' })).toBe(
      'Blue BMW 320d',
    );
  });

  it('summarises the extra filters, or says there are none', () => {
    expect(stepById('filters').reviewValue?.({})).toBe('No extra filters');
    expect(
      stepById('filters').reviewValue?.({ minBountyPence: 50000, recencyDays: 7 }),
    ).toContain('£500');
  });
});

describe('name suggestion', () => {
  /** Run the seeding hook off whichever step actually carries it. */
  const seedVia = (matchers: AlertMatcher[], answers: Record<string, unknown>) => {
    const withHook = stepsFor(matchers).filter((step) => step.onContinue);
    // Exactly one step seeds the name — more would mean a later step's answer
    // could never reach the suggestion, because the first one to run sets it.
    expect(withHook).toHaveLength(1);
    return withHook[0].onContinue?.(answers) as Promise<{ name: string } | undefined>;
  };

  it('suggests a name on the way into the name step', async () => {
    await expect(
      seedVia(ALL, { ...AREA, radiusMiles: 10, placeLabel: 'Luton', make: 'BMW' }),
    ).resolves.toEqual({ name: 'BMWs near Luton' });
  });

  it('hangs the suggestion off the LAST step before the name', () => {
    // Regression: the hook used to live on `filters` unconditionally. With
    // bounty unticked that step no longer exists, so a car-only alert would
    // have reached the name step with nothing suggested.
    const hooked = (matchers: AlertMatcher[]) =>
      stepsFor(matchers).find((step) => step.onContinue)?.id;
    expect(hooked(ALL)).toBe('filters');
    expect(hooked(['area', 'car'])).toBe('car');
    expect(hooked(['area', 'bounty'])).toBe('filters');
    expect(hooked(['area'])).toBe('area');
  });

  it('names an area-only alert from its area', async () => {
    await expect(
      seedVia(['area'], { ...AREA, radiusMiles: 25, placeLabel: 'Luton' }),
    ).resolves.toEqual({ name: '25 miles around Luton' });
  });

  it('folds the car into the name when only the car is ticked', async () => {
    await expect(
      seedVia(['area', 'car'], { ...AREA, radiusMiles: 10, placeLabel: 'Luton', make: 'BMW' }),
    ).resolves.toEqual({ name: 'BMWs near Luton' });
  });

  it('never overwrites a name the user already typed', async () => {
    // Also covers the review-edit spur, where onContinue runs again.
    await expect(seedVia(ALL, { ...AREA, name: 'My commute', make: 'BMW' })).resolves.toBeUndefined();
  });

  it('re-suggests when the name has been cleared', async () => {
    await expect(
      seedVia(ALL, { ...AREA, name: '   ', radiusMiles: 25, placeLabel: 'Luton' }),
    ).resolves.toEqual({ name: '25 miles around Luton' });
  });
});
