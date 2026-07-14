/**
 * WHAT:  Tests for isValidEmail — the gate the auth flow uses to enable
 *        "Continue".
 * WHY:   A wrong verdict either blocks a real user or fires an OTP request at a
 *        malformed address (wasting the tight 2/hour send budget), so the
 *        accept/reject boundary is pinned.
 * LINKS: src/shared/lib/email.ts, docs/TESTING.md.
 */

import { isValidEmail } from './email';

describe('isValidEmail', () => {
  it('accepts well-formed addresses (and trims surrounding space)', () => {
    expect(isValidEmail('jane@example.com')).toBe(true);
    expect(isValidEmail('oliver.best3@gmail.com')).toBe(true);
    expect(isValidEmail('  jane@example.com  ')).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('jane')).toBe(false);
    expect(isValidEmail('jane@')).toBe(false);
    expect(isValidEmail('@example.com')).toBe(false);
    expect(isValidEmail('jane @example.com')).toBe(false);
  });
});
