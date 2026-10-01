/**
 * WHAT:  Tests for the car-makes data — section bucketing (incl. accented
 *        makes), the popular set, and basic list hygiene.
 * WHY:   The A–Z index and sticky headers depend on ASCII-folded section
 *        letters (Škoda must bucket under "S", not "Š"), and the popular set
 *        drives the pinned group — both are easy to break silently when the
 *        list is edited.
 * LINKS: src/shared/lib/carMakes.ts.
 */

import {
  CAR_MAKES,
  MAKE_ALIASES,
  POPULAR_MAKES,
  canonicaliseMake,
  makeKeywords,
  makeSection,
} from './carMakes';

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

  it('ranks the ten most common UK makes as popular, most first', async () => {
    // DfT counts, 2026 Q2: Ford leads, then Volkswagen and Vauxhall. The old
    // hand list showed its ten A–Z, which ranked nothing.
    expect(POPULAR_MAKES).toHaveLength(10);
    expect(POPULAR_MAKES.slice(0, 3)).toEqual(['Ford', 'Volkswagen', 'Vauxhall']);
    expect(POPULAR_MAKES).toContain('BMW');
    for (const label of POPULAR_MAKES) {
      expect(CAR_MAKES.find((make) => make.label === label)?.popular).toBe(true);
    }
  });

  it('lists every make A–Z, with accented makes among their letter', () => {
    const labels = CAR_MAKES.map((make) => make.label);
    expect(labels.indexOf('SEAT')).toBeLessThan(labels.indexOf('Škoda'));
    expect(labels.indexOf('Škoda')).toBeLessThan(labels.indexOf('Smart'));
    expect(labels.indexOf('Chevrolet')).toBeLessThan(labels.indexOf('Citroën'));
  });

  it('finds a make by the other names it is typed as', () => {
    expect(makeKeywords('Volkswagen')).toContain('vw');
    expect(makeKeywords('Mercedes-Benz')).toContain('merc');
    expect(makeKeywords('Ford')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ⚠️ Review finding #20. A post says what the owner typed, an alert says what
// the spotter typed, and the server matches them with lower(btrim(...)) — case
// and whitespace, nothing more. So "VW Golf" never reached the spotter who
// asked for a Volkswagen Golf: the alert stayed silent, the owner never knew,
// and nothing errored anywhere. DOMAIN.md calls this matching load-bearing.
// ---------------------------------------------------------------------------
describe('canonicaliseMake', () => {
  it('⚠️ maps the abbreviation the finding is named for', () => {
    expect(canonicaliseMake('VW')).toBe('Volkswagen');
    expect(canonicaliseMake('vw')).toBe('Volkswagen');
    expect(canonicaliseMake(' VW ')).toBe('Volkswagen');
  });

  it('⚠️ recovers the accented makes nobody can type', () => {
    // The worst case, and the one that is a guaranteed miss rather than a
    // likely one: the list stores Škoda and Citroën, and a UK keyboard offers
    // neither. Every hand-typed Skoda missed, on two makes, forever.
    expect(canonicaliseMake('Skoda')).toBe('Škoda');
    expect(canonicaliseMake('skoda')).toBe('Škoda');
    expect(canonicaliseMake('Citroen')).toBe('Citroën');
  });

  it('fixes case and spacing against the real list', () => {
    expect(canonicaliseMake('bmw')).toBe('BMW');
    expect(canonicaliseMake('land  rover')).toBe('Land Rover');
    expect(canonicaliseMake('MERCEDES-BENZ')).toBe('Mercedes-Benz');
  });

  it('maps the names people actually offer for a brand', () => {
    expect(canonicaliseMake('Merc')).toBe('Mercedes-Benz');
    expect(canonicaliseMake('Mercedes')).toBe('Mercedes-Benz');
    expect(canonicaliseMake('Landrover')).toBe('Land Rover');
    expect(canonicaliseMake('Alfa')).toBe('Alfa Romeo');
    // A model offered as a make, common enough to be worth mapping.
    expect(canonicaliseMake('Range Rover')).toBe('Land Rover');
    // Chevrolet is on the DfT list, so its nickname can map now.
    expect(canonicaliseMake('Chevy')).toBe('Chevrolet');
  });

  it('ignores hyphens and spaces, so no alias is needed for them', () => {
    expect(canonicaliseMake('Rolls Royce')).toBe('Rolls-Royce');
    expect(canonicaliseMake('mercedes benz')).toBe('Mercedes-Benz');
    expect(canonicaliseMake('Land-Rover')).toBe('Land Rover');
    expect(canonicaliseMake('austin healey')).toBe('Austin-Healey');
  });

  it('⚠️ NEVER traps a make it does not know', () => {
    // The list is allowed to under-offer — MakeField's whole manual-entry path
    // depends on it — and someone whose car has just been stolen must be able
    // to report a make we have never heard of. Returned as typed, only tidied.
    expect(canonicaliseMake('Koenigsegg')).toBe('Koenigsegg');
    expect(canonicaliseMake('  Rivian  ')).toBe('Rivian');
    expect(canonicaliseMake('')).toBe('');
  });

  it('⚠️ does not guess at typos', () => {
    // Deliberately NOT a fuzzy matcher. Rewriting what someone typed about
    // their own car is a worse failure than not matching — an owner who sees
    // their listing say a make they did not choose stops trusting the app.
    // 'Volkswagon' is in the table as a NAME people use, not as a typo rule.
    expect(canonicaliseMake('Volkswagon')).toBe('Volkswagen');
    expect(canonicaliseMake('Volkswagn')).toBe('Volkswagn');
    expect(canonicaliseMake('Frod')).toBe('Frod');
  });

  it('is idempotent — a canonical make survives another pass', () => {
    for (const make of CAR_MAKES) {
      expect(canonicaliseMake(make.label)).toBe(make.label);
    }
  });

  it('⚠️ every alias resolves to a real list label', () => {
    // An alias pointing at a label that does not exist would canonicalise a
    // make INTO a permanent mismatch — worse than leaving it alone, and
    // invisible without this assertion.
    const labels = new Set(CAR_MAKES.map((make) => make.label));
    // The whole table, not a sample: a sample let "chevy" sit untested.
    for (const [alias, label] of Object.entries(MAKE_ALIASES)) {
      expect([alias, labels.has(label)]).toEqual([alias, true]);
      expect(canonicaliseMake(alias)).toBe(label);
    }
    for (const typed of ['VW', 'Merc', 'Landrover', 'Alfa', 'Skoda', 'Citroen', 'DS', 'Mini']) {
      expect(labels.has(canonicaliseMake(typed))).toBe(true);
    }
  });
});
