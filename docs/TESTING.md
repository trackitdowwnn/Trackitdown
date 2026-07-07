# Testing Standards

Testing philosophy: an AI writes most of this code quickly — tests are how
we keep it honest. Coverage is tiered: some things MUST be tested, some
should be, some are optional.

## Tier 1 — MUST be tested (blocks merge)

- **Every `// MONEY:` line's behaviour**: escrow charge on posting, the
  95/5 payout split, refund paths (cancelled / expired / rejected /
  recovered_no_spotter), webhook signature rejection, webhook event
  dedupe/idempotency, pence-integer arithmetic (no floats sneaking in).
- **Post lifecycle transitions** (see `docs/DOMAIN.md`): every allowed
  transition succeeds; every disallowed one is rejected server-side
  (e.g. payout on a post not in `recovery_claimed`, activating a post
  that never passed verification).
- **Bounty validation**: min £50 / max £5,000 enforced server-side.
- **Sighting rate limit**: 4th sighting on the same post in a day is
  rejected.
- **`// SAFETY:` code**: e.g. sighting flows render SafetyNotice; posts
  in non-active states are not returned by public queries.

## Tier 2 — SHOULD be tested

- Shared lib utilities: UK plate validation, money formatter, distance
  formatting.
- Feature API layers and hooks: success, Supabase error, and empty
  responses (mock the Supabase client).
- Screen states: loading skeleton, empty state, error state, populated.
- Notification radius query logic (PostGIS `ST_DWithin` behaviour can be
  tested against local Supabase in integration tests).

## Tier 3 — nice to have

- Pure presentational component snapshots (sparingly — behaviour over
  snapshots), animation/motion details, exhaustive prop permutations.

## Conventions

- **Stack**: Jest + `jest-expo` preset; React Native Testing Library for
  components/screens; Edge Functions tested with the Supabase CLI local
  stack (`npx supabase start`) or unit-tested with mocked clients.
- **Location**: tests live next to the code (`releasePayout.test.ts`
  beside `releasePayout.ts`). Integration tests that need the local
  Supabase stack live in `supabase/tests/`.
- **Style**: test behaviour, not implementation. Names read as sentences:
  `it("refunds the owner when the post expires with no credited sighting")`.
- **Headers**: test files get the WHAT/WHY/LINKS header like any file.
- **Mocks**: mock at the boundary (Supabase client, Stripe SDK, Expo
  Notifications). Never mock our own domain functions to force a pass.
- **CI**: `npm test` runs in CI on every push (see
  `.github/workflows/ci.yml`). A red Tier 1 test is never skipped or
  `.todo`'d to get a merge through.

## Stack gotchas (this project's versions)

- **`render()` is async.** React Native Testing Library 14 on React 19
  returns a Promise from `render` — you MUST `await` it:
  `const { getByText } = await render(<Foo />);` (and make the test `async`).
  A synchronous `render(...)` silently yields an empty object and every
  query throws `is not a function` / "render function has not been called".
  Prefer the queries returned by `render` over the global `screen`.
- **Jest globals need types.** `describe`/`it`/`expect` are typed via
  `@types/jest`, opted in through `"types": ["jest", "react"]` in
  `tsconfig.json`. `tsc` will error on test files if that's missing.

## For Claude Code specifically

When the test-writer subagent (or anyone) adds tests: run the suite,
fix failures you introduced, and never weaken production code to make a
test pass. If a test exposes a real bug, keep the failing test, report
the bug, and fix the code.
