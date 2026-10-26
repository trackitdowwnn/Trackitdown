/**
 * WHAT:  Tests for lib/turnstile — when captcha is on, the widget page, and
 *        the messages the page may post.
 * WHY:   Off must mean OFF (no key or no https origin → no widget, no token),
 *        or sign-in breaks before the dashboard switch; and the page must ask
 *        for a fresh token per request, because Supabase takes each once.
 * LINKS: src/features/auth/lib/turnstile.ts.
 */

import { captchaConfig, parseTurnstileMessage, turnstileHtml } from './turnstile';

function setEnv(siteKey: string, origin: string) {
  process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = siteKey;
  process.env.EXPO_PUBLIC_TURNSTILE_ORIGIN = origin;
}

afterEach(() => {
  delete process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY;
  delete process.env.EXPO_PUBLIC_TURNSTILE_ORIGIN;
});

describe('captchaConfig', () => {
  it('is off without a site key or origin', () => {
    setEnv('', '');
    expect(captchaConfig()).toBeNull();
  });

  it('is off for a non-https origin', () => {
    setEnv('0x4AAA', 'http://example.com');
    expect(captchaConfig()).toBeNull();
  });

  it('is on with both', () => {
    setEnv(' 0x4AAA ', 'https://example.com');
    expect(captchaConfig()).toEqual({ siteKey: '0x4AAA', origin: 'https://example.com' });
  });
});

describe('turnstileHtml', () => {
  it('renders the key as a JSON string and runs only on request', () => {
    const html = turnstileHtml('0x4AAA"x');
    expect(html).toContain('sitekey:"0x4AAA\\"x"');
    expect(html).toContain("execution:'execute'");
    expect(html).toContain("appearance:'interaction-only'");
    expect(html).toContain('https://challenges.cloudflare.com/turnstile/v0/api.js');
  });
});

describe('parseTurnstileMessage', () => {
  it.each([
    ['{"type":"token","token":"abc"}', { type: 'token', token: 'abc' }],
    ['{"type":"error"}', { type: 'error' }],
    ['{"type":"interactive"}', { type: 'interactive' }],
    ['{"type":"done"}', { type: 'done' }],
  ])('reads %s', (data, expected) => {
    expect(parseTurnstileMessage(data)).toEqual(expected);
  });

  it.each(['{"type":"token"}', '{"type":"token","token":""}', '{"type":"other"}', 'not json'])(
    'ignores %s',
    (data) => {
      expect(parseTurnstileMessage(data)).toBeNull();
    },
  );
});
