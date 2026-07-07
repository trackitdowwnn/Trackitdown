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

## The stolen-car post lifecycle

```
draft → pending_verification → active → recovery_claimed → recovered (paid)
            │                    │            │
            └─ rejected          └─ cancelled └─ recovered_no_spotter (refund)
                                 └─ expired (refund)
```

1. **draft** — owner fills in car details: UK number plate, make/model/colour,
   photos, last-seen location and time, distinguishing features, and the
   crime happened. Plate is validated against UK formats.
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

## Bounty rules (v1 — deliberately simple)

- Minimum bounty: £50. Maximum: £5,000 (fraud ceiling — revisit later).
- **Single winner.** Exactly one sighting can be credited per recovery.
  No splitting in v1. If several spotters contributed, the owner picks the
  decisive one. (Splitting is a known v2 candidate; do not build it early.)
- The 5% platform fee is taken as a Stripe Connect application fee at
  payout, never calculated in the app client.
- Spotters must complete Stripe Connect onboarding (KYC) before a payout
  can be released. Prompt for this when their first sighting is credited,
  not at signup.
- All amounts are stored in **pence (integer)**. Never floats for money.

## Sighting rules

- A sighting = photo(s) + auto-captured GPS location + timestamp + optional
  note. Location and time come from the device at capture; the photo must
  be taken in-app (no gallery uploads in v1) to resist fake/fabricated
  sightings.
- Sightings start as `unverified`. The owner can mark a sighting `helpful`
  (fed into reputation) — but only a credited sighting pays out.
- Rate limit: a spotter can report at most 3 sightings per post per day.
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
- Chat carries an automatic first message reminding both parties of the
  safety rules and that arranging meetups is discouraged.

## Reputation (v1)

- Counters on the profile: sightings reported, sightings marked helpful,
  recoveries credited. Badges at simple thresholds (1 / 5 / 25).
- Reputation never affects payouts in v1. It is social proof only.

## Disputes

- If an owner refuses to credit an obviously decisive sighting, the spotter
  can raise a dispute; a moderator reviews the sighting trail and can
  credit a sighting on the owner's behalf. Log every moderator action.
