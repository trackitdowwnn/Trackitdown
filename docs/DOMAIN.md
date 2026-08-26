# Domain — How Trackitdown Works (Plain English)

This is the business logic. When code and this document disagree, this
document wins — fix the code or update this doc deliberately.

## Actors

- **Owner** — person whose car was stolen. Creates a post, funds the bounty,
  confirms recovery.
- **Spotter** — any user who has enabled alerts. Sets their own alert radius,
  receives notifications about active posts within it, reports sightings.
- **Moderator** — internal admin. Handles flagged content and disputes.
  (No longer "reviews new posts before they go public" — ADR-0007 retired
  pre-publish review. Nothing moderator-facing is built at all; the only flag
  paths that exist are for a post and a message, and nothing consumes either.)
- **Platform** — us. Paid one of two ways, depending on how the post was listed
  (see *Listing pricing* below). On a **bounty listing** we retain 5% of the
  bounty: it is captured to our balance at posting and 95% is TRANSFERRED to the
  spotter on a credited recovery, so our 5% is simply the remainder that never
  leaves — it is **not** a Stripe `application_fee_amount`, which only exists for
  the destination charges we deliberately do not use (ADR-0002). On a
  **no-reward listing** we take a fixed £5 fee at posting and nothing else
  ever moves (ADR-0014). This line said "via Stripe Connect application fees"
  until 2026-08-03, and described only the bounty model until 2026-08-20.

## Accounts & sign-in

- **Guest-first (deferred auth).** Browsing is open: the feed, map, and active
  post details need no account (they read the anon-granted RPCs). Auth appears
  only as a bottom sheet at the moment an action needs an account — "Log in to
  report a sighting", never a generic wall — and the original action continues
  after sign-in without re-tapping. Dismissing the sheet is a graceful cancel.
  Sign-out lands in guest mode, not an auth wall.
  (Approved 2026-07-14 with the deferred-auth rework.)
- **Passwordless.** Sign-up and sign-in are one flow: an 8-digit email OTP, or
  native Apple / Google. No passwords, ever. There is no separate "create
  account" step — verifying the code (or completing a social sign-in) creates
  the account when it's new.
- **Profile on first sign-in.** A new user (no `profiles` row) completes a short
  profile inside the auth sheet: **first name is required** — it is the public
  identity shown to owners/spotters (see Reputation / Owner identity). A
  full/display name is optional and stays private (never shown; may hold a
  surname). Existing users go straight in.
- Session tokens are stored in the device keychain (expo-secure-store), not
  plaintext AsyncStorage (SECURITY_AND_TRUST.md §3).
- (Approved 2026-07-13 with the auth feature.)

## The stolen-car post lifecycle

```
BOUNTY listing:
draft → (pay) → active → recovery_claimed → recovered (paid)
                 │            │
                 ├─ cancelled └─ recovered_no_spotter (refund)
                 └─ expired (refund)

NO-REWARD listing (ADR-0014) — no money leg, so no waypoint:
draft → (pay fee) → active → recovered            (a sighting was credited)
                     │     └─ recovered_no_spotter (found another way)
                     └─ cancelled                  (no refund)
```

**LIVE-ON-PAYMENT.** A paid post goes straight to **`active`** (publicly live) —
there is no pre-publish review gate. For a stolen car the first hours are what
matter, so the crowd must be looking within minutes. The `pending_verification`
enum value still exists (and the deactivate/refund path still tolerates it) but
is **no longer entered** by the normal flow. See *Anti-abuse* below for what
replaces the old verification gate.

`cancelled` is reachable from a live (`active`) post — the owner can deactivate
it. On a bounty listing the bounty is refunded (minus the non-recoverable card
fee); on a no-reward listing **nothing is refunded** and the listing simply comes
down (ADR-0014). A `draft` (unpaid) is deleted/abandoned, not cancelled.

1. **draft** — owner fills in car details: make/model/colour (required — the
   car's identity), an optional UK number plate, photos, last-seen location and
   time, distinguishing features, and how the crime happened. **The plate is
   optional**: some owners don't have it (e.g. the thief swapped it). When a
   plate is given it's validated against UK formats and deduped (see below);
   when it's absent, make/model/colour identify the car and the UI shows those
   in place of a plate chip.
2. **pending_verification** — *retired state.* This was the pre-publish review
   gate (owner uploaded a V5C, a moderator checked ownership before the post
   went public). Both the V5C collection AND the gate were removed (product
   decision — see LIVE-ON-PAYMENT above): a paid post now goes straight to
   `active`. The enum value + the `verification-documents` bucket /
   `verification_documents` table / `update_post_verification` RPC remain in the
   schema but are dormant — nothing enters this state or writes those.
3. **active** — post is live. Reached directly on payment. Spotters whose alert
   radius covers the last-seen location get a push notification. The post
   appears in map/list search. Sightings can be reported.
4. **recovery_claimed** — the owner (or a moderator) marks the car as
   recovered. The owner is shown the list of verified sightings and selects
   the one that led to the recovery, or selects "none — recovered another
   way."
5. **recovered (paid)** — a sighting was credited. The Edge Function
   releases the escrowed bounty: **95% to the winning spotter, 5% platform
   fee.** Post closes. Spotter's reputation increments.
6. **recovered_no_spotter** — recovered without a credited sighting. Bounty
   is refunded to the owner (minus non-recoverable card processing costs,
   which the UI must disclose at posting time).
7. **cancelled / expired** — owner cancels, or the post hits its expiry
   (default 90 days, owner can renew). Bounty refunded as above.
8. **rejected** — *retired state* (was "pre-publish review failed"). With no
   pre-publish gate, nothing enters it; a live post that turns out to be
   abusive is **taken down** instead — set `cancelled` with the bounty refunded
   (the deactivate/refund path), see *Anti-abuse*.

### Anti-abuse (what replaces the verification gate)

Publishing on payment means abuse is handled **reactively**, not by a blocking
pre-check that would cost the critical first hours:

- **Accountability, not anonymity.** Every post is a real account + a card on
  file — posting is not free or anonymous, and it's traceable. That's the main
  deterrent for casual abuse.
- **Escrow forfeiture.** A post taken down is `cancelled` and its £10–£5,000
  bounty refunded — so a bad-faith poster ties up real money and gains nothing.
- **Report → flag → takedown.** The post detail's "Report this post" writes a
  durable, attributable row to `post_flags` (`flag_post` RPC; auth-gated, one
  per user/post). A moderator (tooling TBD) reviews flags and takes a post down
  via the deactivate/refund path. **No auto-hide on N reports** — on a stolen-car
  app that invites griefers to mass-report a *victim's* real post to bury it
  during the window that matters; takedown stays a deliberate action.
- **Deferred:** a moderator dashboard, per-account rate limits, and any
  proof-of-ownership re-introduction for edge cases (e.g. very high bounties).

**Recovered-post visibility (social proof).** A post that reaches
`recovered` or `recovered_no_spotter` stays publicly visible for **30 days
after recovery** (e.g. the home feed's "Recently recovered" section), then
drops off all public surfaces. Enforced server-side by the feed RPCs via
`recovered_at`; ordinary public reads remain active-only under RLS.
(Approved 2026-07-11 with the home-feed feature.)

**Owners never see their own post on the discovery surfaces.** The feed, its
"Near you" pagination, the map and the map's result count all exclude the
caller's own listings (`get_home_feed`, `get_nearby_posts`, `search_posts`,
`search_posts_count`, via `owner_id is distinct from auth.uid()` — `is
distinct from`, never `<>`, which would empty every surface for logged-out
browsers). The surfaces are for finding OTHER people's cars; an owner's own
listing there is noise, and a partial rule is worse than none — a post absent
from page 1 and back on page 2 reads as a glitch. Accepted cost: an owner
cannot find their own car on the map. Their own case is followed through the
post's OWNER-ONLY sighting trail, which is a different surface with its own
RPC and is unaffected. (Approved 2026-08-06; extended from feed-only to the
map the same day.)

**Search criteria are matched case-insensitively.** `search_posts` and
`search_posts_count` compare make/model/colour as `lower(btrim(...))` on both
sides, identically to `match_alert_zones` — search and alerts must never
disagree about what "a BMW" means. This is load-bearing because
`posts.make/model/colour` have no CHECK and no normalisation: the owner's typed
"bmw" must match the picker's canonical "BMW", or their stolen car is invisible
to the spotter who asked for exactly that car. (Regressed and repaired
2026-08-07; guarded by CHECK 22 in `home_feed_verification.sql`.)

**Watchlist visibility carve-out.** A user who watched a post while it was
public may learn its OUTCOME after it closes — watching a car and never
hearing it was found is the failure mode the watchlist exists to prevent:

- Recovered states: the watcher sees the normal public payload inside the
  same 30-day window as everyone else — no carve-out needed.
- `expired` / `cancelled` (not publicly readable): for 30 days after the
  transition, `get_my_watchlist` returns that watcher a **tombstone** —
  make, model, colour, status, transition date, first-photo thumbnail, and
  nothing else (explicitly no plate, bounty, or location: less than the
  post's own active-era public payload, so a tombstone can never be used to
  keep tracking the car). Hidden in-flight states (`recovery_claimed` etc.)
  are excluded entirely — a watched post passing through one briefly leaves
  the list.
- A watch is the watcher's business: **no owner-facing surface ever exposes
  watcher rows, counts, or existence**, and any future watched-post
  notification payload carries post context only — never other watchers.

(Approved 2026-07-22 with the watchlist feature; enforced server-side in
`get_my_watchlist`, SECURITY DEFINER.)

**Collections (named lists).** A watcher can file saved cars into their own named
collections — "My commute", "Near work" — so the list matches where they actually
travel. Airbnb's wishlist mechanics, translated:

- **A saved post belongs to at most ONE collection.** Not a tagging system. Moving
  it between collections is a move, never a copy.
- Saving is **never blocked by a choice**: the bookmark saves instantly to the
  collection last used, and the confirmation offers to change it afterwards.
- Cars not filed anywhere sit in an implicit **"Saved"** bucket. That bucket is not
  a real list: it cannot be renamed or deleted, and it is how every pre-existing
  watch continues to appear.
- **Deleting a collection never deletes the cars in it** — they return to "Saved".
- Cap: 20 collections per user.
- **A collection is private user metadata.** Its name is free text the user wrote
  and is subject to the same rule as the watch itself: no surface outside the
  owner's own session ever exposes a collection, its name, its contents or its
  existence, and names never reach logs (same rule as `vehicles.nickname`).
- **Sharing and collaborators are OUT — permanently, not deferred.** Airbnb's
  wishlists can be shared; ours cannot. A shared list of stolen cars someone is
  watching is a stalking surface, and it would collide head-on with the
  no-watcher-exposure rule above.

(Approved 2026-07-27 with the collections feature.)

## Listing pricing — two modes (ADR-0014, 2026-08-20)

Every post is paid for at posting time, one of two ways. **Which one is not a
flag: it is which of two money columns is populated**, and the database enforces
that exactly one is (`num_nonnulls(bounty_amount_pence, listing_fee_pence) = 1`).
A post with both would be charged twice; one with neither would be live for free.

| | **Bounty listing** | **No-reward listing** |
|---|---|---|
| Owner pays | £10–£5,000, escrowed | **£5 fixed fee**, once |
| Platform keeps | 5% of the bounty, on recovery | the whole fee, on capture |
| Spotter gets | 95% of the bounty | **credit + reputation only** |
| Refundable? | yes, minus the card fee | **no** |
| Ledger state | `requires_payment → held → released \| refunded` | `requires_payment → collected` (terminal) |

**Why a listing fee exists at all:** £50, the floor before 2026-08-13, was the price of admission for a theft
victim, at the moment they can least afford it and in the hours that matter
most. Free posting was never the alternative — the card on file is the main
anti-abuse deterrent left now that pre-publish review is gone (see *Anti-abuse*).

Rules that follow, and are not implementation details:

- **A listing fee never enters `held`.** Every refund and payout path looks for
  `held`, so a fee is invisible to all of them by construction. The mirror
  matters more: an escrowed bounty wrongly marked `collected` would vanish from
  every refund path — the owner's money silently kept — so the guard runs in
  both directions.
- **The fee is not refundable, and a no-reward listing sits OUTSIDE the
  refund-hold and dispute machinery.** Those exist to stop an owner denying a
  spotter the bounty they earned; with no bounty there is nothing to deny.
  Taking one down delists it immediately, with no 72-hour hold. The
  non-refundability is disclosed on the pricing step, before any money moves.
- **A no-reward post closes TERMINALLY on claim** — straight to `recovered` /
  `recovered_no_spotter`, never through `recovery_claimed`. That waypoint exists
  only because a money leg follows; without one the post would park there
  forever waiting on a payout that never comes, which would also permanently
  block the owner from deleting their account.
- **The spotter still gets credited.** One sighting, `recoveries_credited`
  increments, no money moves. On a no-reward listing that recognition IS the
  reward, and the listing says so plainly rather than leaving anyone to hope.
  - ⚠️ **KNOWN GAP — the credited spotter is not TOLD (2026-08-20).** The
    credited-spotter notification is a money push ("You've earned £X", routed to
    /payouts) and `claim_credited_notification` reads the amount from a
    `held`/`released` payment, so it correctly refuses to invent a number for a
    `collected` fee. It is therefore not called at all on these listings — and
    because it consumes the one-shot `credited_notified_at` claim BEFORE that
    check, calling it would burn the claim permanently and still send nothing.
    So the spotter learns they were credited only by opening the app. **This is
    also an exception to the persist-then-push rule (ADR-0012): no
    `notifications` row is written either, so the Inbox is silent too.**
    It matters more than a missing push normally would, because "recognition is
    the reward" is the whole basis for keeping these listings outside the
    ADR-0011 dispute machinery — a reward that is never delivered does not carry
    that argument. Closing it needs a non-money credited push (its own kind,
    copy, and a `claim_credited_notification` branch that only claims once the
    copy can be built). Deliberately not smuggled into the pricing change.
- **Fully visible everywhere**, with two ranking carve-outs: a **minimum-bounty
  alert never matches one** (`NULL >= n` is unknown — never `coalesce(…, 0)`
  it, which would make every no-reward post match every alert), and the
  **"Highest bounties nearby" carousel excludes them** (Postgres sorts NULLs
  FIRST under `DESC`, so they would otherwise head a section named for the thing
  they lack).
- **NULL, never 0.** A no-reward post's bounty is NULL end-to-end. A 0 renders
  as "£0 bounty" on every card and pin; the nullability is what makes the type
  system stop at each read site. Cards read **"No reward"**.
- The price lives in ONE place, `current_listing_fee_pence()`, and is
  **snapshotted onto the post** at creation — changing it never re-prices an
  existing draft. The client never sends a fee.

## Bounty rules (v1 — deliberately simple)

*(These govern a BOUNTY listing. A no-reward listing has none of them — see
"Listing pricing" above.)*

- Minimum bounty: £10 (lowered from £50 on 2026-08-13). Maximum: £5,000
  (fraud ceiling — revisit later).
- **Single winner.** Exactly one sighting can be credited per recovery.
  No splitting in v1. If several spotters contributed, the owner picks the
  decisive one. (Splitting is a known v2 candidate; do not build it early.)
- The 5% platform fee is retained via **transfer math** — on recovery the
  platform transfers 95% of the bounty to the winning spotter under separate
  charges and transfers, keeping 5% — never calculated in the app client.
  (Not a Stripe `application_fee_amount`; see ADR-0002 for why.)
- Spotters must complete Stripe Connect onboarding (KYC) before a payout
  can be released. Prompt for this when their first sighting is credited,
  not at signup — the "you've earned £X" moment is the entry point, and the
  highest-motivation form a user will ever fill.
- **Payout account model (decided 2026-08-03, ADR-0010):** payee accounts are
  Accounts v2 `recipient` configuration with **no Stripe dashboard** — we
  collect name, date of birth, address and bank details in **our own native
  UI**, tokenised client-side so nothing sensitive ever touches our server.
  Consequences that are DOMAIN rules, not implementation details:
  - **We are the requirements collector.** "Stripe needs more information" is a
    state our UI owns, and re-collection at least every six months is our
    recurring obligation.
  - **Risk/liveness step-ups always fall back to a Stripe surface** — that is
    Stripe's rule under every account model, not a gap in ours.
  - **Payouts release automatically** once the recipient capability is active
    and a credited post is waiting — but auto-release exists ONLY behind the
    collusion check (SECURITY_AND_TRUST §5). A webhook that moves money does
    not ship before the check that stops an owner crediting themselves.
  - Our tables store the Stripe account id and status only. Bank and identity
    data: never stored, never logged, never transiting our functions.
- All amounts are stored in **pence (integer)**. Never floats for money.

## Sighting rules

- A sighting = photo(s) + auto-captured GPS location + timestamp + optional
  note. Location and time come from the device at capture; **at least one
  photo must be a live in-app capture** — that capture is the evidence a
  spotter was actually there, and the only photos that carry location/time
  evidence weight.
- **Gallery photos: supplementary only (ADR-0003, approved 2026-07-15;
  build pending — the app is camera-only until it ships).** A spotter who
  photographed the car before opening the app may attach gallery photos as
  context, but: the ≥1-live-capture rule is enforced server-side in
  `create_sighting`; every photo carries a `source` flag; gallery photos are
  labelled "added from photo library" to the owner; and credit/payout
  decisions lean on live evidence only. Gallery-ONLY sightings are rejected
  — that is a permanent rule, not a v1 scope cut.
- **GPS unavailable ≠ blocked.** If location permission is denied or a fix
  fails at capture, the sighting still proceeds and is marked
  `location_unavailable` (shown honestly to the owner) — a photo without GPS
  is still valuable. Poor-accuracy fixes are recorded with their accuracy
  value, never rejected. Each photo carries only its OWN capture-moment fix —
  never a borrowed one. (Approved 2026-07-14 with the sightings feature.)
- Sightings start as `unverified`. The owner can mark a sighting `helpful`
  (fed into reputation) — but only a credited sighting pays out. Marking
  helpful is server-side (`mark_sighting_helpful`, owner-of-post only,
  `unverified → helpful` exclusively): a `credited` sighting is a payout
  record and never re-labels; re-marking an already-helpful sighting is an
  idempotent no-op, so the spotter's counter can only ever bump once per
  sighting. (Live 2026-07-29 with the timeline feature.)
- **Public sighting entries (ADR-0008, map grain ADR-0009).** An active post
  shows everyone its five most recent sightings as time + coarse locality
  ("Sighted near Holloway · 5h ago") plus a count of the rest — and, since
  ADR-0009 (2026-07-30), a trail map drawn from `snap_lat`/`snap_lng`:
  each point rounded SERVER-side to a 0.01° (~1 km) grid before it leaves
  the database. Everything else about a sighting — photos, exact location,
  spotter, notes — is owner-only (the owner's own map uses their exact
  payload). The locality is its own column, captured at report time at
  district/city grain; the street-level `area_label` never appears
  publicly. Closed posts show none. (Approved 2026-07-29 / 2026-07-30.)
- **Structured context (all optional, all taps — approved 2026-07-29).**
  Beyond the photo, a report may carry: a vehicle STATE (parked / driving /
  being loaded-towed — mutually exclusive; the towed case flips the urgency
  calculus), a parked follow-up (`parked_likelihood`: settled / street /
  moving — the spotter's one-tap judgement of how fast the owner must act),
  a driving follow-up (`direction`: 8-way compass heading), condition chips
  (plate changed-missing / damage visible / being stripped / looks intact),
  a 3-way people observation (`people_presence`: nobody / nearby /
  in_vehicle — supersedes the `people_nearby` flag for new reports; the
  in-vehicle case reinforces the don't-approach register inline), and
  confirmed distinctive marks (`confirmed_feature_ids` — the post's
  registered marks the spotter ticked "could you see…?"; ids validated
  server-side against that post's marks). Every field is skippable: an
  empty context step is a valid report, and the free-text note stays the
  catch-all. Nothing here is ever public — structured context is owner-only
  like the note (ADR-0008 unchanged).
- Rate limit: a spotter can report at most 3 sightings per post per day
  (a rolling 24-hour window, not a midnight reset).
- Every sighting screen and notification carries the safety line: report
  from a distance — never approach the vehicle or confront anyone. Call
  999 if a crime is in progress.

## Notifications

- **THE PERSIST-THEN-PUSH RULE (2026-08-06, ADR-0012):** every
  notification-worthy event writes a `notifications` row FIRST and then maybe
  sends the push — one utility (`notifyUsers`), so the in-app notification
  center (the Inbox tab's second face) and the pushes can never disagree, and
  users without push permission still receive everything in-app. Chat
  messages are the ONE exclusion: the Messages segment is their persistent
  surface. Rows carry the copy that was true at write time plus the exact
  typed payload; retention is 90 days (pg_cron); unread is the user's to
  clear — nothing auto-marks-read except tapping the row or its push.
- **PER-CATEGORY PUSH PREFERENCES (2026-08-24):** five mutable categories —
  alerts, messages, my_sightings, money, watched — stored in
  `notification_preferences` and toggled from Settings. ⚠️ They filter the
  PUSH ONLY. The `notifications` row is still written for every recipient, so
  muting a category costs the interruption and never the information; the
  filter lives in `_shared/push.ts`'s send half, on the far side of
  persist-then-push. Two kinds are deliberately NOT mutable and have no
  category at all: `sighting` (someone has seen your stolen car — the one
  notification this product exists to deliver) and `closed_uncredited` (the
  72-hour contest window, whose push is currently the only door to
  `/sighting-dispute`). An unclassified future kind defaults to being
  delivered, never to being dropped.
- Spotters create up to **5 named alerts** (`MAX_ALERTS_PER_USER`), each a
  location + radius (1–50 miles), built through a short wizard. Every alert can
  be paused without discarding it.
- **The wizard opens by asking what the alert should match on** — an area, a
  specific car, a minimum bounty — and then asks only the questions those ticks
  imply, so "anything near home" is a two-screen task. **The area is mandatory
  and shown as a LOCKED choice, not hidden**: an alert with no location is not
  something this product offers, because a spotter can only act on a car near
  them. What is saved is reduced through those ticks, so unticking a card
  always widens the alert rather than leaving a filter the user believes they
  removed.
- **An alert may be narrowed by the car**: make, model, colour, body type, a
  minimum bounty, and how recently the car was last seen. Every criterion is
  optional and independent — all unset means "any car", which is what a v1
  alert was. Criteria are matched **case-insensitively** (`lower(btrim(...))`),
  because posts store whatever the owner typed.
  - The pickers offer only canonical values, never free text: a free-typed
    "beemer" would create an alert that silently matches nothing, which is
    worse than no alert because the spotter believes they are covered.
  - Known limit: case-folding does not equate `VW` with `Volkswagen`, or
    `Golf` with `Golf GTI`. The real fix is normalising make/model/colour on
    write — not yet done.
  - **Recency filters `last_seen_at`, not post age.** It correctly excludes
    reports of older thefts, but most reports are recent, so it narrows less
    than it appears to. The UI says so.
- **The stored point is coarsened by default.** The "use approximate area
  only" toggle is ON unless the user turns it off, and the server snaps the
  point to a ~1km grid **before storing it**, so the database never holds a
  home address. The RPC returns the stored point, not the submitted one.
- When a post goes `active`, an Edge Function runs a PostGIS `ST_DWithin`
  query: find users whose radius circle contains the post's last-seen point,
  and send them a push. **The post's own owner is excluded.**
- **Volume: at most 3 alert pushes per user per rolling 24 hours**, and never
  twice for the same post. Overflow is dropped silently, not queued — a late
  stolen-car alert is worth little, and the post is visible in Explore and on
  the map regardless. Alert fatigue is the asymmetric risk.
  - **The cap is PER USER, not per alert.** Five alerts that all match one post
    still produce exactly one push: the matcher selects distinct users and
    dedups on `push_sends(user_id, kind, subject_id)`. Adding alerts can never
    increase how often someone is interrupted — only how well-targeted those
    interruptions are.
  - Known limit: slots are first-come, so a broad catch-all alert can spend the
    day's budget before a narrow high-value one matches. There is no priority
    ordering between a user's own alerts.
- **Payload**: make + colour + a **district-grain** locality
  (`posts.last_seen_locality`), plus the don't-approach clause. Never the
  plate, never coordinates, and never `posts.last_seen_area` — that column is
  the raw reverse-geocoded label and can be street-grain.
- **Re-alerts on a new sighting ("the car may have moved") are NOT in v1.**
  They scale with reporter count rather than with genuine movement, so a busy
  post in a dense area would spam every zone around it. See ROADMAP.md v2
  candidate #4 ("smart re-alerts based on sighting chains"), which owns this.

## Chat

- A chat thread opens between owner and a spotter only after that spotter
  has reported a sighting on the owner's post. No cold DMs.
- One thread per (post, spotter) pair. When the post leaves `active`
  (recovered/expired/removed), its threads become READ-ONLY: history stays
  visible to both participants, new sends are rejected server-side.
  (Approved 2026-07-15 with the chat feature.)
- Chat carries an automatic first message reminding both parties of the
  safety rules and that arranging meetups is discouraged.

## Reputation (v1)

- Counters on the profile: sightings reported, sightings marked helpful,
  recoveries credited.
- **Points and badges (revised 2026-08-26).** A spotter's POINTS are
  `sightings_helpful` — one for each sighting an owner confirmed, capped at one
  per listing (see the anti-farming note below). Badges are a single ladder on
  that counter at **1 / 3 / 10 / 25**. Reported sightings and credited
  recoveries remain counters and stats but no longer earn badges: reporting is
  something you do, a confirmation is something an owner did about it.
  ⚠️ The ladder is written in three places — `reputation.ts`,
  `mark_sighting_helpful` (which rung a confirmation crossed) and
  `claim_sighting_confirmed_notification` (the words in the push). They must
  move together; `supabase/tests/badgeThresholds.test.ts` fails if they drift.
- ⚠️ **Trusted spotter stays at 1 recovery AND 5 helpful, and did NOT move with
  the badge ladder.** `20260814120000_reputation_one_point_per_listing` priced
  the cheapest farm against that five. Badges are display-only; the trusted
  marker is the one owners weigh.
- Reputation never affects payouts in v1. It is social proof only.
- **Trusted spotter** (the headline trust marker, shown with the identity on
  own and public profiles — as the avatar-corner check on your own, as the
  labelled pill on the public passport): at least 1 recovery credited AND at
  least 5 sightings marked helpful. Derived from the server-maintained
  counters — never stored or set directly, so it cannot be forged client-side.
- What an owner may see about a spotter: first name, avatar, reputation
  counters/badges, trusted-spotter status, member-since. Nothing else — no
  surname, location, or contact details (see SECURITY_AND_TRUST.md §1).

## Owner identity on a post

- A stolen-car post shows a limited owner-identity block (the trust anchor).
  The owner is a theft **victim**, not a public host, so it is gated:
  - **Signed-in viewers** see the owner's first name and member-since (an
    initial-letter avatar, no photo).
  - **Anonymous viewers** (logged-out browse of an active post) see a
    de-identified "Verified owner" — member-since only, no name.
- Never exposed to anyone: surname / `display_name`, email, the owner's other
  posts, precise location, `owner_id`, or any contact path (chat opens only
  after a sighting — see Chat). **No avatar photo**: the avatar path is pinned
  to `<owner_id>/…`, so serving it would leak `owner_id` (and, via the
  permissive `profiles` read policy, the surname) — restoring the photo needs
  the profiles read path hardened first. Member-since is coarsened to the
  month. Enforced server-side in `get_post_detail` (SECURITY_AND_TRUST.md §6).
  (Approved 2026-07-13 with the post-detail content-density pass.)

## Post content — structured fields (v1)

A post carries structured, spotter-useful data beyond make/model/plate:

- **Distinguishing features** — a curated, checkable taxonomy ("amenities"):
  dents, roof rack, tow bar, tinted windows, aftermarket alloys, private plate,
  dashcam, modified exhaust, etc. The canonical list is the `vehicle_feature`
  table (key + label + category + icon); a post's selections live in
  `post_feature`. Keyed so the same taxonomy powers **search filters** later.
  Free-text `distinguishing_features` stays for posts that predate the taxonomy.
- **Theft context** — `stolen_from` (driveway / street / car_park / other) and
  `keys_taken` (yes / no / unknown). "Keys taken" is a real signal (a car with
  its keys is likely being driven, not stripped). **SAFETY**: a `driveway`
  theft's last-seen point IS the victim's **home**, so it is coarsened to a
  ~1km grid for non-owners (the owner sees exact). Only TWO RPCs emit
  coordinates and both snap: `get_post_detail` (20260713180000) and — **since
  2026-08-10** — `search_posts` (20260810160000), which was a live leak rather
  than a latent one, since posts go straight to `active` on payment.
  `search_posts` needs no owner branch, unlike `get_post_detail`, because it
  never returns the caller's own posts. `get_home_feed` and `get_nearby_posts`
  need no snap: they return `home_feed_post_json` only, which carries
  `last_seen_area` and a distance but no coordinates. (`get_home_feed`'s own
  `ST_SnapToGrid` is a different rule for a different status — it withholds a
  **recovered** post's precise point.)
  Two indirect routes to the same address were found and closed in the same
  week, both of which survived the pin being snapped: the search RPCs MATCHED
  on the unsnapped point while emitting a snapped one, making the bbox a
  bisection oracle (closed 20260810200000), and feed `distance_miles` was
  measured from the exact point, making it trilaterable (closed
  20260811100000). The lesson is in `post_pin_geog`: a coarsened point is only
  coarse if everything — membership, distance and emission — reads the same
  one. See SECURITY_AND_TRUST §2.
- **Guided descriptions** — structured prompts ("how you'd recognise it",
  "how it drives / anything odd") replace the single free-text note for new
  posts; the legacy `owner_note` still renders for older posts.

All fields are nullable and captured by the posting wizard (not yet built);
the detail screen renders each only when present, so old posts never break.
(Approved 2026-07-13 with the post-detail content-density pass.)

## Garage (saved vehicles)

A user can pre-register their own cars so that reporting one stolen takes
seconds instead of minutes. A saved vehicle is **not a post**: it is private,
unpublished, unsearchable, and carries no money or lifecycle state.

- **Cap: 5 vehicles per account.** Server-enforced (`VEHICLE_LIMIT_REACHED`);
  the client explains rather than failing at submit.
- **Everything except make/model/colour is optional** — including the plate and
  the photos. Adding a car has to stay a 60-second job or nobody does it, and a
  half-filled saved car is still worth more than none. Posting re-imposes its
  own 3–6 photo minimum, so a sparse car is never posted short: the prefilled
  wizard keeps the real photos step.
- **A post SNAPSHOTS the vehicle; it never references it.** Posting from the
  garage copies the car's details onto the post (posts already store make /
  model / colour / year / body type / plate denormalised, with their own photo
  and distinctive-feature rows). `posts.vehicle_id` is provenance only —
  nothing reads it for display, and it is `ON DELETE SET NULL`. Editing or
  deleting a saved car a year later therefore CANNOT alter or orphan a
  historical recovery record. This is a hard rule, asserted by CHECK 4 of
  `supabase/tests/garage_verification.sql`.
- **NOT YET WIRED — the post↔vehicle link.** The intent is that a car with a
  live post shows as "Currently reported stolen" in the garage, its report
  action replaced by a link to the listing, and that it cannot be removed until
  that listing closes. The server side exists (`posts.vehicle_id`,
  `is_currently_posted`, `VEHICLE_HAS_ACTIVE_POST`) and the UI renders it, but
  **nothing writes `posts.vehicle_id` yet**: `create_post` has no `p_vehicle_id`
  parameter, and the posting client still sends `p_plate: null` (plate capture
  was removed from the wizard on 2026-07-24). So today `is_currently_posted` is
  always false, that UI never appears, and one-active-post-per-plate stays
  dormant on every path. Closing this needs a `create_post` migration plus the
  plate plumbed through `buildCreatePostParams` — tracked in
  `src/features/garage/README.md`.
- **No ownership verification.** The garage deliberately does NOT collect a V5C:
  it would buy no time (a paid post is already live instantly) and would require
  the moderator queue, which does not exist. `vehicles.verification_state` is a
  reserved column that nothing writes. See SECURITY_AND_TRUST.md §2's open gap.
- **Privacy:** a saved vehicle is owner-only and is deleted with the vehicle or
  the account (SECURITY_AND_TRUST.md §3).

(Approved 2026-07-27 with the garage feature.)

## Account deletion

- Users can delete their account in-app (App Store requirement). Deletion
  is server-side (Edge Function) per SECURITY_AND_TRUST.md retention rules.
- Deletion is BLOCKED while any of the user's posts has money in escrow —
  status `active`, `pending_verification` (a retired state, still listed so a
  legacy row cannot slip through), or `recovery_claimed`. The user must cancel
  the post or complete its recovery first. The client may pre-check to explain
  this kindly; the server check is the enforcement.
- **Known over-reach since 2026-08-20 (ADR-0014), left deliberately:** the block
  is written as "money in escrow" but tests STATUS, so a live **no-reward**
  listing blocks deletion too — and it holds no escrow at all. Left as-is
  because the conservative direction is the safe one (a live listing for a
  stolen car outliving its owner's account is worse than an extra step), and
  because the owner can always take it down first. Narrow it only deliberately.
- ~~⚠️ **Known trap (2026-08-03):** "complete its recovery" is currently
  impossible for the credited-spotter branch.~~ **Closed 2026-08-03**, later
  the same day: `release-payout` is called when a spotter is credited, and
  again from the post's manage sheet ("Send the bounty") for the normal case
  where they had not yet set up payouts. A `recovery_claimed` post can now
  reach `recovered`, so the account-deletion block clears with it.
  Residual, and honest: the post stays in `recovery_claimed` for as long as the
  spotter takes to onboard, because **nothing re-runs the payout when they
  become payable** — the owner sends it. An owner who never returns leaves the
  bounty in escrow and their own account undeletable.

## Disputes

Built 2026-08-05 (ADR-0011). The owner-denial control — what stops an owner
whose car a spotter found from taking the bounty back with one tap:

- **The trigger** (one SQL definition, `recent_uncredited_sightings`): an
  uncredited sighting reported within 14 days of the exit attempt. Older
  sightings never hold up an honest owner's refund.
- **The attestation**: both refund exits (deactivate, "found it another way")
  refuse to proceed until the owner has been shown exactly those sightings
  and confirmed "none of these led me to the car". The confirmation and the
  sighting ids shown are recorded on the hold. The other button — "one of
  these did help" — routes to the crediting flow.
- **The hold**: the listing comes down immediately, but the refund WAITS 72
  hours (`refund_holds`). Every recent spotter gets the `closed_uncredited`
  push and may file ONE dispute per sighting (`open_dispute`, no-oracle: every
  refusal is the same answer). An open or upheld dispute blocks the refund.
- **Resolution is a person** (v1): the founder reads the sighting trail —
  capture-GPS photos, timestamps, retained chat — and runs
  `resolve_sighting_dispute` by hand (service role; every action is a row).
  Upheld: the sighting is credited on the owner's behalf (the post returns to
  `recovery_claimed` and the normal payout machinery pays the spotter, 95/5,
  collusion gate and all); sibling disputes auto-reject. Rejected or
  unclaimed: the hourly `release-held-refunds` sweep sends the owner's refund
  once the window passes.
- Spotters learn the outcome by push (`dispute_upheld` / `dispute_rejected`)
  and on the dispute screen. Rejection is final and deliberately unexplained —
  the evidence was weighed by a person, and reasons become argument surfaces.

There is still no passive expiry: nothing refunds by waiting. Every refund is
an affirmative act, and now every affirmative act with recent sightings on the
table is attested, delayed, and contestable.
