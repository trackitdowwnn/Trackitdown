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
  - A Stripe error's message is never logged, because it can repeat back a rejected bank value. Log its `type`, `code` and `requestId` instead.
- **Never logged:** the list in `docs/LOGGING.md`, which still applies in full.

## Phases

| # | What | Ships by |
|---|---|---|
| 0 | This file | — |
| 1 | Telemetry allow-list, server-side stripping, purge of existing rows. ESLint `no-console` waits: a config-protection hook blocks edits to `eslint.config.js` | migration + OTA |
| 2 | `_shared/log.ts`, `redact.ts`, `handler.ts` on two low-risk functions | deploy |
| 3 | The other 22 functions, in 3 batches | deploy |
| 4 | `audit_payment_events` | migration |
| 5 | Server Sentry + sweep heartbeat (the owner creates the EU org and sets `SENTRY_DSN`) | deploy |
| 6 | App: `traceparent` on function calls, global handlers, root `ErrorBoundary`, OTA id | OTA |
| 7 | `docs/LOGGING.md` rewrite + handover | — |

Each phase is one PR: CI green, merged on the owner's "merge N", deploy verified, and an OTA when the app changed.
