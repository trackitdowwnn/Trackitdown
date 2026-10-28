/**
 * WHAT:  `withHandler(log, handler)` wraps a function's Deno.serve handler:
 *          * reads the caller's W3C `traceparent` (or starts a new trace) and
 *            gives the request a span id and a request id, visible to every
 *            log line through ./log.ts's AsyncLocalStorage;
 *          * logs `request_end` { method, path, status, duration_ms } — not
 *            for OPTIONS preflights or a /health path;
 *          * catches anything the handler throws, logs `unhandled_error` with
 *            its stack, and answers the house 500 { code: 'INTERNAL' };
 *          * returns `x-request-id` on every response, so an app-side failure
 *            can be matched to its one server line;
 *          * once per isolate, logs `unhandled_rejection` / `uncaught_error`.
 * WHY:   docs/logging-decisions.md. Before this, a throw escaped Deno.serve as
 *        a bare 500 with nothing tying it to a request.
 *        The global listeners only RECORD — they never preventDefault, so the
 *        runtime treats an unhandled rejection exactly as it did before.
 * LINKS: ./log.ts; ./redact.ts (describeError); ./http.ts (errorResponse);
 *        ./handler.test.ts.
 */

import { errorResponse } from './http.ts';
import { runInContext, type Log, type TraceContext } from './log.ts';
import { describeError } from './redact.ts';

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

/** The ids for one request: the caller's trace if it sent a valid one, else a new one. */
export function traceFor(traceparent: string | null): TraceContext {
  const match = traceparent?.trim().toLowerCase().match(TRACEPARENT);
  const valid = match && !/^0+$/.test(match[1]) && !/^0+$/.test(match[2]);
  return {
    trace_id: valid ? match[1] : randomHex(16),
    span_id: randomHex(8),
    ...(valid ? { parent_span_id: match[2] } : {}),
    request_id: crypto.randomUUID(),
  };
}

let globalsInstalled = false;

function installGlobalHandlers(log: Log): void {
  if (globalsInstalled || typeof globalThis.addEventListener !== 'function') return;
  globalsInstalled = true;
  globalThis.addEventListener('unhandledrejection', (event) => {
    log.error('unhandled_rejection', {
      error: describeError((event as PromiseRejectionEvent).reason),
    });
  });
  globalThis.addEventListener('error', (event) => {
    const e = event as ErrorEvent;
    log.error('uncaught_error', { error: describeError(e.error ?? e.message) });
  });
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/** The response with x-request-id added (a fetched Response's headers are read-only). */
function withRequestId(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set('x-request-id', requestId);
  headers.set('Access-Control-Expose-Headers', 'x-request-id');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function withHandler(
  log: Log,
  handler: (request: Request) => Response | Promise<Response>,
): (request: Request) => Promise<Response> {
  installGlobalHandlers(log);
  return (request) => {
    const context = traceFor(request.headers.get('traceparent'));
    return runInContext(context, async () => {
      const started = Date.now();
      let response: Response;
      try {
        response = await handler(request);
      } catch (error) {
        log.error('unhandled_error', { error: describeError(error) });
        response = errorResponse('INTERNAL', 'Something went wrong. Please try again.', 500);
      }
      const path = pathOf(request.url);
      if (request.method !== 'OPTIONS' && !/\/health\/?$/.test(path)) {
        const end = {
          method: request.method,
          path,
          status: response.status,
          duration_ms: Date.now() - started,
        };
        if (response.status >= 500) log.warn('request_end', end);
        else log.info('request_end', end);
      }
      return withRequestId(response, context.request_id);
    });
  };
}
