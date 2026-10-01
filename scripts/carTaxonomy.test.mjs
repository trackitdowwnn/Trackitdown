// WHAT:  Node tests for the car list's build rules (scripts/carTaxonomy.mjs):
//        CSV parsing, DfT names → app labels, and the fold into ranked makes
//        and models (thresholds, vans after cars, splits, hand-added names).
//        Run with `npm run test:taxonomy`.
// WHY:   The labels are STORED values: a rule that changes "3 Series" or
//        "Mercedes-Benz" silently breaks matching for every row that has the
//        old one. These pin the rules on small made-up rows, so a change to a
//        rule fails here before it reaches a regenerated list.
// LINKS: scripts/carTaxonomy.mjs; scripts/build-car-taxonomy.mjs;
//        src/shared/lib/carTaxonomy.test.ts (pins the generated output).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildTaxonomy, makeLabel, modelLabel, parseCsvLine } from './carTaxonomy.mjs';

test('parses quoted fields and escaped quotes', () => {
  assert.deepEqual(parseCsvLine('a,"b, c","12""",d'), ['a', 'b, c', '12"', 'd']);
});

test('keeps the make labels the app already stores', () => {
  assert.equal(makeLabel('MERCEDES'), 'Mercedes-Benz');
  assert.equal(makeLabel('MERCEDES-BENZ'), 'Mercedes-Benz');
  assert.equal(makeLabel('SKODA'), 'Škoda');
  assert.equal(makeLabel('CITROEN'), 'Citroën');
  assert.equal(makeLabel('LAND ROVER'), 'Land Rover');
  assert.equal(makeLabel('ROLLS ROYCE'), 'Rolls-Royce');
  assert.equal(makeLabel('BMW'), 'BMW');
  assert.equal(makeLabel('ALFA ROMEO'), 'Alfa Romeo');
  assert.equal(makeLabel('VAUXHALL'), 'Vauxhall');
});

test('turns GenModels into the labels people use', () => {
  assert.equal(modelLabel('BMW', 'BMW 3 SERIES'), '3 Series');
  assert.equal(modelLabel('BMW', 'BMW I4'), 'i4');
  assert.equal(modelLabel('MERCEDES', 'MERCEDES A CLASS'), 'A-Class');
  assert.equal(modelLabel('MERCEDES', 'MERCEDES GLA CLASS'), 'GLA');
  assert.equal(modelLabel('VOLKSWAGEN', 'VOLKSWAGEN T-ROC'), 'T-Roc');
  assert.equal(modelLabel('VOLKSWAGEN', 'VOLKSWAGEN ID3'), 'ID.3');
  assert.equal(modelLabel('LAND ROVER', 'LAND ROVER RANGE ROVER EVOQUE'), 'Range Rover Evoque');
  assert.equal(modelLabel('TOYOTA', 'TOYOTA RAV4'), 'RAV4');
  assert.equal(modelLabel('AUDI', 'AUDI E-TRON'), 'e-tron');
  assert.equal(modelLabel('HYUNDAI', 'HYUNDAI I10'), 'i10');
  assert.equal(modelLabel('FORD', 'FORD FIESTA'), 'Fiesta');
});

test('drops placeholders, make-only rows and converter names', () => {
  assert.equal(modelLabel('BMW', 'BMW MODEL MISSING'), null);
  assert.equal(modelLabel('ROLLS ROYCE', 'ROLLS ROYCE'), null);
  assert.equal(modelLabel('FORD', 'FORD ALLIED'), null);
  assert.equal(modelLabel('FIAT', 'FIAT AUTO TRAIL'), null);
  // Swift is a converter under Fiat, a car under Suzuki.
  assert.equal(modelLabel('FIAT', 'FIAT SWIFT'), null);
  assert.equal(modelLabel('SUZUKI', 'SUZUKI SWIFT'), 'Swift');
});

const HEADER = ['BodyType', 'Make', 'GenModel', 'Model', 'Fuel', 'LicenceStatus', '2026 Q2', '2026 Q1'];
const row = (body, make, gen, model, status, latest, previous = 0) => [
  body, make, gen, model, 'Petrol', status, String(latest), String(previous),
];

test('ranks by the latest quarter, licensed cars only, above the thresholds', () => {
  const { source, makes } = buildTaxonomy(HEADER, [
    row('Cars', 'FORD', 'FORD FIESTA', 'FIESTA ZETEC', 'Licensed', 5000, 99999),
    row('Cars', 'FORD', 'FORD FOCUS', 'FOCUS ST', 'Licensed', 9000),
    row('Cars', 'FORD', 'FORD FOCUS', 'FOCUS ST', 'SORN', 90000),
    row('Cars', 'FORD', 'FORD RARE', 'RARE', 'Licensed', 10),
    row('Cars', 'TINY', 'TINY ONE', 'ONE', 'Licensed', 999),
    row('Motorcycles', 'HONDA', 'HONDA CBR', 'CBR', 'Licensed', 50000),
  ]);
  assert.equal(source, 'DfT VEH0120 2026 Q2');
  assert.deepEqual(makes.map((make) => make.label), ['Ford']);
  assert.equal(makes[0].count, 14010);
  // Focus first by count; Rare (10) under both thresholds.
  assert.deepEqual(makes[0].models.map((model) => model.label), ['Focus', 'Fiesta']);
});

test('lists common vans after the cars, unranked; splits and extras apply', () => {
  const { makes } = buildTaxonomy(HEADER, [
    row('Cars', 'LAND ROVER', 'LAND ROVER DISCOVERY', 'DISCOVERY HSE', 'Licensed', 3000),
    row('Cars', 'LAND ROVER', 'LAND ROVER DISCOVERY', 'DISCOVERY SPORT SE', 'Licensed', 2000),
    row('Cars', 'LAND ROVER', 'LAND ROVER DISCOVERY', 'DISCO-Y SPORT HSE', 'Licensed', 500),
    row('Light goods vehicles', 'LAND ROVER', 'LAND ROVER DEFENDER', 'DEFENDER 110', 'Licensed', 5000),
    row('Light goods vehicles', 'LAND ROVER', 'LAND ROVER TINYVAN', 'TINYVAN', 'Licensed', 100),
    row('Cars', 'MINI', 'MINI COOPER', 'COOPER S', 'Licensed', 4000),
  ]);
  const landRover = makes.find((make) => make.label === 'Land Rover');
  assert.deepEqual(
    landRover.models.map((model) => [model.label, model.count]),
    [['Discovery', 3000], ['Discovery Sport', 2500], ['Defender', 0]],
  );
  const mini = makes.find((make) => make.label === 'MINI');
  assert.deepEqual(
    mini.models.map((model) => model.label),
    ['Cooper', 'Hatch', 'Convertible', 'Electric'],
  );
});
