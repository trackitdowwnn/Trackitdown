/**
 * @jest-environment node
 *
 * WHAT:  Tests for ./handler.ts — trace ids from `traceparent`, context that
 *        survives awaits and does not bleed between concurrent requests,
 *        `request_end`, the top-level catch, and `x-request-id`.
 * WHY:   Every function will sit behind withHandler. A context that leaked
 *        from one request into another would stamp one user's request id on
 *        another's lines — worse than no id at all.
 *        The node environment because Request/Response are Node globals.
 * LINKS: ./handler.ts; ./log.ts; ./log.test.ts.
 */

import { traceFor, withHandler } from './handler';
import { createLog } from './log';

function setup() {
  const lines: Record<string, unknown>[] = [];
  const log = createLog('test-fn', {
    env: () => undefined,
    write: (_level, line) => lines.push(JSON.parse(line)),
  });
  return { log, lines };
}

const post = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/test-fn', { method: 'POST', headers });

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('traceFor', () => {
  it('continues a valid W3C traceparent with a new span', () => {
    const trace = traceFor('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
    expect(trace.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(trace.parent_span_id).toBe('00f067aa0ba902b7');
    expect(trace.span_id).toMatch(/^[0-9a-f]{16}$/);
    expect(trace.span_id).not.toBe('00f067aa0ba902b7');
    expect(trace.request_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    ['missing', null],
    ['garbage', 'not-a-traceparent'],
    ['all-zero trace', '00-00000000000000000000000000000000-00f067aa0ba902b7-01'],
    ['all-zero span', '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01'],
  ])('starts a new trace when the header is %s', (_name, header) => {
    const trace = traceFor(header);
    expect(trace.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(trace.parent_span_id).toBeUndefined();
  });
});

describe('withHandler', () => {
  it('gives every line in a request the same ids, across awaits', async () => {
    const { log, lines } = setup();
    const serve = withHandler(log, async () => {
      log.info('before');
      await tick();
      log.info('after');
      return new Response('ok');
    });
    const response = await serve(
      post({ traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' }),
    );
    expect(lines.map((l) => l.msg)).toEqual(['before', 'after', 'request_end']);
    const ids = new Set(lines.map((l) => `${l.trace_id}/${l.span_id}/${l.request_id}`));
    expect(ids.size).toBe(1);
    expect(lines[0].trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(response.headers.get('x-request-id')).toBe(lines[0].request_id);
  });

  it('⚠️ never mixes the ids of two requests in flight together', async () => {
    const { log, lines } = setup();
    const serve = withHandler(log, async (request) => {
      const who = request.headers.get('x-who');
      await tick();
      log.info('work', { who });
      await tick();
      return new Response(who);
    });
    const [a, b] = await Promise.all([
      serve(post({ 'x-who': 'a' })),
      serve(post({ 'x-who': 'b' })),
    ]);
    const work = lines.filter((l) => l.msg === 'work');
    expect(work.find((l) => l.who === 'a')?.request_id).toBe(a.headers.get('x-request-id'));
    expect(work.find((l) => l.who === 'b')?.request_id).toBe(b.headers.get('x-request-id'));
    expect(a.headers.get('x-request-id')).not.toBe(b.headers.get('x-request-id'));
  });

  it('logs request_end with method, path, status and duration', async () => {
    const { log, lines } = setup();
    await withHandler(log, () => new Response('no', { status: 404 }))(post());
    expect(lines).toEqual([
      expect.objectContaining({
        msg: 'request_end',
        level: 'info',
        method: 'POST',
        path: '/test-fn',
        status: 404,
        duration_ms: expect.any(Number),
      }),
    ]);
  });

  it('skips request_end for preflights and health checks', async () => {
    const { log, lines } = setup();
    const serve = withHandler(log, () => new Response('ok'));
    await serve(new Request('http://localhost/test-fn', { method: 'OPTIONS' }));
    await serve(new Request('http://localhost/test-fn/health'));
    expect(lines).toEqual([]);
  });

  it('catches a throw: logs its stack and answers the house 500', async () => {
    const { log, lines } = setup();
    const response = await withHandler(log, async () => {
      throw new Error('kaboom');
    })(post());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Something went wrong. Please try again.',
      code: 'INTERNAL',
    });
    expect(response.headers.get('x-request-id')).toBeTruthy();
    const [failure, end] = lines;
    expect(failure).toMatchObject({
      level: 'error',
      msg: 'unhandled_error',
      error: { message: 'kaboom' },
    });
    expect((failure.error as { stack: string }).stack).toMatch(/^at /);
    expect(end).toMatchObject({ level: 'warn', msg: 'request_end', status: 500 });
  });

  it("keeps the handler's own headers and lets the app read the request id", async () => {
    const { log } = setup();
    const response = await withHandler(
      log,
      () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
    )(post());
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('access-control-expose-headers')).toBe('x-request-id');
  });
});
