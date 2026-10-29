# Logging

How to log in Trackitdown — the app and the Edge Functions — what to log at
each level, what must never be logged, and where every line ends up. The
decisions behind it (and how to change one) are in
[`logging-decisions.md`](logging-decisions.md).

**The one rule:** never call `console.*` directly. The app uses
`src/shared/lib/logger.ts`; Edge Functions use `supabase/functions/_shared/log.ts`.
Raw console calls are untagged, unredacted and invisible to telemetry and
Sentry. ⚠️ This is a convention, **not yet enforced**: the ESLint `no-console`
rule is still to be added (a config-protection hook blocks edits to
`eslint.config.js`). Today the only raw call left in app code is a dev warning
in `src/shared/theme/paletteContext.tsx`; none are left in any Edge Function.

## Where a line goes

| Written by | Goes to | Kept |
|---|---|---|
| App `log.*` | Metro / device console; the 300-entry ring buffer (a bug report carries the last 50 event **names**, never their data) | Until the app restarts |
| App `log.error`, and `log.info` named in snake_case | `public.telemetry_events`, allow-listed props only | Telemetry retention rule |
| Edge Function `log.*` | Supabase function logs, one JSON line | Supabase's log retention (short — plan-dependent) |
| Edge Function `log.error`, any uncaught throw | Sentry (EU), once `SENTRY_DSN` is set | Sentry free tier |
| Any change to a `payments` row's money | `public.audit_payment_events` (a trigger, not a log) | 6 years, append-only |

Anything that must last goes in the audit table or Sentry, never only in a log.

## In the app

```ts
import { createLogger } from '@/shared/lib/logger';
const log = createLogger('sightings'); // the feature folder name

log.info('sighting_submit', { photoCount: 2, durationMs }); // an event: recorded
log.warn('Upload retry', { attempt: 2 });                    // console + ring buffer only
log.error('Sighting submit failed', { code });               // recorded as error_sighting_submit_failed
```

- **Tags** are feature folder names (`auth`, `vehicles`, `sightings`,
  `search-map`, `notifications`, `payments`, `chat`, `profile`, `moderation`,
  `watchlist`, `garage`), plus `app` (crashes, startup) and `api` (Edge
  Function calls).
- **Level** comes from `EXPO_PUBLIC_LOG_LEVEL`: `debug` by default in dev,
  `info` in a release build.
- **Format** in the console: `🐛 DEBUG | ℹ️ INFO | ⚠️ WARN | 🔴 ERROR [feature] message { data }`.
- **Telemetry** (`src/shared/lib/telemetry.ts`) records every `error` and every
  `info` whose message is a snake_case event name. Only keys on the allow-list
  (`TELEMETRY_KEYS`) leave the device, as scalars; any string holding a UUID and
  any number shaped like a coordinate is dropped, and the database strips the
  same again. **Adding a key is a privacy decision** — say why in the PR.
- **Never log from the telemetry sink** or anything it calls during a flush: it
  runs inside `emit`, so one log line there is an infinite loop.

### Calls to Edge Functions

Every `supabase.functions.invoke` goes through `src/shared/api/tracedFetch.ts`,
which sends a W3C `traceparent` and, when the call fails, logs
`function_call_failed { fn, status, request_id }`. The `request_id` is the
server's `x-request-id` — the key to that call's server lines (see *Tracing a
failure*). It stays on the device: telemetry drops it (a UUID) and bug reports
carry event names only. You don't need to log the failure again; log what it
means for the user.

### Crashes

`src/shared/lib/crashReporting.ts` reports a crash as one `app_crash` event —
`{ kind, type, frame, ota }`, **never the message** — from React Native's
global error handler (chained, not replaced), Hermes's unhandled-rejection
tracker (release builds), and the root `ErrorBoundary` in `src/app/_layout.tsx`
(“Something went wrong” / “Try again”). `ota` is the first 8 characters of the
running update id, matching `eas update:list`. Native crashes are not caught
until `@sentry/react-native` ships with the next native build.

## In Edge Functions

```ts
import { withHandler } from '../_shared/handler.ts';
import { createLog } from '../_shared/log.ts';
import { describeError } from '../_shared/redact.ts';

const log = createLog('release-payout');

Deno.serve(withHandler(log, async (request) => {
  // …
  if (error) {
    log.error('payments_transfer_create_failed', { post_id: postId, error: describeError(error) });
    return errorResponse('STRIPE_ERROR', 'We couldn’t send the payout. Please try again.', 502);
  }
  log.info('payments_bounty_released', { post_id: postId, transfer_pence: transferPence });
  return jsonResponse({ released: true });
}));
```

- **Every function** wraps its handler in `withHandler`. It continues the
  caller's `traceparent` (or starts a trace), gives the request a span and a
  request id, logs `request_end { method, path, status, duration_ms }` (not for
  preflights or `/health`), catches any throw (logged as `unhandled_error` with
  its stack, answered with the house 500 `{ code: 'INTERNAL' }`), and returns
  `x-request-id`.
- **Shared modules** make their own logger — `createLog('refundEscrow')`.
  Inside a request their lines carry the serving function in `fn` and
  themselves in `module`, with the same ids.
- **Errors** always go through `describeError(err)`: name, code, cause chain,
  stack frames. It drops a **Stripe error's message** (it can repeat a rejected
  bank value) and PostgREST's `details` and `hint` (they quote the failing row).
  Never log `err.message` yourself.
- **Settings** are function secrets: `LOG_LEVEL` (default `info`), `APP_ENV`
  (default `production`; `development` prints readable lines),
  `LOG_REDACT_KEYS` (extra key names to mask, comma-separated), `RELEASE` (set
  to the commit SHA by `deploy.yml`), `SENTRY_DSN` (Sentry stays off until set).
- **Tests** pass `createLog(fn, { write, env })` to capture lines; see
  `_shared/log.test.ts`.

### Sentry

`_shared/sentry.ts` sends every `log.error` line (one issue per function +
event) and every uncaught throw (with frames) to Sentry's EU region, tagged
with `fn`, `request_id`, `trace_id` and, from `describeError`, `error_type` and
`error_code`. An issue is titled from its event name —
`payments_refund_create_failed` reads **Payments: refund create failed** — with
the function underneath, so a good event name is a good Sentry title. The area
words are the `AREAS` list in `sentry.ts`. Default integrations are off and
`beforeSend` drops request, user and breadcrumbs and scrubs the rest. Scheduled
jobs send a heartbeat: `startCronCheckIn('release-held-refunds', '0 * * * *')`
at the start, the returned function with `'ok'` at the end — a missed or
unfinished run raises an issue. Nothing happens until the owner sets
`SENTRY_DSN`. Only `sentry.ts` may import the SDK.

## Field conventions

Every server line is one JSON object:

| Field | Meaning |
|---|---|
| `ts` | UTC ISO time |
| `level` | `debug` · `info` · `warn` · `error` |
| `msg` | the event, **snake_case**, `<area>_<what happened>` — `payments_refund_create_failed` |
| `service` | always `edge` |
| `fn` | the function serving the request |
| `module` | the shared module that wrote the line, when not the function itself |
| `env`, `version` | `APP_ENV` and the deployed commit |
| `trace_id`, `span_id`, `parent_span_id` | W3C / OpenTelemetry ids |
| `request_id` | also returned as `x-request-id` |
| your data | snake_case keys: `post_id`, `payment_intent_id`, `amount_pence`, `error` |

App events follow the same naming: snake_case `msg`, camelCase prop keys from
the allow-list.

## Levels

- **error** — something failed and someone may need to act. Reaches Sentry and
  telemetry, so name it well.
- **warn** — unexpected but handled: a retry, a fallback, a refused request.
- **info** — a business event: `payments_charge_captured`, `sighting_submit`.
- **debug** — development detail. Off in production.

## What to log

Log at the edges, where the app or a function talks to the outside world:

- **Every payment step**, at info or above — a money path must be
  reconstructable from its lines (and its audit rows).
- **Every failure** — every `catch` either logs or has a comment saying why
  silence is right. Silent catches are how bugs become unfindable.
- **Outcomes, with ids and counts** — `{ post_id, sent: 3 }`, not prose.
- Not inside render functions, loops or per-keystroke handlers.

## Never log

At any level, in any environment, app or server:

- Auth tokens, session objects, API keys, cookies, webhook payloads verbatim.
- **Bank details.** Sort codes and account numbers pass through
  `submit-payout-details` on their way to Stripe. There is no redacting helper
  on purpose: a masked tail is still an account number in a log. Log the
  outcome and the Stripe account id — not the value, its length, or the request
  body. Same for a date of birth and a home address collected with them.
- Stripe **client secrets**, **Account Session secrets** and **Account Link /
  login URLs** — bearer credentials into someone's identity documents.
- Verification document contents, and any **signed URL**.
- **Chat message contents** — log "message sent", never the text.
- **Full plates** — `redactPlate()` → `AB12***`.
- **Precise coordinates** — `redactLocation()` → ~1 km, or an area name.
- **User-authored names** — a watchlist collection name, a vehicle nickname,
  a free-text note. Log the id.
- **Error messages from Stripe**, and any error message in the app's crash
  reports.

Redaction is the backstop, not the licence. Both loggers mask, at any depth up
to 5, any key matching `token · secret · password · authorization · cookie ·
…key · email · phone · iban · account number · sort code · lat · lng ·
latitude · longitude · coord · plate · address · postcode · birth · dob · url
· link · content · nickname · note · body`, and scrub JWTs, Stripe keys and
secrets, Bearer tokens, emails, signed-link tokens and plates out of any text.
A number under a count-shaped key (`…Count`, `…Purged`, `…Sent`, `…Emailed`)
and any `true`/`false`/`null` are kept. The app and server lists are pinned
together by `src/shared/lib/logger.test.ts`.

## Tracing a failure

1. Find the request id. On a dev build it is in `function_call_failed
   { fn, status, request_id }` in Metro, or Profile → copy logs. From a tester's
   phone it is NOT available — bug reports carry event names only — so start
   from the function and the time instead: a 5xx is in telemetry as
   `error_function_call_failed { fn, status }`, and a bug report shows
   `api:function_call_failed` with the time it happened. Search the server logs
   by `fn` and that minute, then take the `request_id` from the line you find.
2. Supabase → Logs (or the Supabase MCP `query_logs`):

   ```sql
   select timestamp, event_message from logs
   where source = 'function_logs'
     and event_message like '%"request_id":"<id>"%'
   order by timestamp
   ```

   Every line of that request — the function's own, its shared modules',
   `request_end` — carries the id. Search by `trace_id` to follow one trace.
3. If it was an `error`, the same request is a Sentry issue tagged
   `request_id`.
4. If money moved, its rows in `audit_payment_events` (by `payment_id`) show
   every change, with the role that made it.

## The ring buffer

The app keeps its last 300 log entries in memory. A bug report carries the last
50 as "Recent activity" — `time level feature:event` only, every data payload
dropped (`src/features/profile/lib/bugBreadcrumbs.ts`, deliberately). The
dev-only "copy logs" action on Profile copies the full entries for
`/diagnose-and-fix-bug`.
