/**
 * @jest-environment node
 *
 * WHAT:  Tests for ./tracedFetch.ts — a traceparent on Edge Function calls
 *        only, the server's request id logged when one fails, and nothing
 *        changed for any other request.
 * WHY:   This wraps EVERY request the Supabase client makes, sign-in and
 *        database reads included; a bug here breaks the whole app, and a
 *        dropped header on a Request input would break every function call.
 *        The node environment because Request/Response/Headers are Node globals.
 * LINKS: ./tracedFetch.ts; supabase/functions/_shared/handler.ts.
 */

import { getRecentLogs } from '../lib/logger';
import { createTracedFetch, newTraceparent } from './tracedFetch';

const FN_URL = 'https://x.supabase.co/functions/v1/create-payment-intent';

function fakeFetch(response: Response | Error = new Response('{}')) {
  return jest.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
}

const lastLog = () => getRecentLogs().at(-1);

describe('newTraceparent', () => {
  it('is a valid, sampled W3C traceparent', () => {
    expect(newTraceparent()).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(newTraceparent()).not.toBe(newTraceparent());
  });
});

describe('createTracedFetch', () => {
  it('adds a traceparent to an Edge Function call, keeping its headers', async () => {
    const base = fakeFetch();
    await createTracedFetch(base)(FN_URL, { method: 'POST', headers: { Authorization: 'Bearer t' } });
    const headers = base.mock.calls[0][1]?.headers as Headers;
    expect(headers.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(headers.get('authorization')).toBe('Bearer t');
  });

  it("⚠️ keeps a Request's own headers when no init is given", async () => {
    const base = fakeFetch();
    await createTracedFetch(base)(new Request(FN_URL, { headers: { apikey: 'k' } }));
    const headers = base.mock.calls[0][1]?.headers as Headers;
    expect(headers.get('apikey')).toBe('k');
    expect(headers.get('traceparent')).toBeTruthy();
  });

  it('leaves every other request exactly as it was', async () => {
    const base = fakeFetch();
    const init = { method: 'GET' };
    await createTracedFetch(base)('https://x.supabase.co/rest/v1/posts', init);
    expect(base).toHaveBeenCalledWith('https://x.supabase.co/rest/v1/posts', init);
  });

  it("logs a failed call with the function, status and the server's request id", async () => {
    const base = fakeFetch(
      new Response('{}', { status: 502, headers: { 'x-request-id': 'req-123' } }),
    );
    const response = await createTracedFetch(base)(`${FN_URL}?x=1`, { method: 'POST' });
    expect(response.status).toBe(502);
    expect(lastLog()).toMatchObject({
      level: 'error',
      feature: 'api',
      message: 'function_call_failed',
      data: { fn: 'create-payment-intent', status: 502, request_id: 'req-123' },
    });
  });

  it('logs a 4xx as a warning, and stays quiet on success', async () => {
    await createTracedFetch(fakeFetch(new Response('{}', { status: 401 })))(FN_URL);
    expect(lastLog()).toMatchObject({ level: 'warn', data: { status: 401 } });
    const before = getRecentLogs().length;
    await createTracedFetch(fakeFetch())(FN_URL);
    expect(getRecentLogs()).toHaveLength(before);
  });

  it('logs a network failure and rethrows it', async () => {
    const offline = new TypeError('Network request failed');
    await expect(createTracedFetch(fakeFetch(offline))(FN_URL)).rejects.toBe(offline);
    expect(lastLog()).toMatchObject({ level: 'warn', data: { fn: 'create-payment-intent', status: 0 } });
  });
});
