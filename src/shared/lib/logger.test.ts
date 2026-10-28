/**
 * WHAT:  Tests for the logger's privacy-redaction helpers.
 * WHY:   redactPlate, redactLocation, and redactEmail enforce SECURITY_AND_TRUST
 *        privacy rules — full number plates, precise coordinates, and email
 *        addresses must never reach logs. This is safety-critical code, tested.
 * LINKS: src/shared/lib/logger.ts, docs/SECURITY_AND_TRUST.md §3.
 */

import { redact as serverRedact } from '../../../supabase/functions/_shared/redact';
import { redactEmail, redactLocation, redactPlate, redactValue, thresholdFor } from './logger';

describe('thresholdFor (EXPO_PUBLIC_LOG_LEVEL)', () => {
  it('defaults to debug in dev and info in a release build', () => {
    expect(thresholdFor(undefined, true)).toBeLessThan(thresholdFor(undefined, false));
    expect(thresholdFor(undefined, false)).toBe(thresholdFor('info', true));
  });

  it('takes a valid setting in any case, and ignores nonsense', () => {
    expect(thresholdFor('WARN', true)).toBe(thresholdFor('warn', false));
    expect(thresholdFor('constructor', false)).toBe(thresholdFor('info', true));
  });
});

describe('redactValue', () => {
  it('masks sensitive keys at depth, inside arrays', () => {
    expect(redactValue({ a: [{ b: { email: 'x', token: 'y', postId: 'p' } }] })).toEqual({
      a: [{ b: { email: '[REDACTED]', token: '[REDACTED]', postId: 'p' } }],
    });
  });

  it('scrubs secret-shaped text under any key', () => {
    expect(redactValue({ reason: 'Bearer abc.def for a@b.co' })).toEqual({
      reason: 'Bearer [REDACTED] for [REDACTED]',
    });
  });

  it('keeps counts and flags whose names mention what they count', () => {
    expect(redactValue({ pushTokensPurged: 2, hasEmail: true, note: null })).toEqual({
      pushTokensPurged: 2,
      hasEmail: true,
      note: null,
    });
  });

  // ⚠️ docs/logging-decisions.md: one redaction rule, app and server.
  it.each([
    'authorization', 'cookie', 'access_token', 'apiKey', 'email', 'phone', 'sortCode',
    'account_number', 'plate', 'lat', 'lng', 'signedUrl', 'content', 'nickname', 'note',
    'postcode', 'address', 'postId', 'status', 'count', 'kind', 'durationMs',
  ])('masks %s exactly when the server does', (key) => {
    const app = redactValue({ [key]: 'value' }) as Record<string, unknown>;
    const server = serverRedact({ [key]: 'value' }) as Record<string, unknown>;
    expect(app[key] === 'value').toBe(server[key] === 'value');
  });
});

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

describe('redactEmail', () => {
  it('keeps the first local char and the domain, masks the rest', () => {
    expect(redactEmail('oliver.best3@gmail.com')).toBe('o***@gmail.com');
  });

  it('never leaks the full local part', () => {
    expect(redactEmail('jane.doe@trackitdown.example')).not.toContain('jane');
  });

  it('fully masks a non-email', () => {
    expect(redactEmail('not-an-email')).toBe('***');
    expect(redactEmail('@nolocal.com')).toBe('***');
    expect(redactEmail('trailing@')).toBe('***');
  });
});
