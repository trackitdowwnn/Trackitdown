/**
 * WHAT:  Server error reporting to Sentry (EU region):
 *          * startSentry() — once per isolate, from withHandler. Does NOTHING
 *            unless the SENTRY_DSN secret is set; then loads the SDK lazily;
 *          * every error-level log line becomes a Sentry event, grouped by
 *            function + event name, tagged with the request's trace and
 *            request ids (log.ts's onErrorLine);
 *          * reportException(err) — for throws nobody caught, with frames;
 *          * startCronCheckIn() — the heartbeat a scheduled job sends, so
 *            Sentry raises an issue when a run is missed or never finishes.
 * WHY:   docs/logging-decisions.md (decisions 1 and 4): server errors and a
 *        stopped hourly sweep must reach a person, not sit in a log.
 *        ⚠️ PRIVACY. defaultIntegrations is OFF: the defaults attach request
 *        data and turn every console line and fetch URL into breadcrumbs.
 *        Only cause chains (linkedErrors) and dedupe are on. Every event goes
 *        through scrubEvent: no request, user or breadcrumbs; messages
 *        scrubbed; extras redacted. A Stripe error is replaced by a copy with
 *        NO message before capture — its message can repeat a bank value.
 *        ⚠️ SCOPE. The Deno SDK shares one scope across requests in an
 *        isolate (Supabase's Sentry guide), so every capture runs in its own
 *        withScope and carries its own tags.
 *        Flushed off the response path (EdgeRuntime.waitUntil).
 * LINKS: ./log.ts (onErrorLine); ./handler.ts; ./redact.ts;
 *        ../release-held-refunds/index.ts (the cron heartbeat);
 *        ./sentry.test.ts; docs/logging-decisions.md.
 */

import { currentContext, denoEnv, onErrorLine, type LogData } from './log.ts';
import { isStripeError, redact, scrubText } from './redact.ts';

type Sdk = typeof import('npm:@sentry/deno@11.7.0');
type Env = (name: string) => string | undefined;

/** Reported by reportException with real frames, so not again as a log line. */
const REPORTED_DIRECTLY = new Set(['unhandled_error', 'unhandled_rejection', 'uncaught_error']);

let ready: Promise<Sdk | null> | null = null;

function keepAlive(work: Promise<unknown>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?(p: Promise<unknown>): void } })
    .EdgeRuntime;
  if (typeof runtime?.waitUntil === 'function') runtime.waitUntil(work);
}

interface EventLike {
  message?: unknown;
  exception?: { values?: { type?: string; value?: string }[] };
  extra?: Record<string, unknown>;
  request?: unknown;
  user?: unknown;
  breadcrumbs?: unknown;
}

/** beforeSend: what is allowed to leave for Sentry. */
export function scrubEvent<E extends EventLike>(event: E): E {
  delete event.request;
  delete event.user;
  delete event.breadcrumbs;
  if (typeof event.message === 'string') event.message = scrubText(event.message);
  for (const value of event.exception?.values ?? []) {
    if (typeof value.value === 'string') value.value = scrubText(value.value).slice(0, 300);
  }
  if (event.extra) event.extra = redact(event.extra) as Record<string, unknown>;
  return event;
}

/** A Stripe error with its message removed; any other value unchanged. */
function safeError(error: unknown): unknown {
  if (!error || typeof error !== 'object' || !isStripeError(error as Record<string, unknown>)) {
    return error;
  }
  const e = error as { type?: string; code?: string; stack?: string };
  const copy = new Error([e.type, e.code].filter(Boolean).join(' '));
  copy.name = e.type ?? 'StripeError';
  const frames = (e.stack ?? '').split('\n').filter((line) => /^\s*at /.test(line));
  copy.stack = [copy.name, ...frames].join('\n');
  return copy;
}

/** One capture in its own scope, then a flush kept off the response path. */
function capture(
  send: (sdk: Sdk) => void,
  msg: string,
  options: { data?: LogData; fingerprint?: string[] } = {},
): Promise<void> {
  if (!ready) return Promise.resolve();
  const context = currentContext();
  const work = ready
    .then(async (sdk) => {
      if (!sdk) return;
      sdk.withScope((scope) => {
        scope.setTag('fn', context?.fn ?? 'unknown');
        if (context?.request_id) scope.setTag('request_id', context.request_id);
        if (context?.trace_id) scope.setTag('trace_id', context.trace_id);
        scope.setTag('event', msg);
        if (options.data) scope.setExtras(options.data);
        if (options.fingerprint) scope.setFingerprint(options.fingerprint);
        send(sdk);
      });
      await sdk.flush(2000);
    })
    .catch(() => undefined);
  keepAlive(work);
  return work;
}

export function startSentry(options: { env?: Env; load?: () => Promise<Sdk> } = {}): void {
  if (ready) return;
  const env = options.env ?? denoEnv;
  const dsn = env('SENTRY_DSN');
  if (!dsn) {
    ready = Promise.resolve(null);
    return;
  }
  const load = options.load ?? (() => import('npm:@sentry/deno@11.7.0'));
  ready = load()
    .then((sdk) => {
      sdk.init({
        dsn,
        environment: env('APP_ENV') ?? 'production',
        release: env('RELEASE'),
        defaultIntegrations: false,
        integrations: [sdk.linkedErrorsIntegration(), sdk.dedupeIntegration()],
        sendDefaultPii: false,
        enableOpenTelemetrySetup: false,
        beforeBreadcrumb: () => null,
        beforeSend: (event) => scrubEvent(event),
      });
      return sdk;
    })
    .catch(() => null);
  onErrorLine((msg, data) => {
    if (REPORTED_DIRECTLY.has(msg)) return;
    // One Sentry issue per function + event, however the data differs.
    const fingerprint = [currentContext()?.fn ?? 'unknown', msg];
    void capture((sdk) => sdk.captureMessage(msg, 'error'), msg, { data, fingerprint });
  });
}

/** A throw nobody caught: sent with its frames (a Stripe error's message removed). */
export function reportException(error: unknown, msg: string): Promise<void> {
  return capture((sdk) => sdk.captureException(safeError(error)), msg);
}

/**
 * Tells Sentry a scheduled run has started; call the result when it ends.
 * The monitor is created on the first check-in; a missed or unfinished run
 * makes Sentry raise an issue. `schedule` is the job's crontab, in UTC.
 */
export function startCronCheckIn(
  monitorSlug: string,
  schedule: string,
): (status: 'ok' | 'error') => Promise<void> {
  if (!ready) return () => Promise.resolve();
  const started = ready.then((sdk) =>
    sdk?.captureCheckIn(
      { monitorSlug, status: 'in_progress' },
      {
        schedule: { type: 'crontab', value: schedule },
        checkinMargin: 10,
        maxRuntime: 15,
        timezone: 'Etc/UTC',
      },
    ),
  );
  keepAlive(started.catch(() => undefined));
  return (status) => {
    const work = Promise.all([ready, started])
      .then(async ([sdk, checkInId]) => {
        if (!sdk || !checkInId) return;
        sdk.captureCheckIn({ checkInId, monitorSlug, status });
        await sdk.flush(2000);
      })
      .catch(() => undefined);
    keepAlive(work);
    return work;
  };
}

/** Test seam: forget the SDK so the next startSentry starts clean. */
export function resetSentryForTests(): void {
  ready = null;
  onErrorLine(undefined);
}
