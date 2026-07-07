# Commenting Standards

Goal: anyone — including a future you or a new contributor — can open any
file and know within ten seconds what it does and why it exists.

## 1. Every file starts with a header block

Format (TypeScript/TSX):

```ts
/**
 * WHAT:  Screen where a spotter reports a sighting of a stolen car.
 * WHY:   Sightings are the core loop of the app — this is how spotters
 *        earn bounties and owners get leads.
 * LINKS: Uses useReportSighting (features/sightings/hooks), writes via
 *        features/sightings/api. Safety copy required — see
 *        docs/SECURITY_AND_TRUST.md.
 */
```

- **WHAT** — one plain-English sentence. No jargon.
- **WHY** — why this file exists / what user or business need it serves.
- **LINKS** — what it connects to: key imports, tables, Edge Functions,
  or docs. Omit if genuinely nothing worth noting.

SQL migrations and Edge Functions get the same header using `--` or `//`.

## 2. Exported functions, hooks, and components get JSDoc

```ts
/**
 * Releases an escrowed bounty after the owner credits a sighting.
 * Splits 95% to the spotter and 5% platform fee via Stripe Connect.
 *
 * @param postId - The recovered post. Must be in `recovery_claimed` state.
 * @param sightingId - The credited sighting. Must belong to `postId`.
 * @throws If the spotter has not completed Stripe onboarding.
 */
```

Document behaviour and constraints, not types (TypeScript already shows
types). Always document thrown errors and required prior state.

## 3. Inline comments explain WHY, not WHAT

```ts
// BAD:  increment the counter
count += 1;

// GOOD: Stripe webhooks can arrive twice for one event; dedupe on event id
if (seenEvents.has(event.id)) return;
```

Comment anything non-obvious: workarounds, ordering requirements, security
decisions, PostGIS query intent, and every place money is touched.

## 4. Special markers

- `// TODO(name): …` — must include an owner and ideally an issue link.
- `// SAFETY: …` — marks code enforcing a rule from SECURITY_AND_TRUST.md.
  Never delete code carrying this marker without reading that doc.
- `// MONEY: …` — marks any line involved in charging, refunding, or
  paying out. These lines require test coverage.

## 5. Keep comments honest

A wrong comment is worse than none. Whenever behaviour changes, update the
header and JSDoc in the same commit. The code-reviewer subagent checks this.
