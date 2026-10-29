# Logging decisions

The owner agreed these decisions on 2026-10-28, after a discovery audit and a stakeholder interview. They are the design that every logging change is checked against. To change one, update this file in the same PR.

## The four decisions

1. **Where logs go: Supabase function logs plus Sentry's free tier, EU region.**
   - Edge functions write one JSON line per entry to stdout, which Supabase already collects.
   - Sentry receives server errors now, plus the app's crashes once the next native build ships (`@sentry/react-native` has native code, so it can't go by OTA).
   - No log drain and no paid log platform.
   - Supabase's own log retention depends on the plan, so anything that must last goes in the audit table or Sentry.
2. **The money audit trail is evidence, kept 6 years.**
   - Table `audit_payment_events`, written by a trigger on `payments` in the same transaction as each change.
   - Append-only: no API role can write to it, and an UPDATE or DELETE raises an error.
   - Holds IDs, amounts and statuses only; no user IDs, names or locations.
   - Kept 6 years, for HMRC financial records, on a legal-obligation basis.
   - Not a log stream: a log line can be lost, an audit row cannot.
3. **Telemetry carries no user IDs, no post IDs, and no coordinates.**
   - **App:** the telemetry sink sends only keys on an allow-list (`TELEMETRY_KEYS` in `src/shared/lib/telemetry.ts`).
   - **App and server:** both drop any string value that contains a UUID or looks like a coordinate.
   - **Server:** the database strips identifier and location keys itself, so an app that hasn't taken the OTA can't put them back.
   - To debug a specific case, use the bug-report flow (the user sends it).
4. **Scope: risks first.**
   - **Built now:**
     - the telemetry allow-list;
     - a server logger with request context and a top-level catch;
     - the audit table;
     - crash and uncaught-error capture;
     - a heartbeat that alerts when the hourly sweep stops.
   - **Later:** the OpenTelemetry SDK and exporters, a separate log transport, and dashboards.
   - Trace IDs use the W3C `traceparent` format from day one, so the later work needs no migration.

## Conventions

- **Levels:**
  - `error`: something failed and someone may need to act.
  - `warn`: unexpected but handled, or a retry.
  - `info`: a business event, named in snake_case.
  - `debug`: development detail, never sent anywhere.
- **Server fields:** `ts` (UTC ISO), `level`, `msg`, `service: "edge"`, `fn`, `env`, `version`, `trace_id`, `span_id`, `parent_span_id` (when the caller sent a `traceparent`), `request_id`, then the entry's own data in snake_case (`user_id`, `export_id`). Responses carry the same `x-request-id`.
- **Server settings:** level from the `LOG_LEVEL` secret (default `info`); version from `RELEASE`, set to the git SHA on deploy; `APP_ENV` (default `production`, `development` prints readable lines instead of JSON); `LOG_REDACT_KEYS`, extra key names to mask.
- **App settings:** level from `EXPO_PUBLIC_LOG_LEVEL` (default `debug` in dev, `info` in release).
- **Redaction:**
  - Key names are checked at any depth up to 5 levels, and value patterns are masked too: JWTs, Stripe keys and client secrets, Bearer tokens, emails.
  - A number under a count-shaped key (`…Count`, `…Purged`, `…Sent`, `…Emailed`, `…Removed`, `…Skipped`, `…Total`) is kept, so `pushTokensPurged: 3` survives; text under such a key is still masked. `true`, `false` and `null` are never masked: they can't hold a value.
  - A Stripe error's message is never logged, because it can repeat back a rejected bank value. Log its `type`, `code` and `requestId` instead.
- **Never logged:** the list in `docs/LOGGING.md`, which still applies in full.

## Phases

| # | What | Ships by | Status |
|---|---|---|---|
| 0 | This file | — | #304 |
| 1 | Telemetry allow-list, server-side stripping, purge of existing rows. ESLint `no-console` waits: a config-protection hook blocks edits to `eslint.config.js` | migration + OTA | #304, OTA b9475423 — prod: 0 of 5,916 rows carry an id |
| 2 | `_shared/log.ts`, `redact.ts`, `handler.ts` on two low-risk functions | deploy | #305 — AsyncLocalStorage confirmed in prod |
| 3 | The other 22 functions, in 3 batches | deploy | #306 money, #307 notifications, #308 account; #307/#309 fixed over-masked counts and flags |
| 4 | `audit_payment_events` | migration | #310 — 10 baseline rows in prod |
| 5 | Server Sentry + sweep heartbeat (the owner creates the EU org and sets `SENTRY_DSN`). Every error-level line and every uncaught throw becomes a Sentry event; inert until the DSN exists | deploy | #311, OTA 59b3fd5b (privacy policy) — waiting on `SENTRY_DSN` |
| 6 | App: `traceparent` on function calls, global handlers, root `ErrorBoundary`, OTA id | OTA | #312 |
| 7 | `docs/LOGGING.md` rewrite + handover | — | #313 |

Each phase is one PR: CI green, merged on the owner's "merge N", deploy verified, and an OTA when the app changed.

## Handover (2026-10-29)

**Done.**
- Every Edge Function logs one JSON line per event. Each line carries version, trace, span and request ids; errors go through redaction; a crash returns a clean 500; every response carries `x-request-id`.
- No raw `console` call is left on the server.
- Every money change is kept as evidence for 6 years.
- Telemetry can no longer carry an identifier or a place.
- Server errors and the hourly sweep are wired to Sentry.
- Once #312 ships: the app traces its function calls and reports its crashes.

**Owner actions still open.**
1. Create the Sentry project (EU region, Deno platform) and set `SENTRY_DSN` (`supabase/functions/README.md`). Then check that a sweep shows up as a check-in, and that the cron monitor and "new issue" alerts email you.
2. Merge #312, and publish its OTA. Device check: a forced crash shows "Something went wrong", and `error_app_crash` appears in `telemetry_events`.
3. Decide on the ESLint `no-console` rule: switch the config-protection hook off for one edit, or leave it as a convention.
4. Decide whether `function_call_failed`'s `request_id` may travel in a bug report's breadcrumbs. Today they carry event names only, by design (`bugBreadcrumbs.ts`), so a tester's failure is matched by function and time instead.

**Recommended next.**
- **Alerts:**
  - A Sentry issue alert: email on every new issue.
  - A spike alert that protects the free tier's 5,000 errors a month.
  - The cron monitor on `release-held-refunds`, created by its first check-in. Give it a 10-minute margin.
  - A heartbeat for any new scheduled function, via `startCronCheckIn`.
- **Dashboards.** Start with saved queries before any tool:
  - 5xx `request_end` by `fn` per hour, from the Supabase logs.
  - `payments_*` errors per day, from the Supabase logs.
  - `error_app_crash` by `ota` and `error_function_call_failed` by `fn`, from `telemetry_events`.
  - A payment's trail from `audit_payment_events`.
  - Move to a hosted dashboard only once those prove they're read.
- **App Sentry.** `@sentry/react-native`, with EAS source maps, at the next native build. It catches native crashes too, and replaces `crashReporting.ts`'s telemetry route.
- **Later, as decided.**
  - The OpenTelemetry SDK and exporters: the ids are already W3C, so nothing needs migrating.
  - A log drain, if Supabase's retention proves too short.
  - The audit table's purge job: nothing can be old enough to purge until 2032.
