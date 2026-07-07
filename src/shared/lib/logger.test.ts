/**
 * WHAT:  Tests for the logger's privacy-redaction helpers.
 * WHY:   redactPlate and redactLocation enforce SECURITY_AND_TRUST privacy
 *        rules — full number plates and precise coordinates must never reach
 *        logs. This is safety-critical code, so it is tested.
 * LINKS: src/shared/lib/logger.ts, docs/SECURITY_AND_TRUST.md §3.
 */

import { redactLocation, redactPlate } from './logger';

describe('redactPlate', () => {
  it('keeps the first four characters and masks the rest', () => {
    expect(redactPlate('AB12 CDE')).toBe('AB12***');
  });

  it('strips whitespace before redacting', () => {
    expect(redactPlate('LT71 XYZ')).toBe('LT71***');
  });

  it('fully masks input of four characters or fewer', () => {
    expect(redactPlate('AB1')).toBe('***');
  });
});

describe('redactLocation', () => {
  it('coarsens coordinates to ~1km (two decimal places)', () => {
    expect(redactLocation(51.507351, -0.127758)).toBe('~(51.51, -0.13)');
  });
});
