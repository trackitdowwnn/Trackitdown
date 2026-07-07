# Build Plan

The phased path from empty repo to v1 launch. Tick items off as they're
completed — `/catch-up` reads this file to brief on progress. Detailed
feature scope lives in `docs/ROADMAP.md`; this is the *order of work*.

## Phase 0 — Foundations

- [ ] Tools installed (Node LTS, Git, VS Code, Claude Code, jq, Expo Go)
- [ ] Expo project created, runs on a real phone via Expo Go
- [ ] Starter kit copied in; lint / typecheck / test scripts pass
- [ ] Git repo created on GitHub, first push, CI green
- [ ] Supabase dev + prod projects created; dev linked; `.env` from
      `.env.example`
- [ ] Stripe account in test mode; keys in `.env` / Edge Function secrets
- [ ] Claude Code first prompts run: folder scaffold, theme + core
      components, initial migration
- [ ] Import-boundary ESLint rules configured (prompt in CLAUDE.md notes)

## Phase 1 — Auth & posting (owner side)

- [ ] Sign up / sign in (email + Apple/Google), session handling
- [ ] Onboarding: alert radius + location permission flow
- [ ] Post-a-car stepper: details → photos → last seen → bounty
- [ ] DVLA Vehicle Enquiry API: plate → make/model/colour auto-fill
- [ ] V5C verification upload to private bucket
- [ ] Manual verification flip (moderator dashboard comes in Phase 4)

## Phase 2 — Payments (deliberately early — highest-risk integration)

- [ ] Stripe PaymentSheet: escrow charge at posting
- [ ] stripe-webhook Edge Function (signature check, dedupe, idempotent)
- [ ] Refund paths: cancelled / expired / rejected / recovered_no_spotter
- [ ] Tier 1 money tests green (docs/TESTING.md)
- [ ] Milestone: a test-mode pound goes in and comes back out correctly

## Phase 3 — Core loop (spotter side)

- [ ] Map + list search of active posts, distance sorting
- [ ] notify-spotters Edge Function (PostGIS radius query → push)
- [ ] Sighting flow: in-app camera, auto GPS, note, SafetyNotice
- [ ] Owner ↔ spotter chat (opens only after a sighting)
- [ ] Recovery confirmation: owner credits one sighting (or none)
- [ ] Spotter Stripe Connect onboarding + release-payout (95/5)
- [ ] Milestone: full journey on two phones with two test accounts

## Phase 4 — Trust layer & polish

- [ ] Moderator dashboard: verification, flags, disputes, collusion queues
- [ ] Flagging + user blocking
- [ ] Reputation counters + badges
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
