# Logging Standard

One rule above all: **never call `console.log` directly in app code.**
Always use the shared logger (`src/shared/lib/logger.ts`). Raw console
calls are unstructured, untaggable, unredacted, and get left behind as
noise. An ESLint `no-console` rule enforces this (logger.ts is the one
exemption).

## Why structured logging matters here

1. **Human readability** — every log line has the same shape, so you can
   scan the Metro terminal and instantly see which feature did what.
2. **AI readability** — Claude Code debugs from logs. Consistent,
   feature-tagged, single-line entries let it reconstruct what the app
   did. This is a core input to `/diagnose-and-fix-bug`.
3. **Privacy** — a central logger is the one place redaction can be
   enforced. Scattered console.logs leak personal data.

## The format

```
🐛 DEBUG [feature] message { data }
ℹ️ INFO  [feature] message { data }
⚠️ WARN  [feature] message { data }
🔴 ERROR [feature] message { data }
```

Emoji + level render reliably in Metro, device logs, and CI output —
that's the "colour coding" (true ANSI colour is terminal-dependent, so
emoji is the portable version; in the Chrome/React Native DevTools
console the levels also get the browser's native warn/error colouring).

## Levels — when to use which

- **debug** — developer detail (state transitions, cache hits). Stripped
  in production builds.
- **info** — notable app events: screen opened, post submitted, sighting
  reported, notification received.
- **warn** — recoverable oddities: retry needed, slow response (>3s),
  validation rejection, empty result where one was expected.
- **error** — something failed: API error, payment failure, crash-adjacent
  states. In production these forward to Sentry (once wired in Phase 5).

## What to log (boundaries, not noise)

Log at the edges, where the app talks to the outside world:

- **Every Supabase call** in feature `api/` files: operation start
  (debug), success with duration (debug/info), failure with code (error).
- **Every Edge Function invocation** from the app: called, succeeded,
  failed. Inside Edge Functions, use the same message convention with
  `console.log` (Deno — visible in Supabase dashboard/CLI logs).
- **Every payment step** — always, at info or above. Money paths must be
  reconstructable from logs alone.
- **Navigation between features** (info) and push notifications
  received/handled (info).
- **Caught errors** — every catch block either logs at error or has a
  comment explaining why silence is correct. Silent catch blocks are how
  bugs become unfindable.

Do NOT log inside render functions, loops, or per-keystroke handlers.

## Privacy rules (non-negotiable — see SECURITY_AND_TRUST.md)

NEVER log, at any level, in any environment:

- Auth tokens, session objects, API keys, webhook payloads verbatim
- Verification document contents or their signed URLs
- Chat message contents (log the event "message sent", never the text)
- Full number plates — use the logger's `redactPlate()` → `AB12***`
- Precise coordinates — use `redactLocation()` → 2-decimal rounding
  (~1km) or an area name. Exact locations live in the database, not logs.

The logger's data serialiser also auto-masks any key named `token`,
`password`, `secret`, `authorization`, or `key` as a safety net — but
that net is a backstop, not permission to be careless.

## Feature tags

Each feature creates one child logger at the top of its api/hooks files:

```ts
import { createLogger } from "@/shared/lib/logger";
const log = createLogger("sightings");

log.info("Sighting submitted", { postId, hasPhoto: true, durationMs });
```

Tags match feature folder names (`auth`, `vehicles`, `sightings`,
`search-map`, `notifications`, `payments`, `chat`, `profile`,
`moderation`) plus `app` for app-level events.

## The ring buffer (device debugging)

The logger keeps the last 300 entries in memory. A dev-only action
(built in Phase 1's profile/settings screen) copies them to the
clipboard so device-only issues can be pasted straight into
`/diagnose-and-fix-bug`. The buffer is also inspectable in tests.

## Production behaviour

- `debug` is dropped entirely (guarded by `__DEV__`).
- `error` (and optionally `warn`) forward to Sentry via the logger's
  pluggable sink — wired in Phase 5 by adding a sink, with zero changes
  to call sites. This is why nothing should ever import Sentry directly
  except the sink.
