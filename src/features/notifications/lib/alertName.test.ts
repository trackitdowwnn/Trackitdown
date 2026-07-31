/**
 * WHAT:  Tests for the alert name suggestion.
 * WHY:   This is user-visible copy generated from data, so the failure mode is
 *        embarrassing rather than loud — "BMWs near null", "1 miles around
 *        Luton", "Lexuss". Pinning the wording here is cheaper than noticing
 *        it on a device.
 * LINKS: ./alertName.ts, ../types.ts.
 */

import { EMPTY_CRITERIA, MAX_ALERT_NAME_LENGTH, type AlertCriteria } from '../types';
import { suggestAlertName } from './alertName';

const criteria = (overrides: Partial<AlertCriteria> = {}): AlertCriteria => ({
  ...EMPTY_CRITERIA,
  ...overrides,
});

describe('suggestAlertName — narrowed by car', () => {
  it('keeps a specific model singular', () => {
    // "BMW 320ds" would be wrong — a model names one car, not a category.
    expect(suggestAlertName(criteria({ make: 'BMW', model: '320d' }), 'Luton', 10)).toBe(
      'BMW 320d near Luton',
    );
  });

  it('pluralises a make on its own', () => {
    expect(suggestAlertName(criteria({ make: 'BMW' }), 'Luton', 10)).toBe('BMWs near Luton');
  });

  it('leads with the colour', () => {
    expect(suggestAlertName(criteria({ make: 'BMW', colour: 'Blue' }), 'Luton', 10)).toBe(
      'Blue BMWs near Luton',
    );
    expect(
      suggestAlertName(criteria({ make: 'BMW', model: '320d', colour: 'Blue' }), 'Luton', 10),
    ).toBe('Blue BMW 320d near Luton');
  });

  it('falls back to the body type, then to colour alone', () => {
    expect(suggestAlertName(criteria({ bodyType: 'Van' }), 'Luton', 10)).toBe('Vans near Luton');
    expect(suggestAlertName(criteria({ colour: 'Blue' }), 'Luton', 10)).toBe(
      'Blue cars near Luton',
    );
  });

  it('does not double the s on a make that already ends in one', () => {
    expect(suggestAlertName(criteria({ make: 'Lexus' }), 'Luton', 10)).toBe('Lexus near Luton');
  });
});

describe('suggestAlertName — any car', () => {
  it('names the area, so two unfiltered alerts differ', () => {
    expect(suggestAlertName(EMPTY_CRITERIA, 'Luton', 10)).toBe('10 miles around Luton');
    expect(suggestAlertName(EMPTY_CRITERIA, 'Hemel Hempstead', 25)).toBe(
      '25 miles around Hemel Hempstead',
    );
  });

  it('singularises one mile', () => {
    expect(suggestAlertName(EMPTY_CRITERIA, 'Luton', 1)).toBe('1 mile around Luton');
  });
});

describe('suggestAlertName — no place', () => {
  it('says "me" rather than inventing a place', () => {
    // A failed geocode must not produce "BMWs near null" or a bare "BMWs".
    expect(suggestAlertName(criteria({ make: 'BMW' }), null, 10)).toBe('BMWs near me');
    expect(suggestAlertName(EMPTY_CRITERIA, null, 10)).toBe('10 miles around me');
  });

  it('treats blank and whitespace as no place', () => {
    expect(suggestAlertName(criteria({ make: 'BMW' }), '   ', 10)).toBe('BMWs near me');
  });
});

describe('suggestAlertName — bounds', () => {
  it('never exceeds the length the server accepts', () => {
    const name = suggestAlertName(
      criteria({ make: 'A'.repeat(40), model: 'B'.repeat(40) }),
      'C'.repeat(40),
      10,
    );
    expect(name.length).toBeLessThanOrEqual(MAX_ALERT_NAME_LENGTH);
  });

  it('ignores blank criteria values', () => {
    // The RPCs normalise '' to null; the prefill must agree so the suggested
    // name doesn't read "  cars near Luton".
    expect(suggestAlertName(criteria({ make: '  ', colour: '' }), 'Luton', 10)).toBe(
      '10 miles around Luton',
    );
  });
});
