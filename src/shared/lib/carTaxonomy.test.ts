/**
 * WHAT:  Tests on the GENERATED car list (carTaxonomy.generated.ts): its shape
 *        and hygiene, and continuity — every make and model the app offered
 *        before the DfT list is still offered, under the same label.
 * WHY:   ⚠️ LABELS ARE STORED VALUES. Posts, garage cars and alerts keep the
 *        label that was picked, and search and alerts match on it exactly
 *        (case aside). A regenerated list that renamed "C-Class" or dropped
 *        "Discovery Sport" would silently stop old rows matching new ones:
 *        an alert that never fires, with nothing erroring anywhere. The
 *        LEGACY_* tables below are the old hand list (2026-09-30), kept here as
 *        the contract a regeneration must meet.
 * LINKS: src/shared/lib/carTaxonomy.generated.ts; scripts/build-car-taxonomy.mjs;
 *        scripts/carTaxonomy.test.mjs (the build rules).
 */

import { canonicaliseMake } from './carMakes';
import { canonicaliseModel, modelsForMake } from './carModels';
import { CAR_TAXONOMY, CAR_TAXONOMY_SOURCE } from './carTaxonomy.generated';

/** The makes the hand list offered before 2026-09-30. */
const LEGACY_MAKES = [
  'Abarth', 'Alfa Romeo', 'Aston Martin', 'Audi', 'Bentley', 'BMW', 'Citroën', 'Cupra',
  'Dacia', 'DS', 'Ferrari', 'Fiat', 'Ford', 'Genesis', 'Honda', 'Hyundai', 'Jaguar', 'Jeep',
  'Kia', 'Lamborghini', 'Land Rover', 'Lexus', 'Lotus', 'Maserati', 'Mazda', 'McLaren',
  'Mercedes-Benz', 'MG', 'MINI', 'Mitsubishi', 'Nissan', 'Peugeot', 'Polestar', 'Porsche',
  'Renault', 'Rolls-Royce', 'SEAT', 'Škoda', 'Smart', 'SsangYong', 'Subaru', 'Suzuki',
  'Tesla', 'Toyota', 'Vauxhall', 'Volkswagen', 'Volvo',
];

/** The models it offered, per make. */
const LEGACY_MODELS: Record<string, string[]> = {
  Audi: ['A1', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q2', 'Q3', 'Q5', 'Q7', 'Q8', 'TT', 'e-tron'],
  BMW: ['1 Series', '2 Series', '3 Series', '4 Series', '5 Series', '6 Series', '7 Series', 'X1', 'X3', 'X5', 'X6', 'Z4', 'i4', 'iX', 'M3', 'M4'],
  Ford: ['Fiesta', 'Focus', 'Puma', 'Kuga', 'Mondeo', 'EcoSport', 'Ka', 'Galaxy', 'S-Max', 'Mustang', 'Ranger', 'Transit'],
  Honda: ['Jazz', 'Civic', 'CR-V', 'HR-V', 'Accord', 'e'],
  Hyundai: ['i10', 'i20', 'i30', 'Tucson', 'Kona', 'Santa Fe', 'Ioniq', 'Bayon'],
  Kia: ['Picanto', 'Rio', 'Ceed', 'Sportage', 'Niro', 'Sorento', 'Stonic', 'EV6'],
  'Land Rover': ['Defender', 'Discovery', 'Discovery Sport', 'Range Rover', 'Range Rover Sport', 'Range Rover Evoque', 'Range Rover Velar', 'Freelander'],
  'Mercedes-Benz': ['A-Class', 'B-Class', 'C-Class', 'E-Class', 'S-Class', 'CLA', 'GLA', 'GLB', 'GLC', 'GLE', 'SL', 'V-Class', 'Vito'],
  MINI: ['Hatch', 'Clubman', 'Countryman', 'Convertible', 'Electric'],
  Nissan: ['Micra', 'Juke', 'Qashqai', 'X-Trail', 'Leaf', 'Note', 'Navara', 'GT-R'],
  Peugeot: ['108', '208', '308', '508', '2008', '3008', '5008', 'Partner', 'Rifter'],
  Toyota: ['Aygo', 'Yaris', 'Corolla', 'C-HR', 'RAV4', 'Prius', 'Camry', 'Hilux', 'Land Cruiser', 'Supra'],
  Vauxhall: ['Corsa', 'Astra', 'Insignia', 'Mokka', 'Crossland', 'Grandland', 'Zafira', 'Vivaro', 'Combo'],
  Volkswagen: ['Up', 'Polo', 'Golf', 'Passat', 'Tiguan', 'T-Roc', 'T-Cross', 'Touran', 'Touareg', 'Arteon', 'ID.3', 'ID.4', 'Caddy', 'Transporter'],
  Volvo: ['V40', 'V60', 'V90', 'S60', 'S90', 'XC40', 'XC60', 'XC90'],
};

/** Upper-case words allowed in a label; anything else ALL CAPS is DfT leaking through. */
const ACRONYMS = /^(BMW|MINI|MG|SEAT|DS|BYD|KGM|TVR|ORA|XPENG|INEOS|MCC|[A-Z]{1,3}\d*|[A-Z]*\d+[A-Z]*|GT[A-Z]*|AMG|PACE|[A-Z]-PACE|I-PACE|MPV|SUV)$/;

/** Two-letter model words that really are title case. */
const TWO_LETTER_WORDS = new Set(['Ka', 'Up', 'Mk', 'Fe']);

describe('the generated car list', () => {
  it('names its source quarter', () => {
    expect(CAR_TAXONOMY_SOURCE).toMatch(/^DfT VEH0120 \d{4} Q[1-4]$/);
  });

  it('is sorted by UK count, most first, and each make has models', () => {
    for (let i = 1; i < CAR_TAXONOMY.length; i += 1) {
      expect(CAR_TAXONOMY[i - 1][1]).toBeGreaterThanOrEqual(CAR_TAXONOMY[i][1]);
    }
    for (const [make, , models] of CAR_TAXONOMY) {
      expect([make, models.length > 0]).toEqual([make, true]);
    }
  });

  it('has no duplicate makes, and no duplicate models within a make', () => {
    const makes = CAR_TAXONOMY.map(([make]) => make);
    expect(new Set(makes).size).toBe(makes.length);
    for (const [make, , models] of CAR_TAXONOMY) {
      const labels = models.map(([label]) => label);
      expect([make, new Set(labels).size]).toEqual([make, labels.length]);
    }
  });

  it('never lets DfT’s upper-case names or placeholders through', () => {
    for (const [make, , models] of CAR_TAXONOMY) {
      for (const label of [make, ...models.map(([model]) => model)]) {
        expect(label).not.toMatch(/MISSING|^OTHER$/i);
        for (const word of label.split(/[\s.\-/+]/)) {
          if (word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word)) {
            expect([label, word, ACRONYMS.test(word)]).toEqual([label, word, true]);
          }
          // A two-letter word title-cased is nearly always an acronym the rules
          // missed (Jensen "Ff" got through once). These few are real words.
          if (/^[A-Z][a-z]$/.test(word)) {
            expect([label, word, TWO_LETTER_WORDS.has(word)]).toEqual([label, word, true]);
          }
        }
      }
    }
  });

  it('⚠️ still offers every make the old list did, under the same label', () => {
    const makes = new Set(CAR_TAXONOMY.map(([make]) => make));
    for (const make of LEGACY_MAKES) {
      expect([make, makes.has(make)]).toEqual([make, true]);
      expect(canonicaliseMake(make)).toBe(make);
    }
  });

  it('⚠️ still offers every model the old list did, under the same label', () => {
    for (const [make, models] of Object.entries(LEGACY_MODELS)) {
      const listed = modelsForMake(make).map((model) => model.label);
      for (const model of models) {
        expect([make, model, listed.includes(model)]).toEqual([make, model, true]);
        expect(canonicaliseModel(make, model)).toBe(model);
      }
    }
  });

  it('keeps no two models of a make that fold to the same key', () => {
    // canonicaliseModel ignores case, accents, spaces, hyphens and dots; two
    // labels that fold alike would make one of them unreachable by typing.
    const fold = (value: string) =>
      value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s.\-]+/g, '');
    for (const [make, , models] of CAR_TAXONOMY) {
      const keys = models.map(([label]) => fold(label));
      expect([make, new Set(keys).size]).toEqual([make, keys.length]);
    }
  });
});
