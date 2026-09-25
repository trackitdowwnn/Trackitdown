# Roadmap

Purpose: define what v1 IS and — just as importantly — what it is NOT, so
nobody (human or AI) builds v2 features early. If a task drifts outside
v1 scope, stop and flag it.

> ⛔ **FEATURE FREEZE since 2026-09-25, until ten testers have used the app.**
> The current plan is **"The 2026-09-25 product review"** below: a seven-item
> path to the beta, a pre-submission checklist, and delete rules for the scope
> that shipped without a line in this file. Where older sections disagree,
> that section wins.

## v1 — launch scope (UK only)

> **Marks:** `[x]` done · `[ ]` not started · `[~]` **partly done — the line
> says what is built and what is not.** The third mark was added 2026-08-01
> after an audit found several items that were substantially built but read as
> untouched, which made the remaining work look far larger than it is. An
> honest `[~]` beats a `[ ]` that hides a day's work already done.

**Core loop**
- [x] Auth: email + Apple/Google sign-in, onboarding ~~with alert radius
      setup~~. Sign-in (email OTP + Apple + Google) and the 4-slide onboarding
      are BUILT. **The alert-radius step is STRUCK from this line by the
      2026-09-25 review**, not delivered: radius setup lives in the Alerts
      wizard, features/auth/README.md scoped it out of onboarding, and adding a
      step to a funnel that measured 1 completion against 6 skips is the wrong
      direction.
- [x] Post a stolen car: stepper flow (details → photos → last seen →
      reward → payment). **The V5C verification upload was REMOVED**
      with live-on-payment (2026-07-30) — a paid post goes straight to
      `active`. See DOMAIN.md and SECURITY_AND_TRUST.md §2's open gap.
      **Extended 2026-08-20 — TWO PRICING MODES (ADR-0014).** The reward phase
      now asks *whether* to offer one before asking how much: a bounty
      (£10–£5,000, escrowed, 95/5) or a fixed **£5 listing fee**, no cash
      reward. See the scope note below — this is an addition the 2026-08-05
      review's "Add nothing" instruction did not sanction, taken deliberately.
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
- [x] Search: map + list of active posts, distance sorting (features/search-map
      — Explore feed, map screen, list sheet; distance sorting is server-side,
      `order by dist` in get_home_feed/search_posts)
      **Downgraded to [~] on 2026-08-03 because the cards had no photos in a
      release build; RESTORED to [x] on 2026-08-06.** `home_feed_post_json` —
      the serialiser all nine card RPCs share — now emits `'photos'` as the
      post's first photo by position (`[{url}]`, or `[]`), so the feed, the
      nearby pages, faceted search, the map and post detail gained real
      pictures in one edit, and a tenth caller cannot forget them. The client
      schema REQUIRES the key, so a server that stops sending it fails loudly
      instead of quietly restoring the blank feed. `devSampleImages` was
      deleted in the same commit — it was the bug's own camouflage, and every
      remaining `samplePhotos()` fallback (watchlist, chat, post detail) went
      with it. CHECKS 17–19 in `home_feed_verification.sql` assert the key
      exists, that it is the LOWEST-position photo rather than any photo, and
      that a photoless post yields `[]` rather than breaking the parse.
      ⛳ This was CRITICAL PATH ITEM #1 for the 2026-08-26 beta.
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
         `release-held-refunds`. ~~What is STILL missing is the
         **spotter-facing sightings surface**~~ — **the dispute half is DONE
         2026-09-01.** `My reports` now shows an in-app door on any report a
         refund hold names, so a spotter who declined notifications can contest
         a denial: `my_sighting_record` carries a per-row `dispute` object
         mirroring `my_dispute_context`'s gate, and `ReportCard` renders one
         labelled row — never a whole-card press — only where the door opens.
         ⚠️ The gate is now written in TWO places; `refund_hold_verification`
         CHECK 11 asserts they agree, because the failure mode is a button that
         leads straight to `DISPUTE_NOT_AVAILABLE`.
         What remains here is narrower than this entry used to claim:
         `/post-sightings` and `/sighting/[id]` are still owner-only, so a
         spotter cannot browse the full detail of a report they filed — only
         the summary `My reports` shows.
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
- [x] Flagging (posts, ~~sightings, photos,~~ messages) + user blocking.
      **POST flagging is done** (flag_post + flagApi + post_flags_verification.sql).
      **MESSAGE flagging is done too** — corrected 2026-08-05; this line read
      "messages have no flag path" while `flag_message` (20260715120000_chat.sql),
      `chatApi.flagMessage` and the thread's long-press report sheet were all
      shipped. Sightings and photos still have no flag path — **deferred by the
      2026-09-25 review**: sighting photos are visible only to the post's owner,
      public post photos are covered by `flag_post`, and guideline 1.2 is met by
      report + block.
      **User blocking SHIPPED 2026-09-01** (ADR-0017,
      `20260901150000_user_blocking.sql`, `blocksApi.ts`, Settings → Blocked
      accounts). Corrected 2026-09-25; this line said "does not exist at all"
      for 24 days after it did, while the beta section's "NOT on the path" note
      in this same file said it had shipped.
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
- [x] ~~basic analytics~~ **DONE 2026-08-30.** ⛳ Was CRITICAL PATH ITEM #2
      (2026-08-05 review), and it was as cheap as this entry predicted. The
      count was 86 events, not 70. `src/shared/lib/telemetry.ts` registers one
      sink at `_layout.tsx` module scope and all 86 turned on with **zero
      call-site changes**, exactly as `logger.ts` was built for.
      The destination is `public.telemetry_events` — a table in the database
      you already have, not a new vendor: no account, no SDK, no third party
      receiving your users' behaviour, and the queries are the SQL you already
      write (`OPERATIONS.md` §6). Sessions carry no user id and the session id
      never touches the device, following `onboarding_events`.
      ⚠️ Two limits worth knowing before trusting a number: the endpoint is
      anon-writable, so counts can be inflated; and a hard crash loses the tail
      of a session, because the last flush needs `background`. Both are stated
      in `OPERATIONS.md` §6 next to the queries themselves.
- [ ] Sentry crash reporting.
      Split from the analytics half above on 2026-08-30, because they are two
      jobs: this one is stack traces from a crash the app did not survive, and
      the sink above cannot do it — the process is gone before a flush. Not
      urgent for a ten-person beta you can ask directly. When it lands it is a
      SECOND `addLogSink` call, and nothing may import Sentry except that sink.
- [x] ~~DVLA Vehicle Enquiry API: plate → make/model/colour auto-fill **in the
      GARAGE**~~ — **CUT FROM v1 by the 2026-08-05 review.** Rescoped once
      already (2026-08-01) when ADR-0007 killed the verification cross-check
      and the post wizard stopped collecting a plate (2026-07-24), which left
      it saving three fields of typing inside an OPTIONAL pre-registration
      flow. That is not core-loop value. Ticked as *resolved*, not delivered.
      Revisit only if beta data shows plate entry as a real drop-off.

## The 2026-09-25 product review — freeze, measure, hand it over

The third whole-product review (after 2026-08-05 and 2026-08-30). **This section
is the current plan and overrides older sections where they disagree.** Its finding in one line: **the loop has been beta-ready since about
2026-09-01, and the 3½ weeks since went on about 70 commits of map markers, the
theft-stats page, area insights and inbox rows. None of that was on the critical
path, and still nobody but the author has used the app.**

The owner's answers, recorded so they are not re-asked:
- **Real signal:** none yet. Nobody else has used the app.
- **Launch intent:** a beta soon, the store after that.
- **Weakest, in the owner's view:** cold start / no crowd, spotters getting paid,
  and trust & moderation.
- **Avoided, by the owner's own account:** Tier 0 admin, handing the app to
  people, and legal review.

None of the three weaknesses can be fixed by building more. They are answered by
users, by admin, and by a lawyer. That is what the plan below spends its time on.

### ⛔ Feature freeze — in force until ten testers have used the app

- No new screens, no new features, and **no redesign or design pass on any
  screen**.
- Allowed: fixes for what breaks on the two-phone walk (item 6 below), the items
  on the path below, and docs.
- A change that is not on the path needs a line in this section saying why it
  could not wait. That is the same rule ADR-0014's entry above set for itself.
- **The freeze lifts when** ten testers have had a build for a week and the
  results have been read.

> **Exception taken the same day: the escrow UX overhaul (ADR-0020).**
> Recorded here as a decision, as the rule above requires.
>
> **What:**
> - the service fee moves on top of the reward, so the spotter is paid the
>   number they were shown
> - owner money status on the listing and on My listings
> - amounts and a confirm step on the recovery screen
> - owner pushes when a refund or payout moves
> - an always-visible Earnings screen for spotters
> - five money bugs found along the way
>
> **Why it could not wait:**
> - Two of the three weaknesses the owner named are spotters getting paid and
>   trust. Both live on these screens.
> - `payouts` and `recover-post` were already scheduled as the first design
>   passes after the beta.
> - The spotter was being promised £500 and paid £475. That is a trust bug,
>   not polish.
>
> **Cost:** five stacked PRs (#111–#115), three of them money-touching. It delays
> path item 6 (the two-phone walk) until they land. The walk then covers the new
> money screens too.
>
> **What landed (2026-09-25):**
> - **#111:** the fee on top (ADR-0020), the itemised bill, and the "how your
>   reward works" explainer. Review hardening: no double charge on a retry, and
>   a new charge is always recorded.
> - **#112:** the money-state reads.
> - **#113:** owner money pushes (ADR-0021) and a sweep safety net for the
>   credited push.
> - **#114:** "Your money" on the listing and on My listings, and amounts plus
>   a confirm step at recovery.
> - **#115:** Earnings for spotters.
>
> Five bugs were fixed along the way. **Deploy in order, and publish each OTA
> before the next server deploy** — #112's migration widens a `.strict()` client
> schema that #111's bundle is the first to tolerate.

### Unsanctioned scope, recorded rather than deleted

These shipped without any line in this file, which is the v1 fence moving without
a decision. They are built and tested, so removing them before the beta costs
more than keeping them. They are **frozen, and each has a delete rule decided
now** so the beta can settle it.

- **Area insights / theft stats.** Covers `/area-insights`
  (`AreaInsightsScreen`, 1,085 lines, the largest screen in the app), the stats
  on the feed's section headers, and the `area_insights*` migrations
  (2026-08-11). About 15 commits went into it on 2026-09-21/22 alone.
  **Delete rule:** if `area_insights_viewed` shows testers rarely open it,
  delete the screen and the header stats after the beta.
- **Per-listing stats** (`/post-stats`, shown to users as "View activity"). This
  is owner analytics, a nice-to-have. It has **no view event today**, so path
  item 3 adds `post_stats_viewed`. **Delete rule:** the same as above.
- **Watchlist collections:** already FROZEN by the 2026-08-05 review. The rule
  stands: if `collection_create` shows testers do not name a list, delete the
  feature.
- **Payout onboarding's four fallback layers** (native form → embedded Stripe →
  bank form → browser). Each one is maintained forever. Once path item 3
  measures which layer spotters actually finish on, keep that one plus the
  browser fallback.

### The beta critical path, restated (replaces item 3 of the 2026-08-05 path)

1. **Tier 0 admin — no code.**
   - **Stripe test mode:** the account evidently exists, because the charge
     path has run (see ADR-0014's correction). **Confirm `account.updated` is
     enabled BY HAND** on the test webhook endpoint; without it no spotter ever
     becomes payable and nothing errors.
   - **Domain:** buy `trackitdown.co.uk`.
   - **Support mailbox:** set one up and replace
     `SUPPORT_EMAIL = support@trackitdown.example` (`profile/config.ts`).
   - **Resend:** verify a sender domain. Bug reports currently send from the
     sandbox `onboarding@resend.dev`.
   - **Ask Stripe support now, in writing,** whether escrowed "information
     rewards" for stolen-car sightings are acceptable under their
     restricted-business rules. A "no" kills the model rather than delaying it,
     so it is cheaper to learn before the beta than after.
2. **Check prod against the repo** before any tester touches it.
   - Prod has been hand-edited before: the £5 fee schema was only partly
     applied, and free-listing recoveries were stranded until
     `20260924120000`.
   - Diff prod's schema against the migrations and confirm every migration
     through `20260924130000` is applied.
   - From then on, prod changes only through `supabase db push`, never the SQL
     editor.
3. **Measure the money funnel.** Today the post wizard, payment, payout
   onboarding and cancel send NO funnel events. There are only prose logs and
   `post_draft_saved`, and OPERATIONS.md §6 cites a `checkout_started` event
   that nothing emits. Add snake_case `log.info` events for:
   - the wizard: entered / each step / review / submit
   - payment: `payment_sheet_opened` / `succeeded` / `cancelled`
   - payout onboarding: `payout_onboarding_started` / layer / `completed`
   - `listing_cancelled`
   - `post_stats_viewed`

   The sink picks up snake_case automatically, so this needs no new
   infrastructure. Without it the beta cannot answer its first question: does
   an owner get from "car stolen" to "live"? Route: `/improve`.
4. **The stranded payee — the minimum. VERIFIED 2026-09-25.**
   - **The gap:** a credited spotter who never finishes payout onboarding
     leaves the post in `recovery_claimed` with escrow `held`, indefinitely.
     `releasePayout` answers `awaiting_payee`, and nothing retries it on a
     timer except for upheld disputes (`release-held-refunds` Phase 2a).
     The `account.updated` webhook pays automatically the moment the spotter
     becomes payable, so the gap is only the spotter who never finishes.
     Nothing reminds them. `delete-account` refuses the owner while the
     post stays in `recovery_claimed`.
   - **Before the beta:**
     - an OPERATIONS.md query for "credited, awaiting payee for more than 3
       days"
     - a reminder push to the spotter
   - **After the beta:** what happens after N days (refund, hold, operator
     decision) moves money. That needs Plan Mode and an ADR.
5. **One word per concept, applied to the spotter's list.**
   - "Report" currently means two things: "Report a stolen car" and "Check
     your report" mean a listing, while "My reports" means sightings. The inbox
     filter and the login gate already say "sightings".
   - **Decided:** the spotter's list is **"My sightings"** everywhere.
   - Also fix the wizard's "Reward" phase asking "Set a bounty", plus the
     leftover "post" wording ("We couldn't create your post", "Post & pay").
   - Route: `/polish-copy`.
6. **A fresh preview build from `main`, then the two-phone walk.** The last APK
   embeds `e654c39` (29 Aug), and an OTA cannot reach a first launch. Walk:
   - both pricing modes (reward and £5)
   - both recovery branches (credit a spotter / found it myself)
   - a spotter going through payout onboarding from zero
   - a dispute
   - a block

   The Phase 3 milestone in BUILD_PLAN has never been walked, and the
   PaymentSheet still owes a re-test after the SDK bump. Fix only what breaks
   (`/diagnose-and-fix-bug`).
7. **Hand it to ten people in one city.** Include some who will not be polite.
   - Give them a one-page tester brief of tasks: post with a test card, report
     a sighting, credit someone, get paid.
   - **Then stop.** The next session reads the telemetry and the feedback
     before writing another line.

### Decided by beta evidence, not before

Each item names the event or signal that decides it.

- **Area insights, post stats, collections, payout layers:** the delete rules
  above.
- **Posting length.** The wizard is about 17 screens, including 12 questions
  and at least 3 photos, at the owner's most stressful moment. Path item 3
  shows where owners drop off. The first candidates are a 1-photo minimum, and
  folding make/model/colour/body/year together. Route: `/improve`.
- **Alerts have no entry point on Explore.** Alerts are the spotter's reason to
  come back, but the only way in is Profile or a nudge after about 3 listing
  views. *A guess:* most spotters never make one. `alert_created` already
  measures it. If it is low, add an Explore entry point.
- **Design passes go to the money screens next.** `payouts` and
  `recover-post` have had none, while Explore, the map, chat and the inbox have
  had several each.
- **My cars vs My listings:** two owner lists. Merge them only if testers are
  confused. It is L-sized.
- **Dormancy for silent posts:** unchanged from ADR-0019. It waits on the count
  of owners who go silent through all three asks.

### Pre-submission checklist — after the beta, before any store listing

None of these binds a test-mode beta. All of them bind a public listing.

- [ ] **Legal review** of the escrow/reward model, T&Cs and liability. Booked
      before live mode, not after.
- [ ] **Anti-stalking ADR (the press question).**
      - **The question:** "Could an abusive ex post my car to track me?" Today
        the answer is **yes: for £5, live instantly** (ADR-0007 + ADR-0014).
        Sightings then deliver photos and GPS of that car to whoever posted it.
      - **The gap in §2:** SECURITY_AND_TRUST §2's defence ("£10–£5,000 in
        escrow") predates the £5 fee. There is no ownership check,
        one-post-per-plate is dormant, and takedown depends on the operator
        reading SQL.
      - **The ADR chooses at least one of:**
        - an instant operator alert on any flag
        - a posting rate limit per account and per card
        - sightings withheld from brand-new accounts for N hours
        - an ownership check above a threshold

      Update §2 to match. Route: `security-reviewer` + ADR, then
      `/create-main-feature`.
- [ ] **A daily operator digest email** instead of a moderator dashboard, for
      now. It reuses the Resend path in `notify-bug-report` and covers:
      - new flags
      - open disputes with time left
      - held payouts
      - stranded payees (path item 4)
      - `sweep_health()`

      Solo moderation is sustainable only if something tells the operator when
      to look. The dashboard stays on the list for past launch scale.
- [ ] **Strip or reject GPS EXIF on the server.** Today EXIF is stripped
      client-side only, and `post-photos` is a public bucket, so a scripted
      upload can publish a home's GPS (SECURITY_AND_TRUST §3).
- [ ] **The public share page for one listing (argued against the fence).**
      - **What:** read-only, coarsened location, with "Get the app". Share
        links were removed in #91 because there was no domain.
      - **Why it matters:** it is the only item anywhere on this list that
        addresses cold start, which is the owner's first-named weakness.
        Owners already post their stolen car in local Facebook and WhatsApp
        groups, and a link turns each one into distribution.
      - **Why the fence does not rule it out:** "no consumer web app" exists to
        avoid a second client. One page with no login and no actions is a link
        preview, not a client.
      - **Before building:** it needs an ADR and a `security-reviewer` pass,
        because it must keep `get_post_detail`'s anonymous-caller privacy
        rules.
- [ ] **Stripe LIVE:** Connect Express, `sk_live`, and `account.updated`
      enabled BY HAND.
- [ ] **Hosted legal pages:** `LEGAL_PUBLIC_URLS` and `PUBLIC_WEB_ORIGIN`,
      needing the domain from path item 1.
- [ ] **Store paperwork:**
      - the iOS privacy manifest and Play data-safety form
      - `eas.json` `submit.production`
      - a demo account for review
      - the listing's "information reward" framing
- [ ] **Sentry,** as a second `addLogSink`, exactly as the Infrastructure line
      says.

### Later or never, with the reasoning

- **Moderator dashboard:** later. The digest above covers the "nothing
  alerts" gap far more cheaply. Build the dashboard when flag volume makes SQL
  reading impractical, not before.
- **Flagging sightings and photos:** later. See the Flagging line; guideline
  1.2 is met.
- **The alert-radius step in onboarding:** never. See the Auth line.
- **DVLA, message reactions, offline sighting queue:** unchanged. Their
  reasons are already recorded in this file.

### One status document, not two (for `/tidy`)

- **What is wrong:** this file and BUILD_PLAN.md both track status, and they
  drift. Both said "user blocking does not exist" for three weeks after it
  shipped, and BUILD_PLAN went untouched from 2026-08-05 to 2026-09-25. This
  file is also mostly struck-through history, which `/catch-up` then has to
  read around.
- **Decided:** this file becomes the single status document.
- **For `/tidy` to do:**
  - cut this file down to the current truth
  - move the narrative history into the ADRs and the git log, where it
    already lives
  - reduce BUILD_PLAN.md to the order of work, with no status marks of its own
  - fix the smaller drift found on the way:
    - `telemetry.ts` and OPERATIONS.md still say 86 events; it is about 98
    - OPERATIONS.md and SECURITY_AND_TRUST §7 say nothing reads
      `bug_reports`, but `notify-bug-report` does
    - §7 lists sighting and photo flagging, which does not exist
    - the vehicles/post README says draft resume is not built, but it is
    - ADR-0015 ring-mark references remain in `app.config.ts` and
      `scripts/brand`
    - client branches on the retired `expired` status

## Cut or frozen by the 2026-08-05 product review

A review of the whole product (not the codebase) against the two core journeys.
Its finding in one line: **the loop is closer to done than this file reads, and
what stands between it and launchable is a blank feed, a spotter who cannot see
their own half, and no evidence from anyone but the author.** The six status
corrections above came out of the same pass. What follows are the subtractions —
taken first, deliberately.

- ~~**CUT: `devSampleImages`.**~~ **DONE 2026-08-06**, in the same commit that
  landed real photo data, exactly as this entry required. `samplePhotos()`
  returned ten Unsplash cars in `__DEV__` and `[]` in production, which is
  *why* the missing feed photos survived unnoticed: dev flattered us with a
  full feed while real users got placeholders. The module and all four call
  sites are gone; the feed can no longer lie to us.
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
- ~~**MERGE: two chip rows and two permission primers.**~~ **STRUCK by the
  2026-09-25 review, as decided-not-to rather than done.** Seven weeks on,
  neither merge happened, `QuickReplyRow`'s header argues (fairly) that one-tap
  actions and a selection are different jobs, and both pairs cost nothing to
  keep. A cut list that never gets cut is debt that only exists on paper.
  Original entry: `QuickReplyRow` duplicates `ChoiceChips` now that the latter
  has `role="button"` and `scrollable`; `PermissionPrimer` (shared) and
  `LocationPrimerCard` (search-map) are two anatomies for one job.

**Add nothing.** The review's honest answer to "what's missing" was *finish the
spotter's half and start measuring* — both already scoped below. Everything
else proposed failed the "why now rather than post-launch" test and is recorded
in the deferred list with its reasoning.

> ### One addition taken anyway: no-bounty listings (2026-08-20, ADR-0014)
>
> Recorded here rather than quietly folded into the Core-loop line above,
> because it **breaks the rule this section sets** and the next reader deserves
> to see that it was a decision and not a drift.
>
> **What:** a post can now be listed with no bounty for a fixed fee (**£4.99**
> as decided; **£5 since 2026-08-22**) instead of the 5% of an escrowed bounty
> (£50–£5,000 then; **£10–£5,000 since 2026-08-13**). Non-refundable; the spotter gets
> credit and reputation, not cash.
>
> **Why it did not wait for post-launch:** the £50 floor is a barrier at the
> *front* of the funnel, so beta data gathered without this option cannot
> measure what it costs us — every owner it turned away is invisible in the
> numbers. Ten testers on a £50 minimum tell us about the people who could
> afford £50. That is the one shape of question the "measure first" instruction
> cannot answer by waiting.
>
> **Honest cost:** it forks every money path in two, permanently (see the ADR's
> Consequences), and it landed six days before the 2026-08-26 beta. If the beta
> slips, this is a candidate cause and should be named as one rather than
> explained away.

## Loop integrity — two holes found by the 2026-08-05 loop trace

Distinct from the product review above: that asked "what should we add", and
answered *nothing*. This asked "does the loop close", and found two places
where it does not. Both are silent — nobody sees an error, the app just stops
having anything to say.

- ~~**THE ABANDONED POST.**~~ **PARTLY CLOSED 2026-09-02 (ADR-0019).** The ask
  shipped: a post active and unconfirmed for 14 days earns "is your {car} still
  missing?", re-asked every 7 days, capped at 3, sent by the hourly sweep that
  already exists. *Still missing* resets the clock; *I've found it* routes into
  the unchanged recovery flow. It moves no money and changes no status — the
  verification suite's load-bearing check is that `posts.status` and every
  `payments` row are untouched after a full cycle.
  ⚠️ **What is NOT closed:** the spotter's recourse. Dormancy — closing a silent
  post to new sightings — is deferred, with the analysis recorded in ADR-0019
  rather than re-litigated later: 95 sites select `status = 'active'`, which
  argues for a new enum value (exclusion by construction, the ADR-0018
  property), but `send_message` would freeze the chat to the very owner we are
  trying to reach and `plate_available` would release the plate of a car that is
  still missing. Deferred until the telemetry sink has counted how many owners
  actually go silent through all three asks. The original finding follows.
  Nothing in the system requires an owner to ever
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
- ~~**THE SILENT RUNNER-UP.**~~ **CLOSED 2026-08-05, and properly closed
  2026-08-06.** `claim_recovery` sets exactly one sighting to
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
  **The follow-up is the part worth reading.** The push shipped on 2026-08-05
  with a verification suite that `scripts/test-db.sh` never actually ran — the
  suite was written and then not wired into the runner. Adding the one line on
  2026-08-06 failed immediately: `claim_not_credited_notifications` deduped its
  AUDIENCE per person but stamped its CLAIM per row, so a spotter who filed two
  sightings kept an unclaimed one and a retry announced to them twice. Fixed in
  `20260806140000_not_credited_claim_all_sightings.sql` (claim every eligible
  row, dedupe with `jsonb_agg(distinct …)`). **A suite that is not in
  `test-db.sh` is not a test**, and this one caught a real double-push the day
  it was finally allowed to run.

## Beta target — 2026-08-26 (set by the 2026-08-05 review)

> ⚠️ **THE DATE PASSED. Recorded 2026-09-03, eight days late, because it was
> not recorded at the time — which the 2026-08-30 whole-app review called out
> as its single most important finding.** No beta has been run and no tester
> has seen the app.
>
> **Items 1 and 2 of the critical path below are DONE.** The telemetry sink
> registered on 2026-08-30; the dispute door landed 2026-09-01. Item 3 — "build
> and hand it to ten people" — has not started, and nothing technical is
> blocking it.
>
> What the last week actually went on, honestly: closing the review's findings.
> User blocking (ADR-0017), the £5 fee separation (ADR-0018), the abandoned-post
> liveness check (ADR-0019), the post↔vehicle link, make/model canonicalisation,
> withdrawing a sighting, and a run of test and hygiene work. All of it real,
> none of it item 3.
>
> The owner's stated position on 2026-08-31, kept here so it is not mistaken
> for drift: *"Nothing — I just want to keep building."* The beta is deferred
> by choice, not by a blocker. The remaining hard gates are Tier 0 and none of
> them is code: a domain, a mailbox, and `account.updated` enabled by hand in
> the Stripe dashboard.
>
> ---
>
> **2026-09-03 to 09-05 — four design passes, and this file said not to.**
> Recorded because the entry above exists to stop exactly this going unrecorded.
> Shipped: the onboarding carousel rebuilt against a Life360 reference (#90),
> dead share links removed (#91, a Tier 0 item), and a three-part WhatsApp
> structure pass over the chat thread and both inbox faces (#92–#94), plus the
> review fixes those needed (#95).
>
> ⚠️ **THE "NOT ON THE PATH" LIST BELOW NAMES THIS.** It reads: *"design passes
> on the five screens that have never had one — testers will point at the two
> that actually matter, and guessing at the other three is the trap a
> no-deadline project sets."* Chat and the inbox had both had a pass on
> 2026-08-28/29; these were second and third passes over the same screens.
> #91 is the only item of the six that was on any list.
>
> ⚠️ **AND THE PACE COST SOMETHING MEASURABLE.** Five PRs merged in 24 hours,
> only the first reviewed. The review that finally ran on 09-05 found, in work
> already live on the owner's device: the user's own message text at 3.49:1
> against a 4.5 floor while sending, "Seen" silently unavailable to screen
> readers, both inbox rows regressed at 200% type, and a test asserting a React
> Native default that passed while the thing it guarded was broken. The one pass
> that WAS reviewed pre-merge (#90) found three Criticals of the same kind. That
> is a rate, not bad luck.
>
> The onboarding funnel is the one thing here with evidence behind it: 1
> completed run against 6 skipped is what prompted #90. Nothing else in the four
> passes had a number.
>
> ⚠️ **ITEM 3 NEEDS A FRESH BUILD, NOT JUST AN OTA.** Discovered 2026-09-05: the
> newest preview APK embeds `e654c39` (29 Aug), so a new tester's FIRST LAUNCH
> runs that bundle — the old onboarding — and `onboarding_events` would record
> against the design #90 replaced. Onboarding runs once. An OTA cannot reach a
> first launch, because the first launch is what it has not reached yet. Build
> from `main` immediately before handing anything out.

Ten testers, one city, closed track. **Run it on Stripe TEST MODE**: testers use
test cards, the full escrow → recover → payout loop runs end to end, and no real
money is held. That single choice defers all three items that have been sitting
untouched — legal review of the escrow model, live-mode Stripe console setup,
and a hosted privacy policy — past the beta and into a pre-submission checklist,
because none of them binds until real money or a public store listing does.
(Closed internal-track testing is not review-gated on either store; **verify
against App Store Connect before relying on it.**)

The critical path, in order:

1. ~~**Feed photos in production**~~ — **DONE 2026-08-06**, see the Search item
   above. This was the "nothing else matters while it's broken" item; it is no
   longer broken, and item 2 is now the head of the path.
2. ~~**Spotter "My reports" surface + the dispute door**, then **one telemetry
   sink**~~ — **DONE.** The sink registered 2026-08-30 (86 events, not 70, and
   they no longer die in the Metro console); the dispute door landed
   2026-09-01, so `/sighting-dispute` is reachable without a push.
3. **Build and hand it to ten people.** Then stop and read what comes back
   before writing another line. ⚠️ **STILL THE HEAD OF THE PATH, and the only
   item on it.** Nothing technical blocks it.
   **Superseded 2026-09-25** by the seven-item path in "The 2026-09-25 product
   review" above. This is still the last item on that path; the path now also
   names the admin, the prod check, the funnel events and the walk that have to
   come before it.

NOT on the path, deliberately: ~~user blocking~~ (shipped 2026-09-01 anyway —
ADR-0017 — because it was the one true App Store submission blocker), the
moderator dashboard (a console is fine for ten testers, and OPERATIONS.md §1–5
is that console), and design
passes on the five screens that have never had one — testers will point at the
two that actually matter, and guessing at the other three is the trap a
no-deadline project sets.

## Explicitly NOT in v1 (do not build early)

- **Bounty splitting** across multiple spotters — single winner only.
- **Multi-region / multi-currency** — UK + GBP only. No i18n scaffolding.
- **Gallery-ONLY sightings** — every sighting requires ≥1 live in-app
  capture, permanently (anti-fraud). Gallery photos as labelled
  SUPPLEMENTARY evidence (ADR-0003, approved 2026-07-15) **shipped
  2026-08-01** in `20260801180000_sighting_photo_source.sql`. The gallery-only
  prohibition is what remains permanent, and `create_sighting` enforces it.
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
- ~~**Gallery photos as supplementary sighting evidence** (ADR-0003)~~ —
  **SHIPPED 2026-08-01**, `20260801180000_sighting_photo_source.sql`:
  `sighting_photos.source`, the ≥1-live-capture rule in `create_sighting`, and
  the rule that a gallery photo may carry NO lat/lng (payout blindness by
  construction). This entry said "nothing is built" for thirty-three days
  after it was, in the section whose job is to say what is not built.
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
verification-before-visibility** — live-on-payment (ADR-0007). Since
2026-09-25, the 5% service fee is charged on top of the reward, so the spotter
receives the reward in full (ADR-0020, amending ADR-0002's transfer math).
