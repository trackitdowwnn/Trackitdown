# Build Plan

The phased path from empty repo to v1 launch. Tick items off as they're
completed — `/catch-up` reads this file to brief on progress. Detailed
feature scope lives in `docs/ROADMAP.md`; this is the *order of work*.

> **Marks:** `[x]` done · `[ ]` not started · `[~]` **partly done — the line
> says what is built and what is not.** Audited against the codebase
> 2026-08-01: Phases 0–3 were almost entirely unticked while being almost
> entirely built, which made the remaining work look enormous. It is not —
> the loop is one feature short. Items struck through are RESOLVED (removed by
> a decision), not delivered; they are ticked so they stop reading as debt.

## Phase 0 — Foundations

- [x] Tools installed (Node LTS, Git, VS Code, Claude Code, jq)
- [x] Expo project created, runs on a real phone — **via a DEV BUILD, not
      Expo Go.** Expo Go cannot run this app: react-native-maps, Google
      sign-in and expo-dev-client all need a custom build. Corrected
      2026-08-01; the original line was never achievable.
- [x] Starter kit copied in; lint / typecheck / test scripts pass
- [x] Git repo created on GitHub, first push, CI green
- [x] Supabase dev + prod projects created; dev linked; `.env` from
      `.env.example`
      - [x] Supabase CLI installed (dev-dependency); `supabase init` done
      - [x] Dev project (`lbbbxelbembseohxjhkv`, eu-west-1) linked
      - [x] Prod project — stood up; migrations pushed with `supabase db push`
            (most recently the default-privilege revoke, 2026-08-01)
      - [x] `.env` created from `.env.example` (public Supabase URL + anon key)
- [ ] Stripe account in test mode; keys in `.env` / Edge Function secrets
      - [x] Stripe CLI installed; `.env` scaffolded (public keys only)
      - [ ] Stripe account (test mode) + Connect **Express** enabled — you
      - [ ] `pk_test` in `.env`; `sk_test` in Supabase secrets — you
      - [ ] Webhook endpoint + `whsec` — deferred until the `stripe-webhook`
            Edge Function exists (local testing uses `stripe listen`)
- [x] Claude Code first prompts run: folder scaffold, theme + core
      components, initial migration (shared/theme + ~50 shared/ui components)
- [ ] Import-boundary ESLint rules configured (prompt in CLAUDE.md notes).
      **Genuinely not done** — no `no-restricted-imports` or
      `import/no-restricted-paths` rule exists. ARCHITECTURE.md's rule 1
      (features must not import each other cyclically) is enforced by review
      and by comments alone; the HomeFeedScreen/garage/profile cycle note is
      the kind of thing a lint rule would catch for free.

## Phase 1 — Auth & posting (owner side)

- [x] Sign up / sign in (email + Apple/Google), session handling
- [~] Onboarding: alert radius + location permission flow. The 4-slide
      onboarding and the location-permission flow are BUILT
      (features/permissions, fired from AuthGate right after onboarding).
      The alert-radius step is NOT in onboarding and never was — see the
      matching ROADMAP line; it lives in the Alerts wizard instead.
- [x] Post-a-car stepper: details → photos → last seen → bounty
- [ ] ~~DVLA Vehicle Enquiry API: plate → make/model/colour auto-fill~~
      **Moved to the garage** — the post wizard no longer collects a plate
      (2026-07-24), so there is nothing here to auto-fill. See ROADMAP.
- [x] ~~V5C verification upload to private bucket~~ **REMOVED by ADR-0007**
      (live-on-payment). Not built, and deliberately never will be in v1 —
      ticked as *resolved*, not as *done*.
- [x] ~~Manual verification flip (moderator dashboard comes in Phase 4)~~
      **REMOVED by ADR-0007** — `pending_verification` is dormant, so there is
      nothing to flip. Resolved, not done.

## Phase 2 — Payments (deliberately early — highest-risk integration)

- [x] Stripe PaymentSheet: escrow charge at posting (`src/features/payments` +
      `create-payment-intent` Edge Function; captures immediately, server-read
      amount, idempotent per post; **`draft → active` on success** — this said
      `draft → pending_verification` until 2026-08-03, describing the
      pre-publish gate ADR-0007 removed on 2026-07-30)
- [x] stripe-webhook Edge Function (signature check, dedupe, idempotent)
- [~] Refund paths: **cancelled is DONE** (`deactivate-post` +
      `mark_post_payment_refunded`, withholding the authoritative Stripe fee).
      `expired` / `rejected` / `recovered_no_spotter` have no refund path —
      and the last of those is unreachable anyway until the recovery flow
      exists (Phase 3).
- [~] Tier 1 money tests green (docs/TESTING.md) — charge slice green
      (`post_payment_verification.sql` + client tests) **and refund green**
      (`refund_cancel_verification.sql`, in CI's db job). Only PAYOUT tests
      remain, and only because there is no payout code to test.
- [~] Milestone: a test-mode pound goes in and comes back out correctly
      — **goes in** works (gated on Stripe setup: `supabase/functions/README.md`);
      **comes back out** works for a REFUND (cancel a listing) but not yet for
      a PAYOUT, which waits on `release-payout` and the recovery flow.

## Phase 3 — Core loop (spotter side)

- [x] Map + list search of active posts, distance sorting
- [x] notify-spotters Edge Function (PostGIS radius query → push) — plus the
      whole push substrate it needed: push_tokens, one shared send utility,
      receipt processing with dead-token pruning, tap routing incl. cold
      start, and multi-alert zones with criteria matching
      (`alerts_verification.sql`, 45 checks)
- [x] Sighting flow: in-app camera, auto GPS, note, SafetyNotice
- [x] Owner ↔ spotter chat (opens only after a sighting)
- [x] Recovery confirmation: owner credits one sighting (or none).
      **BUILT 2026-08-02.** `claim_recovery` + `mark_recovered_no_spotter` +
      `RecoverPostScreen`. This line said "THE ONE THING THAT CLOSES THE LOOP,
      AND IT IS NOT BUILT" until 2026-08-03, a day after it shipped.
- [~] Spotter Stripe Connect onboarding + release-payout (95/5).
      `release-payout` is **BUILT** (`20260802220000_release_payout.sql` +
      the Edge Function). Two things remain, and neither is the hard part:
      - [ ] **Call it.** `RecoverPostScreen.tsx` toasts "we'll get the bounty
            to them" on the payout branch and invokes nothing. Until this is
            wired the post is stranded in `recovery_claimed` — which also
            blocks the owner's account deletion, permanently.
      - [ ] **Connect onboarding**, so there is a payee. Needs an account-link
            Edge Function and the UI behind `PAYOUTS_ENABLED`. ⚠️ Also needs
            Stripe Connect ENABLED on the platform account — see the unticked
            Phase 0 Stripe lines, still marked "— you".
- [ ] Milestone: full journey on two phones with two test accounts — now
      blocked only on the two boxes above. Everything up to and including
      "owner credits a spotter" runs; the money is the last inch.

## Phase 4 — Trust layer & polish

- [ ] Moderator dashboard: flags, disputes, collusion queues. (The
      *verification* queue is obsolete — ADR-0007 removed pre-publish
      verification. Nothing moderator-facing exists at all.)
- [~] Flagging + user blocking. **Post flagging is DONE** (`flag_post`,
      flagApi, `post_flags_verification.sql`). Sightings, photos and messages
      have no flag path; user blocking does not exist in any form.
- [~] Reputation counters + badges — counters and badge maths BUILT and
      server-maintained; `recoveries_credited` is stuck at 0 until the
      recovery flow lands.
- [ ] Account deletion (Apple/Google requirement + UK GDPR erasure) — BUILT
      2026-08-01, PR #37, not yet merged. Was missing from this plan entirely
      despite the client shipping a Delete account button on 2026-07-10.
- [ ] Empty/error/loading states everywhere; ui-reviewer design pass

## Phase 5 — Pre-launch

- [ ] Legal review of escrow model; T&Cs; privacy policy; safety page
- [ ] Sentry + analytics wired
- [ ] EAS production builds; TestFlight / internal testing track
- [ ] Beta: 10–20 testers in one launch city; fix top confusions
- [ ] Store listings: "information reward" framing, moderation
      commitment, demo account for review
- [ ] Cold-start plan executed: launch city communities, bounty optional

## Working habits (every phase)

- Plan Mode for anything touching DOMAIN.md (payments, lifecycle)
- End every session with `/create-commit`
- `/tidy` weekly
- Update docs (+ ADR for big calls) in the same session as the change
