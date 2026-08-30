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
- **Bank details.** Sort codes and account numbers pass through
  `submit-payout-details` on their way to Stripe (2026-08-03). There is no
  redacting helper for these on purpose: a masked tail is still an account
  number in a log, so the rule is nothing at all — not the value, not its
  length, not the request body that carried it. Log the outcome and the Stripe
  account id. Same for a date of birth and a home address collected with them.
- Stripe **Account Session client secrets** and **Account Link URLs** — bearer
  credentials into someone's identity documents
- Verification document contents or their signed URLs
- Chat message contents (log the event "message sent", never the text)
- Full number plates — use the logger's `redactPlate()` → `AB12***`
- Precise coordinates — use `redactLocation()` → 2-decimal rounding
  (~1km) or an area name. Exact locations live in the database, not logs.
- **User-authored names.** A watchlist collection name ("Mum's street") and a
  saved vehicle's nickname are free text the user wrote for themselves — log
  the id, never the name. Both are private user metadata under DOMAIN.md; a
  name in a log is the one place it could escape the owner's own session.

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
`moderation`, `watchlist`, `garage`) plus `app` for app-level events.

Watchlist collections emit `collection_create` / `collection_rename` /
`collection_delete` / `collection_view`, `watch_move { postId, toId }`, and
`watch_collection_fallback` (a save aimed at a list that had been deleted, and
landed in Saved instead). **Ids only** — see the name rule above.

## The ring buffer (device debugging)

The logger keeps the last 300 entries in memory. A dev-only action
(built in Phase 1's profile/settings screen) copies them to the
clipboard so device-only issues can be pasted straight into
`/diagnose-and-fix-bug`. The buffer is also inspectable in tests.

## Production behaviour

- `debug` is dropped entirely (guarded by `__DEV__`).
- **A sink is registered** (`src/shared/lib/telemetry.ts`, since 2026-08-30),
  and it sends two things to `public.telemetry_events`: every `error`, and
  every `info` whose message is a **snake_case event name**. Nothing else
  leaves the device — `warn` and prose `info` stay in the console and the ring
  buffer.

  ⚠️ **That convention is now load-bearing.** `log.info('feed_load', …)` is an
  event and is recorded; `log.info('Sighting submitted', …)` is prose and is
  not. Both were previously identical in effect, so this is a new rule rather
  than a documented one — if you want a new log line counted, name it
  `snake_case`.

  ⚠️ **`data` is filtered before it is sent.** Scalars only, at most 8 keys,
  strings truncated at 200 characters, and keys matching
  `lat|lng|coord|plate|email|phone|address|postcode|token|secret|password` are
  dropped outright. On a stolen-car app a coordinate or a plate must never
  leave the device. This is a backstop, not a licence — the rule in the privacy
  section still stands: do not log the value in the first place.

  ⚠️ **Never call the logger from the sink**, or from anything the sink calls
  during a flush. It is invoked *by* `emit`, so one log line in a failure path
  is an infinite loop. `telemetry.ts` refuses its own feature tag as a second
  belt, but the first rule is simply not to log there.
- Sentry is still unwired, and remains the right answer for **crashes** — a
  different job, because the process is gone before a flush can run. When it
  lands it is a second sink, and nothing should ever import Sentry directly
  except that sink.
