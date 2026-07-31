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
- [x] Spotter alerts: push notification on new active post within radius
      (built 2026-07-30 — features/notifications: push token registry, one
      shared send utility, tap routing incl. cold start, alert zones with
      PostGIS matching, 3-per-rolling-24h cap. **Sighting-chain re-alerts are
      OUT of v1** — see v2 candidate #4; DOMAIN.md amended to match.)
      **Extended 2026-07-31 — MULTI-ALERT, pulled forward from v2.** Up to 5
      named alerts per user, created through a wizard and narrowable by make,
      model, colour, body type, minimum bounty and recency. Pulled forward
      because one unfiltered alert spends a 3/day budget on cars the spotter
      was never going to spot — filtering is what makes the cap generous
      rather than limiting. The cap stays PER USER, so more alerts never means
      more interruptions. Also fixed a latent search bug on the way:
      `search_posts` matched make/model/colour case-SENSITIVELY against
      free-typed owner text.
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

- ~~**notify-owner-of-sighting push**~~ — **SHIPPED 2026-07-30** with the
  notifications feature. `create_sighting` → `notifySighting` → the shared
  send utility, authorised and made idempotent by
  `claim_sighting_notification` (which verifies the caller really is that
  sighting's spotter, so a forged id notifies nobody).
- ~~**notify-message push**~~ — **SHIPPED 2026-07-30**, to the contract
  pinned here: payload = sender FIRST NAME + post context, and message
  content never transits push (built in SQL so `npm run test:db` asserts its
  absence). Notifications collapse per thread — chat allows 20 messages a
  minute, which would otherwise buzz the recipient 20 times.
- **Message reactions** (considered and deferred in the 2026-07-28 chat
  design pass) — long-press ❤️/👍 with a small pop, per Airbnb's threads.
  Deferred because it is NOT a polish item against our model: messages are
  INSERT-only realtime with service-role-only DML, so reactions need a new
  table, a new SECURITY DEFINER RPC, participant RLS with its own absence
  tests, and a second realtime stream the thread subscription doesn't
  carry. Feature-sized; revisit only if threads get long enough that
  "received" needs a lighter signal than a reply.
- **Offline queueing for sighting reports** — v1 is retry-in-flow only; a
  report drafted with no signal is not persisted across app restarts.
- **Gallery photos as supplementary sighting evidence** (ADR-0003) —
  migration adding `sighting_photos.source` + the ≥1-live-capture rule in
  `create_sighting`, gallery pick/upload with EXIF stripped, owner-facing
  "added from photo library" labels, tests, security review. Decision is
  recorded; nothing is built.
- **watched-post-recovered push** — STILL BLOCKED, and the reason has been
  corrected: it is **not** waiting on notifications infra (that shipped
  2026-07-30). **No code path anywhere moves a post to `recovered`** — there
  is no recovery or payout function in any migration and no such Edge
  Function, so there is nothing to hook. The `recovery` payload variant, its
  route and its `push_sends` kind all ship and are tested; the exact
  insertion point is written up in features/notifications/README. Payload
  contract unchanged: post context only ("Good news — the Blue BMW you were
  watching was recovered"), never watcher counts or other watchers'
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
