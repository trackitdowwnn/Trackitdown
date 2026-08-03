# Roadmap

Purpose: define what v1 IS and — just as importantly — what it is NOT, so
nobody (human or AI) builds v2 features early. If a task drifts outside
v1 scope, stop and flag it.

## v1 — launch scope (UK only)

> **Marks:** `[x]` done · `[ ]` not started · `[~]` **partly done — the line
> says what is built and what is not.** The third mark was added 2026-08-01
> after an audit found several items that were substantially built but read as
> untouched, which made the remaining work look far larger than it is. An
> honest `[~]` beats a `[ ]` that hides a day's work already done.

**Core loop**
- [~] Auth: email + Apple/Google sign-in, onboarding with alert radius setup.
      Sign-in (email OTP + Apple + Google) and the 4-slide onboarding are
      BUILT. **The alert-radius step is not in onboarding** and deliberately
      never was — features/auth/README.md scopes it out, and radius setup lives
      in the Alerts wizard instead. Decide whether to move it into onboarding
      or strike it from this line; today the line overstates what is missing.
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
- [~] Search: map + list of active posts, distance sorting (features/search-map
      — Explore feed, map screen, list sheet; distance sorting is server-side,
      `order by dist` in get_home_feed/search_posts)
      **⚠️ Downgraded from [x] on 2026-08-03: the cards have no photos in a
      release build.** `get_home_feed` returns no photo column, so
      `feedApi.ts:66` falls back to `devSampleImages`, which yields ten
      Unsplash cars in `__DEV__` and `[]` in production. Feed, watchlist and
      inbox all render placeholders for real users. A stolen-car feed without
      photographs of the cars is not a shipped search feature. Fix = photo
      data on the feed/search/nearby RPCs + card schemas, and delete the dev
      fallback in the same change so dev stops flattering us.
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
- [x] Report a sighting: in-app camera, auto GPS, note; SafetyNotice
      (features/sightings — camera-only per ADR-0003, sightings_verification.sql)
- [x] Owner ↔ spotter chat (opens only after a sighting) (features/chat —
      Inbox + thread, chat_verification.sql)
- [x] Recovery confirmation flow: owner credits one sighting (or none).
      **BUILT 2026-08-02** — `20260802200000_claim_recovery.sql`,
      `20260802210000_mark_recovered_no_spotter.sql`, `RecoverPostScreen`,
      entered from post detail. This entry read "THE BIGGEST HOLE IN THE LOOP —
      nothing anywhere moves a post to `recovered`" until 2026-08-03, a day
      after it shipped. Single winner is enforced by a partial unique index;
      the owner cannot credit their own sighting; the "I found it another way"
      branch calls `refund-recovery` and reaches a terminal state correctly.
- [~] Payout: Stripe Connect onboarding for spotter, 95/5 release, refunds.
      **Refunds are DONE** (deactivate-post + mark_post_payment_refunded +
      refund_cancel_verification.sql). **`release-payout` is DONE too** —
      209 lines, 95/5 transfer math per ADR-0002, a per-post transfer
      idempotency key, and `mark_recovery_paid` independently re-deriving the
      split and rejecting a mismatch (`20260802220000_release_payout.sql`).
      **THE HOLE MOVED HERE, AND IT IS NOW TWO WIRES RATHER THAN A FEATURE:**
      1. **Nothing calls `release-payout`.** `RecoverPostScreen.tsx` handles the
         `refund` branch, and on the `payout` branch shows a toast saying
         "we'll get the bounty to them" and navigates back. The post stays in
         `recovery_claimed`, the bounty stays in escrow, and BOTH parties have
         been told money is on its way.
      2. **There is no payee.** No Connect onboarding exists anywhere, so
         `release-payout` would answer `PAYEE_NOT_READY` — which by design it
         treats as normal and re-runnable, not as a failure.
      Also missing on the spotter's side: no `type: 'recovery'` push SENDER
      (the payload, route and `push_sends` kind all exist and are tested), and
      **no spotter-facing surface at all** — `/post-sightings` and
      `/sighting/[id]` are both owner-only, so a spotter cannot check a report
      they filed, let alone learn they were credited.
- [~] Reputation counters + 1/5/25 badges on profiles. Counters and badge
      maths are BUILT and server-maintained (`sightings_reported`,
      `sightings_helpful`; ReputationCard + lib/reputation.ts). The third,
      `recoveries_credited`, moves only on a PAID recovery, so it stays 0 until
      the two wires above are connected.
- [x] Watchlist: bookmark posts to keep an eye out (toggle on every card, own
      tab, 30-day resolved section with tombstones — added to scope + built
      2026-07-22)
- [x] Watchlist **collections**: user-named private lists, one collection per
      saved post, save-then-change (added to scope + built 2026-07-27).
      Sharing/collaborators are permanently OUT — see DOMAIN.md.
- [~] Flagging (posts, sightings, photos, messages) + user blocking.
      **POST flagging is done** (flag_post + flagApi + post_flags_verification.sql).
      Sightings, photos and messages have no flag path, and user blocking does
      not exist at all — no table, RPC or UI.
- [ ] Moderation queues: flags, disputes, collusion checks. (The
      *verification* queue that used to head this list is obsolete — ADR-0007
      removed pre-publish verification, so there is nothing to verify.)
- [ ] Legal: T&Cs, privacy policy, safety guidelines page. The in-app
      plumbing is BUILT (Profile rows + the sign-in consent line, opening
      LEGAL_URLS via expo-web-browser); the three URLs and the support email
      still point at `trackitdown.example`, a reserved placeholder TLD. This
      is a hosting/content task, not an engineering one — the code side is
      five strings across `shared/lib/legal.ts` and `profile/config.ts`.
- [ ] Account deletion (store requirement + UK GDPR erasure). Client shipped
      2026-07-10; the Edge Function it called was never written, so the button
      could not delete. BUILT 2026-08-01 — see PR #37, not yet merged.

**Infrastructure**
- [x] Supabase project (dev + prod), migrations in repo, RLS everywhere
      (52 migrations; RLS asserted by 13 SQL suites in `npm run test:db`)
- [x] EAS build profiles (development / preview / production) — eas.json
- [x] GitHub Actions CI (lint, typecheck, test) — .github/workflows/ci.yml,
      `checks` + a `db` job running every SQL suite
- [ ] Sentry crash reporting; basic analytics (PostHog or similar)
- [ ] DVLA Vehicle Enquiry API: plate → make/model/colour auto-fill **in the
      GARAGE**. Rescoped 2026-08-01: the verification cross-check half is dead
      (ADR-0007) and the post wizard no longer collects a plate at all
      (2026-07-24), so the only surviving plate field — and the only place this
      could help — is the garage.

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
- **watched-post-recovered push** — **UNBLOCKED 2026-08-02, still unbuilt.**
  The reason has now been corrected twice. It was never waiting on
  notifications infra (that shipped 2026-07-30), and the second reason given
  here — "no code path anywhere moves a post to `recovered`" — stopped being
  true when `claim_recovery` and `release-payout` landed. `mark_recovery_paid`
  is the hook: it is the moment a post genuinely becomes `recovered`, and it
  is where both this push and the spotter's own "you were credited" push
  belong. The `recovery` payload variant, its route and its `push_sends` kind
  all ship and are tested; the exact insertion point is written up in
  features/notifications/README. Payload
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
