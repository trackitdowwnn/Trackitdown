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
 * LINKS: src/shared/lib/carModels.ts.
 */

import {
  canonicaliseModel,
  makeChangePatch,
  modelSection,
  modelsForMake,
  popularModelsForMake,
} from './carModels';

describe('modelSection', () => {
  it('files numbered models under #, the rest by first letter', () => {
    expect(modelSection('3 Series')).toBe('#');
    expect(modelSection('208')).toBe('#');
    expect(modelSection('i4')).toBe('I');
    expect(modelSection('ë-C3')).toBe('E');
  });
});

describe('modelsForMake', () => {
  it('populates models for a seeded make', async () => {
    const models = modelsForMake('BMW').map((model) => model.label);
    expect(models).toContain('3 Series');
    expect(models).toContain('X3');
    expect(models.length).toBeGreaterThan(5);
  });

  it('returns an empty list for an unlisted or free-typed make (free-text fallback)', async () => {
    expect(modelsForMake('Trabant')).toEqual([]);
    expect(modelsForMake('VW')).toEqual([]); // not canonical: see canonicaliseModel
    expect(modelsForMake('')).toEqual([]);
  });

  it('gives the makes the hand list left out their models (the DfT list)', () => {
    for (const [make, model] of [
      ['Škoda', 'Octavia'],
      ['SEAT', 'Leon'],
      ['Tesla', 'Model 3'],
      ['Renault', 'Clio'],
      ['Fiat', '500'],
    ] as const) {
      expect(modelsForMake(make).map((m) => m.label)).toContain(model);
    }
  });

  it('lists A–Z with numbers in number order', () => {
    const labels = modelsForMake('BMW').map((model) => model.label);
    expect(labels.indexOf('1 Series')).toBeLessThan(labels.indexOf('2 Series'));
    expect(labels.indexOf('7 Series')).toBeLessThan(labels.indexOf('8 Series'));
    expect(labels.indexOf('8 Series')).toBeLessThan(labels.indexOf('i4'));
  });

  it('ranks popular models by UK car count; van-only models are listed, never ranked', () => {
    expect(popularModelsForMake('BMW').slice(0, 2)).toEqual(['3 Series', '1 Series']);
    expect(popularModelsForMake('Ford')[0]).toBe('Fiesta');
    // Ranger is a van-only model (DfT counts no Ranger cars): listed at 0, so
    // it can't be popular however many vans there are.
    expect(modelsForMake('Ford').map((m) => m.label)).toContain('Ranger');
    expect(popularModelsForMake('Ford')).not.toContain('Ranger');
    expect(popularModelsForMake('Ford')).not.toContain('Transit Connect');
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

// ---------------------------------------------------------------------------
// Review finding #20, the model half. Same failure as makes: a free-typed
// "golf" never met a spotter's alert for a "Golf", because the server compares
// lower(btrim(...)) and nothing else normalises either side.
// ---------------------------------------------------------------------------
describe('canonicaliseModel', () => {
  it('fixes case and spacing against that make’s list', () => {
    expect(canonicaliseModel('Volkswagen', 'golf')).toBe('Golf');
    expect(canonicaliseModel('BMW', '3  series')).toBe('3 Series');
  });

  it('ignores hyphens and dots, so the obvious typings meet the label', () => {
    expect(canonicaliseModel('Mercedes-Benz', 'c class')).toBe('C-Class');
    expect(canonicaliseModel('Volkswagen', 'id3')).toBe('ID.3');
    expect(canonicaliseModel('Volkswagen', 'troc')).toBe('T-Roc');
    expect(canonicaliseModel('Citroën', 'e-c3')).toBe('ë-C3');
  });

  it('⚠️ NEVER traps a model the list does not carry', () => {
    // The lists under-offer by design, and a stolen car with an unlisted model
    // must still be reportable. Returned as typed, only tidied.
    expect(canonicaliseModel('Volkswagen', 'Corrado')).toBe('Corrado');
    expect(canonicaliseModel('Volkswagen', '  Corrado  ')).toBe('Corrado');
    expect(canonicaliseModel('Volkswagen', '')).toBe('');
  });

  it('⚠️ is inert when the make is not canonical, which is why makes go first', () => {
    // MODELS is keyed by the exact make label, so modelsForMake('VW') is empty
    // and there is nothing here to match against. canonicaliseMake runs at the
    // same seam (MakeField) precisely so this never has to cope.
    expect(canonicaliseModel('VW', 'golf')).toBe('golf');
    expect(canonicaliseModel('', 'golf')).toBe('golf');
  });

  it('is idempotent for every seeded model', () => {
    for (const model of modelsForMake('Volkswagen')) {
      expect(canonicaliseModel('Volkswagen', model.label)).toBe(model.label);
    }
  });
});
