# Roadmap

Purpose: define what v1 IS and — just as importantly — what it is NOT, so
nobody (human or AI) builds v2 features early. If a task drifts outside
v1 scope, stop and flag it.

## v1 — launch scope (UK only)

**Core loop**
- [ ] Auth: email + Apple/Google sign-in, onboarding with alert radius setup
- [x] Post a stolen car: stepper flow (details → photos → last seen →
      bounty → escrow payment). **The V5C verification upload was REMOVED**
      with live-on-payment (2026-07-30) — a paid post goes straight to
      `active`. See DOMAIN.md and SECURITY_AND_TRUST.md §2's open gap.
- [ ] Moderator queue (simple internal web page) — flags, disputes and
      collusion checks. The *ownership-verification* queue is no longer part
      of the posting path; re-introducing any ownership check depends on this
      queue existing first. **Nothing moderator-facing is built.**
- [x] Garage / "My cars": pre-register your vehicles so reporting one stolen
      prefills the wizard (5 per account, plate optional, no V5C; posts
      snapshot rather than reference the saved car — added to scope + built
      2026-07-27)
- [ ] Search: map + list of active posts, distance sorting
- [ ] Spotter alerts: push notification on new active post within radius
- [ ] Report a sighting: in-app camera, auto GPS, note; SafetyNotice
- [ ] Owner ↔ spotter chat (opens only after a sighting)
- [ ] Recovery confirmation flow: owner credits one sighting (or none)
- [ ] Payout: Stripe Connect onboarding for spotter, 95/5 release, refunds
- [ ] Reputation counters + 1/5/25 badges on profiles
- [x] Watchlist: bookmark posts to keep an eye out (toggle on every card, own
      tab, 30-day resolved section with tombstones — added to scope + built
      2026-07-22)
- [x] Watchlist **collections**: user-named private lists, one collection per
      saved post, save-then-change (added to scope + built 2026-07-27).
      Sharing/collaborators are permanently OUT — see DOMAIN.md.
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
- **Gallery-ONLY sightings** — every sighting requires ≥1 live in-app
  capture, permanently (anti-fraud). Gallery photos as labelled
  SUPPLEMENTARY evidence were approved 2026-07-15 (ADR-0003) but are not
  built yet — see "Deferred from built v1 features".
- **Live tracking / navigation toward a sighted car** — never, at any
  version. This is a safety rule, not a scope decision.
- **Automatic ANPR / plate-recognition scanning** — big legal/privacy
  questions; needs dedicated review before it's even a candidate.
- **Insurance-company or fleet accounts** — v2 candidate.
- **In-app bounty top-ups / crowdfunded bounties** — v2 candidate.
- **Police/force integrations** — v2+; manual cooperation policy only in v1.
- **Web app for consumers** — mobile only at launch (moderator page excepted).

## Deferred from built v1 features (build next, not v2)

- **notify-owner-of-sighting push** — the sightings feature shipped without
  push (no notifications infra exists yet); the owner sees reports in-app.
  Arrives with the notifications feature (Edge Function + token storage).
- **notify-message push** — chat shipped without push (same missing infra).
  Contract is pinned in features/chat/README: payload = sender FIRST NAME +
  post context ("New message about your Blue BMW") — message content NEVER
  transits push (third-party infra; SECURITY_AND_TRUST §3). The deep route
  `/chat/[threadId]` is already live and gate-aware. Unread state works
  in-app today (tab badge + refetch-on-focus).
- **Offline queueing for sighting reports** — v1 is retry-in-flow only; a
  report drafted with no signal is not persisted across app restarts.
- **Gallery photos as supplementary sighting evidence** (ADR-0003) —
  migration adding `sighting_photos.source` + the ≥1-live-capture rule in
  `create_sighting`, gallery pick/upload with EXIF stripped, owner-facing
  "added from photo library" labels, tests, security review. Decision is
  recorded; nothing is built.
- **watched-post-recovered push** — the watchlist shipped in-app-only (same
  missing notifications infra). Payload contract pinned in DOMAIN.md's
  watchlist carve-out: post context only ("Good news — the Blue BMW you
  were watching was recovered"), never watcher counts or other watchers'
  existence. Sighting-activity pushes for watchers are deliberately OUT
  (noise risk) — revisit only with launch data. **Named collections SHIPPED
  2026-07-27** (they were listed here as not-v1); shared/collaborative lists
  remain out permanently — see DOMAIN.md's collections clause.

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
Connect escrow at posting, single-winner bounty, and — **superseding
verification-before-visibility** — live-on-payment (ADR-0007).
