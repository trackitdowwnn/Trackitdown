# Testing Standards

Testing philosophy: an AI writes most of this code quickly — tests are how
we keep it honest. Coverage is tiered: some things MUST be tested, some
should be, some are optional.

**The coverage floor** (added 2026-09-02, review finding #32): CI ran
`--coverage` from the start and threw the result away — no `coverageThreshold`,
no `collectCoverageFrom`, so nothing could fail on it and a file with no tests
at all was invisible to the number. Both are now set in `package.json`, over
all of `src/`. The floors are a **ratchet** parked just under the real figures
(statements 75, branches 68, functions 71, lines 76 against 76.9 / 70.4 / 73.0
/ 77.8). Raise them when coverage rises. Lowering one to go green is the move
this paragraph exists to make visible.

## Tier 1 — MUST be tested (blocks merge)

- **Every `// MONEY:` line's behaviour**: escrow charge on posting, the
  95/5 payout split, refund paths (cancelled / expired / rejected /
  recovered_no_spotter), webhook signature rejection, webhook event
  dedupe/idempotency, pence-integer arithmetic (no floats sneaking in).
- **Post lifecycle transitions** (see `docs/DOMAIN.md`): every allowed
  transition succeeds; every disallowed one is rejected server-side
  (e.g. payout on a post not in `recovery_claimed`, activating a post
  that never passed verification).
- **Bounty validation**: min **£10** / max £5,000 enforced server-side.
  (This line said £50 until 2026-09-02, nineteen days after the floor moved
  — the same drift it warns about below, in the document that warns about
  it. The numbers live in `src/features/vehicles/post/lib/bountyBounds.ts`
  and `posts_bounty_amount_pence_check`; `bountyBounds.test.ts` fails if
  the two stop agreeing.)
- **Sighting rate limit**: 4th sighting on the same post in a day is
  rejected.
- **`// SAFETY:` code**: e.g. sighting flows render SafetyNotice; posts
  in non-active states are not returned by public queries.
- **Alert-zone approximate snapping**: with the approximate toggle on, the
  point STORED must never be the exact point the user picked. The snap
  happens server-side before the insert, so the test asserts the stored value
  differs from the input — and is still close enough to keep matching.
- **Push payload contents**: a push crosses third-party infrastructure, so
  the ABSENCE assertions are the point — no plate, no coordinates, no message
  content, and the don't-approach clause always present. Asserted on both
  sides: `pushPayload.test.ts` (the client's strict schema refuses a widened
  payload) and `supabase/tests/alerts_verification.sql` (the bodies are built
  in SQL precisely so they are testable there).

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
- **⚠️ Mocks must `jest.requireActual` shared constants, never retype them.**
  A module is usually mocked to keep the native graph out of a suite, and it is
  tempting to inline the two or three constants it also exports. Do not: on
  2026-08-23 a mock said `MIN_BOUNTY_PENCE: 5000` and the suite asserted that
  £49.99 was refused — against a floor the app had enforced as £10 since
  2026-08-13. It passed for ten days, and the floor could have gone back to £50
  with nothing failing. Spread the real leaf instead
  (`...jest.requireActual('../lib/bountyBounds')`), and if the constant is
  trapped in the heavy module, move it to a leaf. **A test that invents the
  number it checks is guarding nothing.**
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
- **`npm run test:db`** runs every `supabase/tests/*_verification.sql` suite
  against a freshly reset LOCAL database. Prerequisite is Docker Desktop +
  `npx supabase start` — **not** a Postgres client install: the script uses
  host `psql` when it is on PATH and otherwise pipes each suite through the
  `supabase_db_<project_id>` container's own psql, which is the normal path on
  Windows. Setting `DATABASE_URL` without host psql is a hard error rather
  than a silent run against the wrong server. Never point this at a remote —
  it begins with `supabase db reset`.
  - Suites are silent on success by design (some print no notices at all —
    `refund_hold_verification.sql` has 39 assertions and zero output). The
    signal is the EXIT CODE: each file `raise`s on violation and
    `psql -v ON_ERROR_STOP=1` turns that into exit 3, which aborts the run.
    Counting "passed" lines undercounts the suites badly.

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
