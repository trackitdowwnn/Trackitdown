# Roadmap

Purpose: define what v1 IS and — just as importantly — what it is NOT, so
nobody (human or AI) builds v2 features early. If a task drifts outside
v1 scope, stop and flag it.

## v1 — launch scope (UK only)

**Core loop**
- [ ] Auth: email + Apple/Google sign-in, onboarding with alert radius setup
- [ ] Post a stolen car: stepper flow (details → photos → last seen →
      bounty → V5C verification upload → escrow payment)
- [ ] Moderator verification queue (simple internal web page)
- [ ] Search: map + list of active posts, distance sorting
- [ ] Spotter alerts: push notification on new active post within radius
- [ ] Report a sighting: in-app camera, auto GPS, note; SafetyNotice
- [ ] Owner ↔ spotter chat (opens only after a sighting)
- [ ] Recovery confirmation flow: owner credits one sighting (or none)
- [ ] Payout: Stripe Connect onboarding for spotter, 95/5 release, refunds
- [ ] Reputation counters + 1/5/25 badges on profiles
- [ ] Flagging (posts, sightings, photos, messages) + user blocking
- [ ] Moderation queues: verification, flags, disputes, collusion checks
- [ ] Legal: T&Cs, privacy policy, safety guidelines page

**Infrastructure**
- [ ] Supabase project (dev + prod), migrations in repo, RLS everywhere
- [ ] EAS build profiles (development / preview / production)
- [ ] GitHub Actions CI (lint, typecheck, test)
- [ ] Sentry crash reporting; basic analytics (PostHog or similar)
- [ ] DVLA Vehicle Enquiry API integration for plate → make/model/colour
      auto-fill and verification cross-check

## Explicitly NOT in v1 (do not build early)

- **Bounty splitting** across multiple spotters — single winner only.
- **Multi-region / multi-currency** — UK + GBP only. No i18n scaffolding.
- **Gallery photo uploads for sightings** — in-app camera only (anti-fraud).
- **Live tracking / navigation toward a sighted car** — never, at any
  version. This is a safety rule, not a scope decision.
- **Automatic ANPR / plate-recognition scanning** — big legal/privacy
  questions; needs dedicated review before it's even a candidate.
- **Insurance-company or fleet accounts** — v2 candidate.
- **In-app bounty top-ups / crowdfunded bounties** — v2 candidate.
- **Police/force integrations** — v2+; manual cooperation policy only in v1.
- **Web app for consumers** — mobile only at launch (moderator page excepted).

## v2 candidates (revisit after launch data)

1. Bounty splitting with clear precedence rules
2. Crowdfunded bounties (community adds to a bounty)
3. Fleet/insurance accounts with bulk posting
4. "Car may have moved" smart re-alerts based on sighting chains
5. Reputation-weighted alert prioritisation
6. Ireland expansion (plate formats, EUR, verification equivalent)

## Decision log

Big decisions get a short ADR in `docs/decisions/` (see the template
there). Existing decisions: Supabase over Firebase (PostGIS), Stripe
Connect escrow at posting, single-winner bounty, verification-before-
visibility.
