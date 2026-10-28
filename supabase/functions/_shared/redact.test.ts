/**
 * WHAT:  Tests for ./redact.ts — what may never reach a server log line.
 * WHY:   Redaction is the backstop for every log call in the functions, so a
 *        gap here is a leak everywhere. Each case is a value the never-log
 *        list in docs/LOGGING.md names, fed in the shape it really arrives in.
 * LINKS: ./redact.ts; docs/LOGGING.md; docs/logging-decisions.md.
 */

import { describeError, extraKeyMatcher, redact, scrubText } from './redact';

describe('redact — keys', () => {
  it.each([
    ['authorization', { authorization: 'Bearer abc' }],
    ['cookie', { cookie: 'sb=1' }],
    ['a token', { access_token: 'x' }],
    ['a password', { password: 'x' }],
    ['an api key', { apiKey: 'x' }],
    ['an idempotency key', { idempotency_key: 'x' }],
    ['an email', { email: 'x' }],
    ['a sort code', { sortCode: '112233' }],
    ['an account number', { account_number: '12345678' }],
    ['a plate', { plate: 'AB12CDE' }],
    ['a latitude', { lat: 51.5 }],
    ['a signed url', { signedUrl: 'https://x' }],
    ['message content', { content: 'hello' }],
  ])('masks %s', (_name, data) => {
    expect(Object.values(redact(data) as object)).toEqual(['[redacted]']);
  });

  it('masks at depth, inside arrays', () => {
    expect(redact({ a: { b: [{ headers: { Authorization: 'Bearer x' } }] } })).toEqual({
      a: { b: [{ headers: { Authorization: '[redacted]' } }] },
    });
  });

  it('keeps a count whose name mentions what it counts', () => {
    expect(redact({ pushTokensPurged: 3, deadlineAlertsEmailed: 0, token_count: 2 })).toEqual({
      pushTokensPurged: 3,
      deadlineAlertsEmailed: 0,
      token_count: 2,
    });
  });

  it('⚠️ still masks a number that is not a count, and any text under a count name', () => {
    expect(redact({ account_number: 12345678, sortCode: 112233, tokenSent: 'abc' })).toEqual({
      account_number: '[redacted]',
      sortCode: '[redacted]',
      tokenSent: '[redacted]',
    });
  });

  it('stops at 5 levels rather than walking forever', () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    expect(JSON.stringify(redact(deep))).toContain('[too deep]');
  });

  it('keeps the fields a log line is for', () => {
    const data = { user_id: 'u1', export_id: 'e1', status: 502, bytes: 10, label: 'posts' };
    expect(redact(data)).toEqual(data);
  });

  it('masks the extra keys named in LOG_REDACT_KEYS, and only those', () => {
    const extra = extraKeyMatcher(' surname , regNumber ');
    expect(redact({ surname: 'x', regnumber: 'y', status: 1 }, extra)).toEqual({
      surname: '[redacted]',
      regnumber: '[redacted]',
      status: 1,
    });
    expect(extraKeyMatcher('')).toBeUndefined();
  });
});

describe('redact — values', () => {
  it.each([
    // Joined at runtime so CI's secret scan doesn't read the fixture as a real token.
    ['a JWT', `jwt ${['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJ1MSJ9', 'c2lnbmF0dXJl'].join('.')} here`],
    ['a Stripe secret key', 'key sk_live_51Habcdef here'],
    ['a webhook secret', 'whsec_abc123 here'],
    ['a client secret', 'pi_3Abc_secret_Xyz here'],
    ['an account session secret', 'accs_secret__Abc123 here'],
    ['an email', 'from someone@example.com here'],
    ['a plate', 'car AB12 CDE here'],
  ])('scrubs %s out of free text', (_name, text) => {
    const out = scrubText(text);
    expect(out).toContain('[redacted]');
    expect(out).toMatch(/ here$/);
  });

  it('keeps the scheme of a Bearer header', () => {
    expect(scrubText('Bearer abc.def')).toBe('Bearer [redacted]');
  });

  it("masks a signed link's token, keeps the rest", () => {
    expect(scrubText('https://x.co/o/a.pdf?token=abc&download=a.pdf')).toBe(
      'https://x.co/o/a.pdf?token=[redacted]&download=a.pdf',
    );
  });

  it('turns an Error inside data into its description', () => {
    const out = redact({ error: new Error('boom') }) as { error: { message: string } };
    expect(out.error.message).toBe('boom');
  });
});

describe('describeError', () => {
  it('keeps name, message, code and frames — not the stack header', () => {
    const err = Object.assign(new Error('rpc failed for someone@example.com'), { code: 'P0001' });
    const out = describeError(err);
    expect(out).toMatchObject({
      name: 'Error',
      message: 'rpc failed for [redacted]',
      code: 'P0001',
    });
    expect(out.stack).toMatch(/^at /);
    expect(out.stack).not.toContain('someone@example.com');
  });

  it("⚠️ drops a Stripe error's message — and the stack line that repeats it", () => {
    const err = Object.assign(new Error('Invalid sort code 112233'), {
      type: 'StripeInvalidRequestError',
      rawType: 'invalid_request_error',
      code: 'routing_number_invalid',
      requestId: 'req_123',
    });
    const out = describeError(err);
    expect(out).toMatchObject({
      type: 'StripeInvalidRequestError',
      code: 'routing_number_invalid',
      stripe_request_id: 'req_123',
    });
    expect(JSON.stringify(out)).not.toContain('112233');
  });

  it("drops a PostgREST error's details and hint, which quote the row", () => {
    const out = describeError({
      message: 'duplicate key',
      code: '23505',
      details: 'Key (plate)=(AB12CDE) already exists.',
      hint: null,
    });
    expect(out).toEqual({ message: 'duplicate key', code: '23505' });
  });

  it('follows the cause chain three deep', () => {
    const e = new Error('e');
    const err = new Error('a', {
      cause: new Error('b', { cause: new Error('c', { cause: new Error('d', { cause: e }) }) }),
    });
    const json = JSON.stringify(describeError(err));
    expect(json).toContain('"message":"d"');
    expect(json).not.toContain('"message":"e"');
  });

  it('describes a thrown string or nothing at all', () => {
    expect(describeError('nope')).toEqual({ message: 'nope' });
    expect(describeError(undefined)).toEqual({ message: 'undefined' });
  });

  it('cuts a long message to 300 characters', () => {
    expect((describeError(new Error('x'.repeat(1000))).message as string).length).toBe(300);
  });
});
