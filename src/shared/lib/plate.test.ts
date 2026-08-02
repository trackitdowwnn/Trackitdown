/**
 * WHAT:  Tests for UK plate normalisation, format recognition and display.
 * WHY:   `normalisePlate` must agree with the server's SQL canon exactly — a
 *        drift there means the client accepts plates the server rejects, or
 *        treats two spellings of one plate as different and defeats the
 *        per-user uniqueness index. The format table is the foundation the OCR
 *        candidate ranking stands on, so a wrong slot pattern silently ruins
 *        scanning rather than failing loudly.
 * LINKS: ./plate.ts; supabase/migrations/20260713190000_post_a_car.sql:329.
 */

import {
  PLATE_MAX_CANON_LENGTH,
  formatPlate,
  isValidPlate,
  matchPlateFormat,
  normalisePlate,
  slotsFor,
} from './plate';

describe('normalisePlate', () => {
  it('strips spaces and punctuation and uppercases', () => {
    expect(normalisePlate('ab12 cde')).toBe('AB12CDE');
    expect(normalisePlate('AB12-CDE')).toBe('AB12CDE');
    expect(normalisePlate('  ab.12 c d e  ')).toBe('AB12CDE');
  });

  it('mirrors the server canon: everything non-alphanumeric goes', () => {
    // The SQL is upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g')).
    expect(normalisePlate('A/B*1£2_C+D=E')).toBe('AB12CDE');
  });

  it('leaves an empty string empty rather than throwing', () => {
    expect(normalisePlate('')).toBe('');
    expect(normalisePlate('   ')).toBe('');
  });
});

describe('matchPlateFormat', () => {
  it.each([
    ['AB12CDE', 'current'],
    ['A123BCD', 'prefix'],
    ['A12BCD', 'prefix'],
    ['ABC123A', 'suffix'],
    ['ABC1234', 'northernIreland'],
    ['ABC123', 'dateless'],
    ['123ABC', 'dateless'],
    ['AB1234', 'dateless'],
  ])('recognises %s as %s', (canon, expected) => {
    expect(matchPlateFormat(canon)).toBe(expected);
  });

  it.each([
    ['', 'empty'],
    ['AB', 'too short'],
    ['AB12CDEF', 'too long'],
    ['1234567', 'all digits'],
    ['ABCDEFG', 'all letters'],
    ['AB1CDE2', 'digits in the wrong slots'],
  ])('rejects %s (%s)', (canon) => {
    expect(matchPlateFormat(canon)).toBeNull();
    expect(isValidPlate(canon)).toBe(false);
  });

  it('is not fooled by lowercase — callers must normalise first', () => {
    // Documented contract: matchPlateFormat takes CANONICAL input.
    expect(matchPlateFormat('ab12cde')).toBeNull();
    expect(matchPlateFormat(normalisePlate('ab12cde'))).toBe('current');
  });
});

describe('formatPlate', () => {
  it.each([
    ['AB12CDE', 'AB12 CDE'],
    ['A123BCD', 'A123 BCD'],
    ['ABC123A', 'ABC 123A'],
    ['ABC1234', 'ABC 1234'],
    ['123ABC', '123 ABC'],
  ])('spaces %s as %s', (canon, display) => {
    expect(formatPlate(canon)).toBe(display);
  });

  it('returns unrecognised input unchanged rather than mangling it', () => {
    // A formatter is not a validator — the user may be mid-type.
    expect(formatPlate('AB1')).toBe('AB1');
    expect(formatPlate('')).toBe('');
  });

  it('every display form fits the TextField cap of 8 characters', () => {
    // The plate variant sets maxLength: 8. If a format ever exceeded it, a
    // scanned plate would be silently truncated on fill.
    const samples = ['AB12CDE', 'A123BCD', 'ABC123A', 'ABC1234', '1234AB', '123ABC'];
    samples.forEach((canon) => {
      expect(canon.length).toBeLessThanOrEqual(PLATE_MAX_CANON_LENGTH);
      expect(formatPlate(canon).length).toBeLessThanOrEqual(8);
    });
  });
});

describe('slotsFor', () => {
  it('returns every shape of a given length', () => {
    const seven = slotsFor(7);
    expect(seven).toContain('AA99AAA'); // current
    expect(seven).toContain('AAA9999'); // Northern Ireland
    expect(seven.every((pattern) => pattern.length === 7)).toBe(true);
  });

  it('returns nothing for a length no format uses', () => {
    expect(slotsFor(1)).toEqual([]);
    expect(slotsFor(9)).toEqual([]);
  });
});
