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
>
> ⛔ **Reconciled 2026-09-25 after 51 days untouched.** This file was last edited
> on 2026-08-05 and had drifted: user blocking, My reports and the telemetry
> sink all read as unbuilt weeks after they shipped. **The current plan lives in
> ROADMAP.md, "The 2026-09-25 product review"**: a feature freeze, a seven-item
> path to the beta, and a pre-submission checklist. That review also decided
> ROADMAP becomes the single status document, and this file becomes the order
> of work with no status marks of its own. That rewrite is a `/tidy` job. Until
> it happens, the marks below are corrected against the code as of 2026-09-25.

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
- [~] Stripe account in test mode; keys in `.env` / Edge Function secrets.
      **Evidently done** (corrected 2026-09-25): the escrow and £5-fee charges
      have run end to end in test mode (ADR-0014's correction records the day
      fees stopped charging and the fix). The ONE sub-item still unconfirmed is
      the one that fails silently: `account.updated` enabled by hand on the
      webhook endpoint. That is ROADMAP path item 1.
      - [x] Stripe CLI installed; `.env` scaffolded (public keys only)
      - [x] Stripe account (test mode) + Connect **Express** enabled
      - [x] `pk_test` in `.env`; `sk_test` in Supabase secrets
      - [~] Webhook endpoint + `whsec` — `stripe-webhook` handles charges,
            refunds AND `account.updated` (which auto-releases payouts when a
            spotter becomes payable). **What is unconfirmed is the event
            subscription on the Stripe dashboard endpoint**, which is not a
            default
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
- [x] Onboarding: ~~alert radius +~~ location permission flow. The 4-slide
      onboarding and the location-permission flow are BUILT
      (features/permissions, fired from AuthGate right after onboarding).
      The alert-radius step was STRUCK by the 2026-09-25 review, not delivered —
      it lives in the Alerts wizard, and see the matching ROADMAP line.
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
- [x] Refund paths: **cancelled** (`deactivate-post` +
      `mark_post_payment_refunded`, withholding the authoritative Stripe fee)
      and **`recovered_no_spotter`** (`refund-recovery`, behind the refund hold
      and dispute window of ADR-0011, released by `release-held-refunds`).
      `expired` / `rejected` are RETIRED statuses that nothing sets, so they
      need no path. Corrected 2026-09-25; this line said the recovery refund
      was unreachable.
- [~] Tier 1 money tests green (docs/TESTING.md) — charge
      (`post_payment_verification.sql`, `listing_fee_verification.sql`,
      `fee_collected_verification.sql`), refund
      (`refund_cancel_verification.sql`, `refund_hold_verification.sql`) and
      the payout's SQL half (`recovery_verification.sql` — `mark_recovery_paid`
      re-derives the 95/5 split) are all in CI's db job. **Still untested:**
      the Edge Function half — `_shared/releasePayout.ts` and
      `_shared/collusion.ts` have no unit tests. Corrected 2026-09-25; this
      line said there was no payout code to test.
- [~] Milestone: a test-mode pound goes in and comes back out correctly
      — **goes in** works; **comes back out** works for a REFUND. A PAYOUT is
      fully built but has **never been walked** end to end: that is ROADMAP
      path item 6, and it depends on `account.updated` (path item 1).

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
- [x] Spotter Stripe Connect onboarding + release-payout (95/5).
      **DONE 2026-08-03.** Both boxes that stood here are closed:
      - [x] **Call it.** Invoked from `RecoverPostScreen` on the payout branch,
            and again from the post's manage sheet ("Send the bounty") for the
            usual case where the spotter has not yet onboarded.
      - [x] **Connect onboarding.** `connect-onboarding` (Account Session),
            `submit-payout-details` (our own native form, inside Stripe's
            prefill window), `connect-return`, and `account.updated` in
            `stripe-webhook`. UI at Profile → Payouts.
      ⚠️ `account.updated` must be enabled BY HAND on the Stripe webhook
      endpoint; it is not a default, and without it no spotter ever becomes
      payable and nothing errors.
- [x] **Collusion check before payout** — BUILT 2026-08-03
      (`20260803140000_payout_collusion_check.sql` + `_shared/collusion.ts` in
      `release-payout`). Shared-device / shared-card / matching-email →
      `held_for_review`, manual resolution in the console. This was the
      prerequisite for auto-release (ADR-0010): a webhook that moves money now
      has a gate in front of it.
- [~] Milestone: full journey on two phones with two test accounts. Everything
      through "owner credits a spotter" and on to a transfer now runs. Not yet
      walked end to end on two devices, and the escrow PaymentSheet wants a
      re-test after the Stripe SDK bump (0.64.0 → 0.72.0). **This is ROADMAP
      path item 6 (2026-09-25),** and it now has to cover both pricing modes.
      ⚠️ **One known hole, verified 2026-09-25:** a credited spotter who never
      finishes payout onboarding leaves the post in `recovery_claimed`
      indefinitely. Nothing reminds them, and the owner cannot delete their
      account. ROADMAP path item 4 has the minimum fix.

## Phase 4 — Trust layer & polish

- [ ] Moderator dashboard: flags, disputes, collusion queues. (The
      *verification* queue is obsolete — ADR-0007 removed pre-publish
      verification. Nothing moderator-facing exists at all.) **Deferred
      2026-09-25** behind a daily operator digest email — see ROADMAP's
      pre-submission checklist.
- [x] Flagging + user blocking. **Post flagging** (`flag_post`, flagApi,
      `post_flags_verification.sql`), **message flagging** (`flag_message` +
      the thread's long-press report sheet) and **user blocking** (ADR-0017,
      shipped 2026-09-01) are all DONE. Corrected 2026-09-25; this line said
      blocking "does not exist in any form" for 24 days after it shipped.
      ~~Flagging sightings and photos~~ is DEFERRED rather than missing: guideline
      1.2's report + block is met without it (ROADMAP's Flagging line).
- [x] Reputation counters + badges — counters and badge maths BUILT and
      server-maintained. `recoveries_credited` moves when the owner credits a
      sighting (`claim_recovery`), in BOTH pricing modes — on a free listing
      the credit is the spotter's whole reward. Corrected 2026-09-25; this line
      said the counter was stuck until the recovery flow landed (2026-08-02).
- [x] Account deletion (Apple/Google requirement + UK GDPR erasure). **Both
      halves are in the tree** — `supabase/functions/delete-account`, invoked
      by `profileApi.requestAccountDeletion`. Corrected 2026-08-05; this line
      still said "PR #37, not yet merged".
- [~] Empty/error/loading states everywhere; ui-reviewer design pass.
      Explore, profile, post detail, inbox and chat have had passes. **Five
      screens have had none: sightings, the alerts wizard, payouts, my-posts,
      recover-post.** The 2026-08-05 review's call: do NOT sweep all five
      before the beta. Testers will point at the two that matter, and passes
      on screens nobody has used are the unfalsifiable work a no-deadline
      project fills up with.
      **2026-09-25:** that call was not followed. Since then, the map, the
      theft-stats page, area insights and the inbox rows took about 70 commits
      of design work, and four of the five screens above still have had no pass
      (my-posts got its archive and press-and-hold work on 09-24). No more
      passes until after the beta, under ROADMAP's feature freeze. After it,
      the first two go to the money screens, `payouts` and `recover-post`.

## Phase 4.5 — Beta, 2026-08-26 (inserted by the 2026-08-05 product review)

Split out of Phase 5 because the review found the beta does not depend on most
of it. **Run the beta on Stripe TEST MODE** — test cards, full loop, no real
money held — which moves legal review, live-mode Stripe and the hosted privacy
policy out of the path and into pre-submission, where they actually bind.

- [x] **Feed photos in production** (ROADMAP critical path #1) — **DONE
      2026-08-06.** Landed one level deeper than this line planned: the
      `'photos'` key went into the SHARED `home_feed_post_json` serialiser
      rather than into each RPC, so `get_home_feed`, `get_nearby_posts`,
      `search_posts`, `get_map_posts` and post detail all gained it at once
      and a future caller cannot forget it. `devSampleImages` deleted in the
      same commit, as required. CHECKS 17–19 in `home_feed_verification.sql`.
- [x] **Spotter "My reports" surface** — `MySightingsScreen` (`/my-sightings`),
      entered from Profile. `/sighting-dispute` got its in-app door on
      2026-09-01 (`ReportCard`, gated by `my_sighting_record`'s `dispute`
      object). Ticked 2026-09-25. The screen is to be renamed **"My sightings"**
      (ROADMAP path item 5).
- [~] **One telemetry sink** — REGISTERED 2026-08-30 (`telemetry.ts` →
      `telemetry_events`), about 95 events now. Ticked [~] rather than [x] on
      2026-09-25 because **the money funnel is not instrumented**: the post
      wizard, payment, payout onboarding and cancel emit only prose, which the
      sink never sends. ROADMAP path item 3.
- [x] **The cut list** — ~~`devSampleImages`~~ (done 2026-08-06),
      ~~`QuickReplyRow` → `ChoiceChips`~~ and ~~the two permission primers~~
      (STRUCK 2026-09-25 as decided-not-to — see ROADMAP), passive expiry
      (`expires_at` stopped being set by `20260902150000`), and DVLA off v1.
      Leftover client branches on the retired `expired` status are a `/tidy`
      item.
- [ ] **The 2026-09-25 path, items 1–6** (ROADMAP): Tier 0 admin + the Stripe
      question, prod-vs-repo diff, money funnel events, the stranded-payee
      minimum, "My sightings", and a fresh build + two-phone walk.
- [ ] EAS build to a closed internal track; **verify internal testing is not
      review-gated** before assuming it. The build must be FRESH from `main`:
      the last preview APK embeds the 29 Aug bundle.
- [ ] Beta: **ten** testers in one city, half of them people who will not be
      polite about it, with a one-page task brief. Then STOP and read the
      results before building more.

## Phase 5 — Pre-launch (after the beta)

> The full list, with the reasoning behind each item, is ROADMAP's
> **pre-submission checklist** (2026-09-25). This phase mirrors it in order.

- [x] User blocking — the submission blocker (guideline 1.2). SHIPPED
      2026-09-01, ADR-0017.
- [ ] Legal review of escrow model; T&Cs; privacy policy; safety page. Ask
      Stripe about the reward model NOW, which is ROADMAP path item 1; the
      lawyer comes before live mode.
- [ ] **Anti-stalking ADR** — the £5 fee made posting any car cheap and
      instant. Choose the mitigation before a public listing.
- [ ] **Daily operator digest email** — flags, disputes, held payouts,
      stranded payees, sweep health (reuses `notify-bug-report`'s Resend path)
- [ ] Server-side GPS-EXIF strip/reject on `post-photos`
- [ ] Hosted `LEGAL_PUBLIC_URLS` + a real `SUPPORT_EMAIL` (stores require a
      publicly reachable privacy policy; the in-app documents cannot satisfy it)
- [ ] Stripe LIVE mode: Connect Express, `sk_live`, and — **by hand** — the
      `account.updated` webhook event. Without it no spotter ever becomes
      payable and nothing errors.
- [ ] Moderator dashboard: flags, disputes, collusion queues. A console plus
      the digest is fine for ten testers and early launch; it is not fine at
      scale.
- [ ] Sentry (fold into the sink above — do not wire telemetry twice)
- [ ] EAS production builds; TestFlight external / production tracks;
      `eas.json` `submit.production`; iOS privacy manifest; Play data-safety
      form
- [ ] Store listings: "information reward" framing, moderation
      commitment, demo account for review
- [ ] Cold-start plan executed: launch city communities, bounty optional —
      **plus the public share page for one listing** (ADR first; ROADMAP
      argues it past the "no consumer web" fence)

## Working habits (every phase)

- Plan Mode for anything touching DOMAIN.md (payments, lifecycle)
- End every session with `/create-commit`
- `/tidy` weekly
- Update docs (+ ADR for big calls) in the same session as the change
