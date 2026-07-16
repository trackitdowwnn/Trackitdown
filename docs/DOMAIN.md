# Domain — How Trackitdown Works (Plain English)

This is the business logic. When code and this document disagree, this
document wins — fix the code or update this doc deliberately.

## Actors

- **Owner** — person whose car was stolen. Creates a post, funds the bounty,
  confirms recovery.
- **Spotter** — any user who has enabled alerts. Sets their own alert radius,
  receives notifications about active posts within it, reports sightings.
- **Moderator** — internal admin. Reviews ownership verification, handles
  flagged content and disputes.
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
draft → pending_verification → active → recovery_claimed → recovered (paid)
            │                    │            │
            └─ rejected          └─ cancelled └─ recovered_no_spotter (refund)
                                 └─ expired (refund)
```

1. **draft** — owner fills in car details: make/model/colour (required — the
   car's identity), an optional UK number plate, photos, last-seen location and
   time, distinguishing features, and how the crime happened. **The plate is
   optional**: some owners don't have it (e.g. the thief swapped it). When a
   plate is given it's validated against UK formats and deduped (see below);
   when it's absent, make/model/colour identify the car and the UI shows those
   in place of a plate chip.
2. **pending_verification** — owner uploads proof of ownership (V5C logbook
   photo or equivalent) AND pays the bounty, which is held in escrow via
   Stripe. A moderator reviews the proof. **A post is never publicly visible
   before verification passes.** This is the anti-stalking safeguard: it
   prevents someone posting an ex-partner's or stranger's car to have the
   crowd track it.
3. **active** — post is live. Spotters whose alert radius covers the
   last-seen location get a push notification. The post appears in map/list
   search. Sightings can be reported.
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
8. **rejected** — verification failed. Bounty refunded in full where
   possible. Post never went public.

**Recovered-post visibility (social proof).** A post that reaches
`recovered` or `recovered_no_spotter` stays publicly visible for **30 days
after recovery** (e.g. the home feed's "Recently recovered" section), then
drops off all public surfaces. Enforced server-side by the feed RPCs via
`recovered_at`; ordinary public reads remain active-only under RLS.
(Approved 2026-07-11 with the home-feed feature.)

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
  map/feed RPCs (`get_posts_in_viewport`, `get_home_feed`, `get_nearby_posts`)
  MUST apply the same coarsening before any real driveway-theft post goes live,
  or the home leaks there — a hard blocker tracked with the posting flow.
- **Guided descriptions** — structured prompts ("how you'd recognise it",
  "how it drives / anything odd") replace the single free-text note for new
  posts; the legacy `owner_note` still renders for older posts.

All fields are nullable and captured by the posting wizard (not yet built);
the detail screen renders each only when present, so old posts never break.
(Approved 2026-07-13 with the post-detail content-density pass.)

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
