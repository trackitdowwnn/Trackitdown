/**
 * WHAT:  Tests for ./sentry.ts against a fake SDK — inert without a DSN, the
 *        privacy settings, what an error line and an uncaught throw send,
 *        scope tags per request, scrubbing, and the cron heartbeat.
 * WHY:   Sentry is a third party: everything it receives leaves our systems.
 *        These pin that a Stripe message, a request, breadcrumbs and secret-
 *        shaped text never go, and that nothing at all goes until the owner
 *        sets SENTRY_DSN.
 * LINKS: ./sentry.ts; ./log.ts (onErrorLine); docs/logging-decisions.md.
 */

import { createLog, runInContext } from './log';
import {
  reportException,
  resetSentryForTests,
  scrubEvent,
  startCronCheckIn,
  startSentry,
} from './sentry';

function fakeSdk() {
  const scopes: { tags: Record<string, string>; extras?: unknown; fingerprint?: string[] }[] = [];
  const sent: { kind: string; value: unknown }[] = [];
  let current: (typeof scopes)[number];
  const sdk = {
    init: jest.fn(),
    linkedErrorsIntegration: jest.fn(() => 'linkedErrors'),
    dedupeIntegration: jest.fn(() => 'dedupe'),
    withScope: jest.fn((cb: (scope: unknown) => void) => {
      current = { tags: {} };
      scopes.push(current);
      cb({
        setTag: (k: string, v: string) => (current.tags[k] = v),
        setExtras: (e: unknown) => (current.extras = e),
        setFingerprint: (f: string[]) => (current.fingerprint = f),
      });
    }),
    captureMessage: jest.fn((value: string) => sent.push({ kind: 'message', value })),
    captureException: jest.fn((value: unknown) => sent.push({ kind: 'exception', value })),
    captureCheckIn: jest.fn((checkIn: { status: string }) =>
      checkIn.status === 'in_progress' ? 'check-in-1' : 'check-in-1',
    ),
    flush: jest.fn(() => Promise.resolve(true)),
  };
  return { sdk, scopes, sent };
}

const ctx = {
  trace_id: 'a'.repeat(32),
  span_id: 'b'.repeat(16),
  request_id: 'req-1',
  fn: 'stripe-webhook',
};
const quiet = () => createLog('stripe-webhook', { env: () => undefined, write: () => {} });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => resetSentryForTests());

describe('without SENTRY_DSN', () => {
  it('loads nothing and sends nothing', async () => {
    const load = jest.fn();
    startSentry({ env: () => undefined, load });
    quiet().error('payments_refund_create_failed');
    await reportException(new Error('x'), 'unhandled_error');
    await startCronCheckIn('release-held-refunds', '0 * * * *')('ok');
    expect(load).not.toHaveBeenCalled();
  });
});

describe('with SENTRY_DSN', () => {
  function start() {
    const fake = fakeSdk();
    startSentry({
      env: (name) => ({ SENTRY_DSN: 'https://k@o1.ingest.de.sentry.io/1', RELEASE: 'abc' })[name],
      load: () => Promise.resolve(fake.sdk as never),
    });
    return fake;
  }

  it('⚠️ starts with the default integrations OFF and no personal data', async () => {
    const { sdk } = start();
    await settle();
    expect(sdk.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://k@o1.ingest.de.sentry.io/1',
        release: 'abc',
        environment: 'production',
        defaultIntegrations: false,
        integrations: ['linkedErrors', 'dedupe'],
        sendDefaultPii: false,
        // A message must not get a synthetic stack (it titled the issue after sentry.ts).
        attachStacktrace: false,
      }),
    );
    const options = sdk.init.mock.calls[0][0];
    expect(options.beforeBreadcrumb()).toBeNull();
  });

  it('sends an error line, grouped by function + event, tagged with its request', async () => {
    const { sent, scopes } = start();
    runInContext(ctx, () =>
      quiet().error('payments_refund_create_failed', { post_id: 'p1', email: 'a@b.co' }),
    );
    await settle();
    await settle();
    expect(sent).toEqual([{ kind: 'message', value: 'payments_refund_create_failed' }]);
    expect(scopes[0]).toEqual({
      tags: {
        fn: 'stripe-webhook',
        request_id: 'req-1',
        trace_id: 'a'.repeat(32),
        event: 'payments_refund_create_failed',
      },
      extras: { post_id: 'p1', email: '[redacted]' },
      fingerprint: ['stripe-webhook', 'payments_refund_create_failed'],
    });
  });

  it('ignores warn and info lines', async () => {
    const { sent } = start();
    quiet().warn('payments_refund_id_lookup_failed');
    quiet().info('payments_charge_captured');
    await settle();
    expect(sent).toEqual([]);
  });

  it('does not send an unhandled error twice', async () => {
    const { sent } = start();
    runInContext(ctx, () => quiet().error('unhandled_error', { error: { message: 'boom' } }));
    await runInContext(ctx, () => reportException(new Error('boom'), 'unhandled_error'));
    expect(sent.map((s) => s.kind)).toEqual(['exception']);
  });

  it('⚠️ sends a Stripe error with its frames but WITHOUT its message', async () => {
    const { sent } = start();
    const stripeError = Object.assign(new Error('Invalid sort code 112233'), {
      type: 'StripeInvalidRequestError',
      rawType: 'invalid_request_error',
      code: 'routing_number_invalid',
    });
    await reportException(stripeError, 'unhandled_error');
    const value = sent[0].value as Error;
    expect(value.message).toBe('StripeInvalidRequestError routing_number_invalid');
    expect(value.stack).toMatch(/\n\s*at /);
    expect(JSON.stringify({ m: value.message, s: value.stack })).not.toContain('112233');
  });

  it("keeps two requests' tags apart", async () => {
    const { scopes } = start();
    await Promise.all([
      runInContext({ ...ctx, request_id: 'req-a' }, () => reportException(new Error('a'), 'x')),
      runInContext({ ...ctx, request_id: 'req-b' }, () => reportException(new Error('b'), 'x')),
    ]);
    expect(scopes.map((s) => s.tags.request_id).sort()).toEqual(['req-a', 'req-b']);
  });

  it('sends a heartbeat: in progress, then ok with the same check-in id', async () => {
    const { sdk } = start();
    await startCronCheckIn('release-held-refunds', '0 * * * *')('ok');
    expect(sdk.captureCheckIn.mock.calls).toEqual([
      [
        { monitorSlug: 'release-held-refunds', status: 'in_progress' },
        expect.objectContaining({
          schedule: { type: 'crontab', value: '0 * * * *' },
          timezone: 'Etc/UTC',
        }),
      ],
      [{ checkInId: 'check-in-1', monitorSlug: 'release-held-refunds', status: 'ok' }],
    ]);
  });

  it('never throws when the SDK fails to load', async () => {
    startSentry({ env: () => 'dsn', load: () => Promise.reject(new Error('offline')) });
    expect(() => quiet().error('x')).not.toThrow();
    await expect(reportException(new Error('x'), 'y')).resolves.toBeUndefined();
  });
});

describe('scrubEvent', () => {
  it('⚠️ drops request, user and breadcrumbs, scrubs messages, redacts extras', () => {
    const event = scrubEvent({
      message: 'failed for someone@example.com',
      exception: {
        values: [{ type: 'Error', value: 'token eyJhbGciOiJIUzI1NiJ9 Bearer abc.def' }],
      },
      extra: { authorization: 'Bearer x', post_id: 'p1' },
      request: { headers: { cookie: 'x' } },
      user: { id: 'u1' },
      breadcrumbs: [{ message: 'x' }],
    });
    expect(event).toEqual({
      message: 'failed for [redacted]',
      exception: {
        values: [{ type: 'Error', value: 'token eyJhbGciOiJIUzI1NiJ9 Bearer [redacted]' }],
      },
      extra: { authorization: '[redacted]', post_id: 'p1' },
      sdk: { settings: { infer_ip: 'never' } },
    });
  });

  it('⚠️ tells Sentry never to infer an IP, keeping the SDK fields', () => {
    const event = scrubEvent({ sdk: { name: 'sentry.javascript.deno', settings: { x: 1 } } });
    expect(event.sdk).toEqual({
      name: 'sentry.javascript.deno',
      settings: { x: 1, infer_ip: 'never' },
    });
  });
});
