/**
 * WHAT:  The fetch the Supabase client uses. For an Edge Function call
 *        (`/functions/v1/<name>`) it sends a fresh W3C `traceparent`, and
 *        when the call fails it logs `function_call_failed` with the
 *        function, the status and the server's `x-request-id`. Every other
 *        request (PostgREST, Auth, Storage) passes through untouched.
 * WHY:   docs/logging-decisions.md: an app-side failure must lead to its
 *        one server log line. The server continues the trace id from
 *        `traceparent` and answers with `x-request-id`; the request id lands
 *        in the device log (Metro, and the dev-only "copy logs"). It does NOT
 *        leave the phone: bug reports carry event names only
 *        (bugBreadcrumbs.ts) and telemetry drops UUIDs (decision 3) — a 5xx
 *        reaches telemetry as the function and status, matched by time.
 *        Trace ids are random, not cryptographic: they correlate, they grant
 *        nothing.
 * LINKS: ./supabase.ts (global.fetch); supabase/functions/_shared/handler.ts
 *        (reads traceparent, sets x-request-id); ./tracedFetch.test.ts.
 */

import { createLogger } from '../lib/logger';

const log = createLogger('api');

const FUNCTIONS_PATH = '/functions/v1/';

function randomHex(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ((Math.random() * 16) | 0).toString(16);
  return out;
}

/** A new trace for one call: `00-<32 hex>-<16 hex>-01` (sampled). */
export function newTraceparent(): string {
  return `00-${randomHex(32)}-${randomHex(16)}-01`;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** `https://x.supabase.co/functions/v1/create-payment-intent?a=1` → `create-payment-intent`. */
function functionName(url: string): string {
  return url.slice(url.indexOf(FUNCTIONS_PATH) + FUNCTIONS_PATH.length).split(/[/?#]/)[0];
}

export function createTracedFetch(override?: typeof fetch): typeof fetch {
  return async (input, init) => {
    // Resolved per call, so a later polyfill or test mock of fetch applies.
    const base = override ?? fetch;
    const url = urlOf(input);
    if (!url.includes(FUNCTIONS_PATH)) return base(input, init);

    const fn = functionName(url);
    // From init when given, else from a Request — fetch(Request, { headers })
    // REPLACES the request's headers, so they must be carried over.
    const headers = new Headers(
      init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined),
    );
    headers.set('traceparent', newTraceparent());

    let response: Response;
    try {
      response = await base(input, { ...init, headers });
    } catch (error) {
      log.warn('function_call_failed', { fn, status: 0 });
      throw error;
    }
    if (!response.ok) {
      const failure = {
        fn,
        status: response.status,
        request_id: response.headers.get('x-request-id') ?? undefined,
      };
      if (response.status >= 500) log.error('function_call_failed', failure);
      else log.warn('function_call_failed', failure);
    }
    return response;
  };
}
