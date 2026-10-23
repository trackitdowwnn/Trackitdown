/**
 * WHAT:  Tests for isRecentSignIn — the freshness check that stands between
 *        an unlocked phone and an account deletion.
 * WHY:   It fails CLOSED or it isn't a check: no amr, a garbled token, a stale
 *        or future timestamp must all read as "not recent".
 * LINKS: ./recentSignIn.ts.
 */

import { isRecentSignIn, RECENT_SIGN_IN_SECONDS } from './recentSignIn';

const NOW = 1_800_000_000;

/** A JWT-shaped string with this payload (unsigned — the check decodes only). */
function jwt(payload: unknown): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode(payload)}.signature`;
}

describe('isRecentSignIn', () => {
  it('a code verified a minute ago is recent', () => {
    expect(isRecentSignIn(jwt({ amr: [{ method: 'otp', timestamp: NOW - 60 }] }), NOW)).toBe(true);
  });

  it('the latest method counts when there are several', () => {
    const token = jwt({
      amr: [
        { method: 'otp', timestamp: NOW - 86_400 },
        { method: 'oauth', timestamp: NOW - 30 },
      ],
    });
    expect(isRecentSignIn(token, NOW)).toBe(true);
  });

  it('⚠️ a session signed in yesterday is not — refreshing keeps the old time', () => {
    const token = jwt({ amr: [{ method: 'otp', timestamp: NOW - 86_400 }] });
    expect(isRecentSignIn(token, NOW)).toBe(false);
  });

  // ⚠️ A stolen token can mint these without the inbox or the provider
  // account — they must never count as proof (security review of #266).
  it.each(['password', 'totp', 'token_refresh', 'recovery', 'anonymous', 'mfa/phone'])(
    'a fresh %s claim beside an old code does not count',
    (method) => {
      const token = jwt({
        amr: [
          { method: 'otp', timestamp: NOW - 86_400 },
          { method, timestamp: NOW - 10 },
        ],
      });
      expect(isRecentSignIn(token, NOW)).toBe(false);
    },
  );

  it('just past the window is not', () => {
    const token = jwt({ amr: [{ method: 'otp', timestamp: NOW - RECENT_SIGN_IN_SECONDS - 1 }] });
    expect(isRecentSignIn(token, NOW)).toBe(false);
  });

  it.each([
    ['no amr', jwt({ sub: 'u1' })],
    ['amr not a list', jwt({ amr: 'otp' })],
    ['amr without timestamps', jwt({ amr: [{ method: 'otp' }] })],
    ['a timestamp from the future', jwt({ amr: [{ method: 'otp', timestamp: NOW + 3600 }] })],
    ['not a JWT', 'nonsense'],
    ['a garbled payload', 'aGVhZGVy.!!!.sig'],
  ])('fails closed: %s', (_case, token) => {
    expect(isRecentSignIn(token, NOW)).toBe(false);
  });
});
