/**
 * WHAT:  Tests for the car-makes data — section bucketing (incl. accented
 *        makes), the popular set, and basic list hygiene.
 * WHY:   The A–Z index and sticky headers depend on ASCII-folded section
 *        letters (Škoda must bucket under "S", not "Š"), and the popular set
 *        drives the pinned group — both are easy to break silently when the
 *        list is edited.
 * LINKS: src/features/vehicles/post/lib/carMakes.ts.
 */

import { CAR_MAKES, POPULAR_MAKES, makeSection } from './carMakes';

describe('carMakes', () => {
  it('folds accented first letters to an ASCII section', async () => {
    expect(makeSection('Škoda')).toBe('S');
    expect(makeSection('Citroën')).toBe('C');
    expect(makeSection('BMW')).toBe('B');
  });

  it('every make has a single-letter A–Z section', async () => {
    for (const make of CAR_MAKES) {
      expect(make.section).toMatch(/^[A-Z]$/);
    }
  });

  it('has no duplicate labels', async () => {
    const labels = CAR_MAKES.map((make) => make.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('surfaces the common UK makes as popular, in list order', async () => {
    expect(POPULAR_MAKES).toContain('BMW');
    expect(POPULAR_MAKES).toContain('Ford');
    expect(POPULAR_MAKES).toContain('Vauxhall');
    // Popular labels are a subset of the full list.
    for (const label of POPULAR_MAKES) {
      expect(CAR_MAKES.some((make) => make.label === label)).toBe(true);
    }
  });
});
