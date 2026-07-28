# Domain — How Trackitdown Works (Plain English)

This is the business logic. When code and this document disagree, this
document wins — fix the code or update this doc deliberately.

## Actors

- **Owner** — person whose car was stolen. Creates a post, funds the bounty,
  confirms recovery.
- **Spotter** — any user who has enabled alerts. Sets their own alert radius,
  receives notifications about active posts within it, reports sightings.
- **Moderator** — internal admin. Reviews new posts before they go public,
  handles flagged content and disputes.
- **Platform** — us. Takes a 5% fee from each paid bounty via Stripe Connect
  application fees.

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
draft → (pay) → active → recovery_claimed → recovered (paid)
                 │            │
                 ├─ cancelled └─ recovered_no_spotter (refund)
                 └─ expired (refund)
```

**LIVE-ON-PAYMENT.** A paid post goes straight to **`active`** (publicly live) —
there is no pre-publish review gate. For a stolen car the first hours are what
matter, so the crowd must be looking within minutes. The `pending_verification`
enum value still exists (and the deactivate/refund path still tolerates it) but
is **no longer entered** by the normal flow. See *Anti-abuse* below for what
replaces the old verification gate.

`cancelled` is reachable from a live (`active`) post — the owner can deactivate
it; the bounty is refunded (minus the non-recoverable card fee). A `draft`
(unpaid) is deleted/abandoned, not cancelled.

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
- **Escrow forfeiture.** A post taken down is `cancelled` and its £50–£5,000
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

## Bounty rules (v1 — deliberately simple)

- Minimum bounty: £50. Maximum: £5,000 (fraud ceiling — revisit later).
- **Single winner.** Exactly one sighting can be credited per recovery.
  No splitting in v1. If several spotters contributed, the owner picks the
  decisive one. (Splitting is a known v2 candidate; do not build it early.)
- The 5% platform fee is retained via **transfer math** — on recovery the
  platform transfers 95% of the bounty to the winning spotter under separate
  charges and transfers, keeping 5% — never calculated in the app client.
  (Not a Stripe `application_fee_amount`; see ADR-0002 for why.)
- Spotters must complete Stripe Connect onboarding (KYC) before a payout
  can be released. Prompt for this when their first sighting is credited,
  not at signup.
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
  (fed into reputation) — but only a credited sighting pays out.
- Rate limit: a spotter can report at most 3 sightings per post per day
  (a rolling 24-hour window, not a midnight reset).
- Every sighting screen and notification carries the safety line: report
  from a distance — never approach the vehicle or confront anyone. Call
  999 if a crime is in progress.

## Notifications

- Spotters set a personal alert radius (1–50 miles) and a home location
  (or "use current location"). Stored per user.
- When a post goes `active`, an Edge Function runs a PostGIS query:
  find users whose radius circle contains the post's last-seen point, and
  send them a push. Same when a post gets its first verified sighting in a
  new area ("the car may have moved").

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
  recoveries credited. Badges at simple thresholds (1 / 5 / 25).
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
  theft's last-seen point IS the victim's **home**, so `get_post_detail`
  coarsens that point to a ~1km grid for non-owners (the owner sees exact). The
  map/feed RPCs (`search_posts`, `get_home_feed`, `get_nearby_posts`)
  MUST apply the same coarsening before any real driveway-theft post goes live,
  or the home leaks there — a hard blocker tracked with the posting flow.
  (`search_posts` — which replaced `get_posts_in_viewport` — carries this
  obligation in its own SAFETY notes as the single coordinate-emitting search
  RPC.)
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
  status `active`, `pending_verification`, or `recovery_claimed`. The user
  must cancel the post or complete its recovery first. The client may
  pre-check to explain this kindly; the server check is the enforcement.

## Disputes

- If an owner refuses to credit an obviously decisive sighting, the spotter
  can raise a dispute; a moderator reviews the sighting trail and can
  credit a sighting on the owner's behalf. Log every moderator action.
