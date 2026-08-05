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
      queue existing first. **No moderator UI is built** — but the dispute
      MACHINERY now exists (2026-08-05, ADR-0011: refund holds, spotter
      disputes, hand-run `resolve_sighting_dispute`), so this page's dispute
      half becomes a reader over `refund_disputes` + the sighting trail.
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
      **⛳ CRITICAL PATH ITEM #1 (2026-08-05 review).** There is a working
      precedent to copy rather than design: `list_my_posts` already returns
      `'photos'` as a JSON array holding the post's FIRST photo (lowest
      `post_photos.position`) as `[{ "url": ... }]`, shaped so it maps
      straight to `PostSummary.photos` with no reshaping — see
      `myPostsApi.ts:44` and the migration's own comment. This is an M, not
      the L it has been reading as.
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
      **BOTH WIRES CLOSED 2026-08-03.** `release-payout` is invoked from
      `RecoverPostScreen` on the `payout` branch, and again from the post's
      manage sheet ("Send the bounty") for the usual case where the spotter had
      not yet onboarded. Connect onboarding is built: `connect-onboarding`
      (Account Session), `submit-payout-details` (our own native form for bank
      details + identity, inside Stripe's prefill window), `connect-return`,
      and an `account.updated` branch in `stripe-webhook` — the only writer of
      `payouts_enabled`. A `PayoutsScreen` behind Profile → Payouts.
      **Still open, and all three matter:**
      1. **Collusion check — BUILT 2026-08-03.** Runs in `release-payout`
         before any transfer: shared-device history (`device_links`), shared
         card fingerprint, normalised-email match. Any hit → `held_for_review`,
         resolved by hand in the console. Fails closed; reasons never reach a
         client. Honest limit: two phones + two cards + unrelated emails defeat
         it — it prices fraud, it does not abolish it. (SECURITY_AND_TRUST §5
         has the full write-up.)
      2. ~~Nothing re-runs the payout when the webhook makes a spotter
         payable~~ — **WRONG, and wrong twice: AUTO-RELEASE IS BUILT.**
         Corrected 2026-08-05 by a loop trace, hours after a first correction
         to this same line called it "a wiring job" — it was not a job at all.
         `stripe-webhook`'s `account.updated` branch calls
         `releaseAllPendingFor` whenever `payouts_enabled` turns true, which
         finds every `credited` sighting on a `recovery_claimed` post for that
         spotter and runs the full release for each (collusion gate included).
         `releasePayout` returning `awaiting_payee` is the deliberate other
         half: escrow simply waits, and the webhook is what wakes it. The
         owner's "Send the bounty" button is now a manual FALLBACK, not the
         only path. ⚠️ It all rests on `account.updated` being enabled BY HAND
         on the Stripe endpoint — see BUILD_PLAN Phase 5.
      3. **The push half is DONE** (corrected 2026-08-05 — this line claimed
         otherwise for two days). `notify-credited` tells the credited spotter
         at the earn moment and routes them to `/payouts`;
         `_shared/recoveryAnnounce.ts` sends `payout_sent` and `recovery`,
         called from `releasePayout`, `refund-recovery` and
         `release-held-refunds`. What is STILL missing is the **spotter-facing
         sightings surface**: `/post-sightings` and `/sighting/[id]` are
         owner-only, so a spotter cannot browse the reports they filed — and
         `/sighting-dispute` has no in-app door at all, only a push route. A
         spotter who declined notifications can never contest a denial.
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
      **MESSAGE flagging is done too** — corrected 2026-08-05; this line read
      "messages have no flag path" while `flag_message` (20260715120000_chat.sql),
      `chatApi.flagMessage` and the thread's long-press report sheet were all
      shipped. Sightings and photos still have no flag path.
      **User blocking does not exist at all** — no table, RPC or UI. It is the
      one item here that is a SUBMISSION blocker rather than a nice-to-have:
      App Store guideline 1.2 expects UGC + private messaging to offer report
      AND block, and we offer only report. Not a beta blocker (a closed
      internal-track beta is not review-gated); build it between beta and
      store submission.
- [ ] Moderation queues: flags, disputes, collusion checks. (The
      *verification* queue that used to head this list is obsolete — ADR-0007
      removed pre-publish verification, so there is nothing to verify.)
- [~] Legal: T&Cs, privacy policy, safety guidelines page. **The documents are
      now IN-APP** (corrected 2026-08-05; this line still described the old
      `trackitdown.example` links). `src/features/legal/` + the `/legal/[doc]`
      route serve safety/terms/privacy, so the sign-in consent line and the
      Profile rows open real content that can never drift from the version a
      user agreed to. What remains is `LEGAL_PUBLIC_URLS` and `SUPPORT_EMAIL`:
      the stores require a publicly reachable privacy-policy URL, which an
      in-app screen cannot satisfy. Hosting/content task, blocking STORE
      SUBMISSION only — not the beta.
- [x] Account deletion (store requirement + UK GDPR erasure). Client shipped
      2026-07-10 against an Edge Function that did not exist. **Both halves are
      in the tree now** — `supabase/functions/delete-account`, invoked by
      `profileApi.requestAccountDeletion`. Corrected 2026-08-05; the line still
      said "PR #37, not yet merged".

**Infrastructure**
- [x] Supabase project (dev + prod), migrations in repo, RLS everywhere
      (52 migrations; RLS asserted by 13 SQL suites in `npm run test:db`)
- [x] EAS build profiles (development / preview / production) — eas.json
- [x] GitHub Actions CI (lint, typecheck, test) — .github/workflows/ci.yml,
      `checks` + a `db` job running every SQL suite
- [ ] Sentry crash reporting; basic analytics (PostHog or similar).
      **⛳ CRITICAL PATH ITEM #2 (2026-08-05 review) — and far cheaper than it
      looks.** 70 `log.info` funnel events are ALREADY instrumented across the
      app (`gate_shown`, `feed_load`, `otp_verified`, `garage_nudge_shown`,
      `center_view`, …) and every one of them dies in the Metro console,
      because no sink is ever registered. `logger.ts` was built for exactly
      this: registering one sink turns all 70 on with zero call-site changes,
      and nothing may import Sentry directly except that sink. Until this
      lands, every product judgement in this file is a guess — including the
      ones the 2026-08-05 review itself made.
- [x] ~~DVLA Vehicle Enquiry API: plate → make/model/colour auto-fill **in the
      GARAGE**~~ — **CUT FROM v1 by the 2026-08-05 review.** Rescoped once
      already (2026-08-01) when ADR-0007 killed the verification cross-check
      and the post wizard stopped collecting a plate (2026-07-24), which left
      it saving three fields of typing inside an OPTIONAL pre-registration
      flow. That is not core-loop value. Ticked as *resolved*, not delivered.
      Revisit only if beta data shows plate entry as a real drop-off.

## Cut or frozen by the 2026-08-05 product review

A review of the whole product (not the codebase) against the two core journeys.
Its finding in one line: **the loop is closer to done than this file reads, and
what stands between it and launchable is a blank feed, a spotter who cannot see
their own half, and no evidence from anyone but the author.** The six status
corrections above came out of the same pass. What follows are the subtractions —
taken first, deliberately.

- **CUT: `devSampleImages`.** `samplePhotos()` returns ten Unsplash cars in
  `__DEV__` and `[]` in production, which is *why* the missing feed photos
  survived unnoticed: dev flatters us with a full feed while real users get
  placeholders. Delete it in the same commit that lands real photo data, so the
  feed can never lie to us again.
- **CUT: passive post expiry.** DOMAIN promises "expiry (default 90 days, owner
  can renew), bounty refunded" and then concedes further down that nothing
  refunds by waiting. Nothing sets `status = 'expired'` anywhere. We are cutting
  the PROMISE, not building the machine: a cron that automatically refunds
  strangers' money is high-risk and low-value before launch, and
  owner-initiated cancel-with-refund already works. DOMAIN's lifecycle section
  needs the same edit.
- **CUT: DVLA lookup, entirely.** Already rescoped once to garage-only, where it
  now saves typing three fields in an optional pre-registration flow. Zero
  core-loop value. Off v1; revisit only if plate entry shows up as a real drop-off.
- **FROZEN: watchlist collections.** They shipped 2026-07-27 as "added to
  scope" — the v1 fence moving. Built and tested, so removing them costs more
  than keeping them, but **build nothing further on them**, and if the beta
  shows nobody names a list, delete the feature rather than maintain it.
- **MERGE: two chip rows and two permission primers.** `QuickReplyRow`
  duplicates `ChoiceChips` now that the latter has `role="button"` and
  `scrollable`; `PermissionPrimer` (shared) and `LocationPrimerCard`
  (search-map) are two anatomies for one job. Collapse each to one.

**Add nothing.** The review's honest answer to "what's missing" was *finish the
spotter's half and start measuring* — both already scoped below. Everything
else proposed failed the "why now rather than post-launch" test and is recorded
in the deferred list with its reasoning.

## Loop integrity — two holes found by the 2026-08-05 loop trace

Distinct from the product review above: that asked "what should we add", and
answered *nothing*. This asked "does the loop close", and found two places
where it does not. Both are silent — nobody sees an error, the app just stops
having anything to say.

- **THE ABANDONED POST.** Nothing in the system requires an owner to ever
  finish. A post sits `active` indefinitely (nothing sets `expired`), escrow
  sits `held` indefinitely, and a spotter who filed a real sighting has no
  recourse — because `create_refund_hold`, and therefore the whole dispute
  mechanism, is only ever called by `deactivate-post` and `refund-recovery`,
  which are both OWNER-INITIATED closures. An owner who recovers their car
  off-platform and never opens the app again strands a spotter's effort and
  real money, permanently and quietly.
  **This partly reverses the "cut passive expiry" decision above.** Cutting
  refund-by-waiting was right — no cron should move strangers' money on a
  timer. Cutting every liveness mechanism was not. The cheap fix moves no
  money: ask the owner "is the {car} still missing?" on a schedule, with
  *Still missing* (extends) and *I've found it* (drops into the existing
  recovery flow) — one push kind and one sender, and the escrow decision stays
  a human act. Only after repeated silence should anything close the post, and
  even then closing it to new sightings is safer than refunding it.
- **THE SILENT RUNNER-UP.** `claim_recovery` sets exactly one sighting to
  `credited` and leaves the others untouched, and `closed_uncredited` fires
  ONLY from `create_refund_hold` — i.e. only when nobody was credited. So when
  the owner credits spotter A, spotters B and C are told nothing whatsoever:
  the car they helped find is recovered and they never learn it. Single-winner
  is deliberate (ADR) and stays; silence for the others is not a decision
  anyone made, it is a gap. One more push kind (`not_credited`, sent from the
  same place as the recovery announcements) closes it honestly: the car was
  found, another spotter's report led to it. Costs one sender; buys back the
  goodwill of every spotter who ever loses, which on a crowd product is most
  of them.

## Beta target — 2026-08-26 (set by the 2026-08-05 review)

Ten testers, one city, closed track. **Run it on Stripe TEST MODE**: testers use
test cards, the full escrow → recover → payout loop runs end to end, and no real
money is held. That single choice defers all three items that have been sitting
untouched — legal review of the escrow model, live-mode Stripe console setup,
and a hosted privacy policy — past the beta and into a pre-submission checklist,
because none of them binds until real money or a public store listing does.
(Closed internal-track testing is not review-gated on either store; **verify
against App Store Connect before relying on it.**)

The critical path, in order:

1. **Feed photos in production** — see the Search item above. Nothing else
   matters while the primary surface shows cars with no photographs of cars.
2. **Spotter "My reports" surface + the dispute door**, then **one telemetry
   sink**. Ship together: 70 funnel events are already instrumented and every
   one of them dies in the Metro console, so the day testers arrive is too late
   to start measuring.
3. **Build and hand it to ten people.** Then stop and read what comes back
   before writing another line.

NOT on the path, deliberately: user blocking (submission blocker, not a beta
one), the moderator dashboard (a console is fine for ten testers), and design
passes on the five screens that have never had one — testers will point at the
two that actually matter, and guessing at the other three is the trap a
no-deadline project sets.

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
- ~~**watched-post-recovered push**~~ — **SHIPPED.** Corrected 2026-08-05
  after a review found this entry still reading "unbuilt" for the third time.
  It is built and wired: `_shared/recoveryAnnounce.ts` exports
  `announceRecoveryToWatchers` (kind `recovery`) and `announcePayoutSent`
  (kind `payout_sent`), called from `_shared/releasePayout.ts`,
  `refund-recovery` and `release-held-refunds` — i.e. from every path that
  genuinely finishes a recovery. Payload contract held: post context only
  ("Good news — the Blue BMW you were watching was recovered"), never watcher
  counts or other watchers' existence. Sighting-activity pushes for watchers
  are deliberately OUT (noise risk) — revisit only with launch data.
  **Named collections SHIPPED 2026-07-27** (they were listed here as not-v1);
  shared/collaborative lists remain out permanently — see DOMAIN.md's
  collections clause.

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
