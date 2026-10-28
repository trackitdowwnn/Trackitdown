/**
 * WHAT:  The Edge Functions' logger. `createLog(fn)` returns debug/info/warn/
 *        error, each writing ONE line: JSON in production, readable text when
 *        APP_ENV=development. Every line carries ts (UTC), level, msg,
 *        service, fn, env, version and — inside a request wrapped by
 *        withHandler — the W3C trace id, span id and request id, found through
 *        AsyncLocalStorage so no helper has to be handed them.
 * WHY:   docs/logging-decisions.md. Supabase already collects stdout, so a
 *        structured line there is searchable with no pipeline to run. Settings
 *        come from secrets: LOG_LEVEL (default info), APP_ENV (default
 *        production), RELEASE (the git SHA, set by deploy.yml),
 *        LOG_REDACT_KEYS (extra key names to mask).
 *        NON-BLOCKING AND NEVER THROWS: one console call, nothing awaited, and
 *        a line that cannot be built becomes `log_failed` — logging must never
 *        be the reason a request fails.
 *        A SHARED module makes its own `createLog('refundEscrow')`: inside a
 *        request its lines say the calling function in `fn` and itself in
 *        `module`, so a refund logged from stripe-webhook reads as stripe-webhook.
 *        Mock it by passing `write` (and `env`); nothing touches Deno at import.
 * LINKS: ./redact.ts; ./handler.ts (sets the request context); ./log.test.ts;
 *        docs/logging-decisions.md; docs/LOGGING.md.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { extraKeyMatcher, redact } from './redact.ts';

export type Level = 'debug' | 'info' | 'warn' | 'error';
export type LogData = Record<string, unknown>;
export interface Log {
  /** The function (or shared module) this logger was made for. */
  readonly name: string;
  debug(msg: string, data?: LogData): void;
  info(msg: string, data?: LogData): void;
  warn(msg: string, data?: LogData): void;
  error(msg: string, data?: LogData): void;
}

/** The OpenTelemetry-shaped ids every line inside a request carries. */
export interface TraceContext {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  request_id: string;
  /** The function serving the request (set by withHandler). */
  fn?: string;
}

const store = new AsyncLocalStorage<TraceContext>();

/** Runs `fn` with `context` visible to every log line it causes, across awaits. */
export function runInContext<T>(context: TraceContext, fn: () => T): T {
  return store.run(context, fn);
}

export function currentContext(): TraceContext | undefined {
  return store.getStore();
}

type Env = (name: string) => string | undefined;
type Write = (level: Level, line: string) => void;

export const denoEnv: Env = (name) =>
  (globalThis as { Deno?: { env?: { get(n: string): string | undefined } } }).Deno?.env?.get(name);

const consoleWrite: Write = (level, line) => {
  // The matching console method, so Supabase's log explorer filters by level.
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
};

let errorSink: ((msg: string, data: LogData) => void) | undefined;

/** Where error lines also go (./sentry.ts); one sink, replaced by the next call. */
export function onErrorLine(sink: ((msg: string, data: LogData) => void) | undefined): void {
  errorSink = sink;
}

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const isLevel = (value: string | undefined): value is Level =>
  value !== undefined && Object.hasOwn(RANK, value);

export function createLog(fn: string, options: { env?: Env; write?: Write } = {}): Log {
  const env = options.env ?? denoEnv;
  const write = options.write ?? consoleWrite;
  const configured = env('LOG_LEVEL')?.toLowerCase();
  const threshold = RANK[isLevel(configured) ? configured : 'info'];
  const environment = env('APP_ENV') ?? 'production';
  const version = env('RELEASE') ?? 'unknown';
  const extraKeys = extraKeyMatcher(env('LOG_REDACT_KEYS'));
  const pretty = environment === 'development';

  const emit = (level: Level, msg: string, data?: LogData) => {
    if (RANK[level] < threshold) return;
    try {
      const { fn: serving, ...ids } = currentContext() ?? {};
      const base = {
        ts: new Date().toISOString(),
        level,
        msg,
        service: 'edge',
        fn: serving ?? fn,
        ...(serving && serving !== fn ? { module: fn } : {}),
        env: environment,
        version,
        ...ids,
      };
      const own = (data ? redact(data, extraKeys) : {}) as LogData;
      if (pretty) {
        const extra = Object.keys(own).length ? ` ${JSON.stringify(own)}` : '';
        write(level, `${base.ts} ${level.toUpperCase()} [${base.fn}] ${msg}${extra}`);
        if (level === 'error') errorSink?.(msg, own);
        return;
      }
      // The entry's own data can't overwrite a base field.
      const entry: LogData = { ...base };
      for (const [key, value] of Object.entries(own)) if (!(key in entry)) entry[key] = value;
      write(level, JSON.stringify(entry));
      if (level === 'error') errorSink?.(msg, own);
    } catch {
      write(
        'error',
        JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'log_failed', fn }),
      );
    }
  };

  return {
    name: fn,
    debug: (msg, data) => emit('debug', msg, data),
    info: (msg, data) => emit('info', msg, data),
    warn: (msg, data) => emit('warn', msg, data),
    error: (msg, data) => emit('error', msg, data),
  };
}
