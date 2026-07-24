/**
 * WHAT:  Tests for the car-models data + the make→model dependency logic:
 *        modelsForMake populating from a make, the popular subset, the
 *        free-text fallback for unseeded/manual makes, and — the priority —
 *        makeChangePatch clearing the model only when the make actually
 *        changes.
 * WHY:   The dependency is the requirement most likely to be done wrong: a
 *        model must NEVER carry across makes (an Audi model under a BMW), yet
 *        re-picking the same make must keep the chosen model. Both directions
 *        are pinned here.
 * LINKS: src/features/vehicles/post/lib/carModels.ts.
 */

import { makeChangePatch, modelsForMake, popularModelsForMake } from './carModels';

describe('modelsForMake', () => {
  it('populates models for a seeded make', async () => {
    const models = modelsForMake('BMW').map((model) => model.label);
    expect(models).toContain('3 Series');
    expect(models).toContain('X3');
    expect(models.length).toBeGreaterThan(5);
  });

  it('returns an empty list for an unseeded or free-typed make (free-text fallback)', async () => {
    expect(modelsForMake('Reliant')).toEqual([]);
    expect(modelsForMake('')).toEqual([]);
  });

  it('flags a popular subset that is a strict subset of all models', async () => {
    const all = modelsForMake('Ford').map((model) => model.label);
    const popular = popularModelsForMake('Ford');
    expect(popular).toContain('Fiesta');
    expect(popular.length).toBeGreaterThan(0);
    expect(popular.length).toBeLessThan(all.length);
    for (const label of popular) {
      expect(all).toContain(label);
    }
  });
});

describe('makeChangePatch (make→model dependency)', () => {
  it('clears the model when the make changes (never carry a model across makes)', async () => {
    expect(makeChangePatch('BMW', 'Audi')).toEqual({ make: 'Audi', model: '' });
    // From no prior make, any make still resets model to a clean slate.
    expect(makeChangePatch(undefined, 'Ford')).toEqual({ make: 'Ford', model: '' });
  });

  it('keeps the model when the same make is re-picked', async () => {
    expect(makeChangePatch('BMW', 'BMW')).toEqual({ make: 'BMW' });
    expect(makeChangePatch('BMW', 'BMW')).not.toHaveProperty('model');
  });
});
