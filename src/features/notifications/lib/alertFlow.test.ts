/**
 * WHAT:  Config smoke test for the alert wizard — the shape each MATCHER
 *        selection produces, gating, review copy, and that NO step seeds the
 *        name.
 * WHY:   MANDATORY for every flow in this codebase. `WizardStep.schema` is a
 *        bare `z.ZodType`, so TypeScript cannot tie its keys to the answers
 *        type: a typo'd key COMPILES and the step then simply never
 *        validates — Next stays dead with no error anywhere. Only a test that
 *        actually runs each schema against real answers catches it.
 *
 *        The per-matcher shapes are asserted because the flow is BUILT, not
 *        declared: a step dropped from the wrong slice looks fine until the
 *        wizard is on screen.
 *
 *        ⚠️ THE NAME SUGGESTION IS GONE (owner request, 2026-08-27) and this
 *        file asserts its ABSENCE. It used to hang off whichever step preceded
 *        `name` — a slice whose off-by-one had already left area-only alerts
 *        unnameable once — and the field now opens empty, with the suggestion
 *        demoted to NameStep's placeholder. Six tests for the old hook were
 *        deleted rather than adapted; do not restore them.
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
    expect(
      stepById('area').reviewValue?.({
        ...AREA,
        radiusMiles: 10,
        placeLabel: 'Luton',
        approximate: true,
      }),
    ).toBe('10 miles around Luton · approximate area');
  });

  it('falls back to "the pin" when there is no place label', () => {
    // Editing an existing alert has no label — we store a point, not a name.
    expect(stepById('area').reviewValue?.({ ...AREA, radiusMiles: 10, approximate: true })).toBe(
      '10 miles around the pin · approximate area',
    );
  });

  it('NAMES the coarsening on the review, in both states', () => {
    // SAFETY. The area step carries no helper and the option card no caption,
    // so this line is the only place the choice is stated before an exact home
    // point would be stored — and the case that matters is the toggle turned
    // OFF, which is exactly when saying nothing would be worst.
    expect(stepById('area').reviewValue?.({ ...AREA, radiusMiles: 5, approximate: true })).toContain(
      'approximate area',
    );
    expect(
      stepById('area').reviewValue?.({ ...AREA, radiusMiles: 5, approximate: false }),
    ).toContain('exact location');
    // Unset defaults to the SAFE reading, matching ALERT_INITIAL_ANSWERS.
    expect(stepById('area').reviewValue?.({ ...AREA, radiusMiles: 5 })).toContain(
      'approximate area',
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


describe('⚠️ the name is not pre-filled', () => {
  // Owner request, 2026-08-27. A `withNameSuggestion` wrapper used to hang an
  // `onContinue` off whichever step preceded `name` and seed the field with
  // "5 miles around Luton" — so anyone who wanted their own name had to clear
  // someone else's words first. `suggestAlertName` survives as NameStep's
  // PLACEHOLDER, which guides without being something to delete.
  it('leaves every step free of a seeding hook', () => {
    // The old design REQUIRED exactly one step to carry an onContinue, and got
    // that wrong once already (it lived on `filters`, a step that stops
    // existing when bounty is unticked). Now none of them should.
    for (const matchers of [ALL, ['area'], ['area', 'car'], ['area', 'bounty']] as const) {
      const steps = stepsFor([...matchers]);
      // ⚠️ Guard against the vacuous form: `[].filter(...)` is also `[]`, so
      // without this the assertion below would pass if stepsFor ever returned
      // nothing at all — which is exactly the bug it is meant to catch.
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.filter((step) => step.onContinue).map((step) => step.id)).toEqual([]);
    }
  });

  it('still requires a name, so an unnamed alert cannot be saved', () => {
    // The field opening empty only works because the gate is honest about it —
    // otherwise an alert would save as "" and the list would show a blank row.
    const schema = stepById('name').schema;
    expect(schema.safeParse({ name: '' }).success).toBe(false);
    expect(schema.safeParse({ name: '   ' }).success).toBe(false);
    expect(schema.safeParse({ name: 'My commute' }).success).toBe(true);
  });

  it('no longer claims to have suggested one', () => {
    // The helper said "We've suggested one." — a plain lie about what is on
    // screen once the field opens empty.
    expect(stepById('name').helper).not.toMatch(/suggest/i);
  });
});
