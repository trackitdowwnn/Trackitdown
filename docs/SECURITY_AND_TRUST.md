# Security & Trust

Trackitdown handles money, precise locations, identity documents, and a
crowd pointed at physical vehicles. These rules are product requirements,
not suggestions. Code enforcing them is marked `// SAFETY:` per the
commenting standards.

## 1. User safety — "report, don't approach"

- Every sighting flow, alert notification, and chat thread displays the
  SafetyNotice component: **report from a distance; never approach the
  vehicle, follow it, or confront anyone; if a crime is in progress call
  999.**
- We never build features that facilitate pursuit: no live navigation
  toward a sighted car, no "car is moving" live tracking, no directions
  from spotter to vehicle.
- Sighting locations shown to owners are exact; the *spotter's* identity
  shows as first name + reputation only.
- Terms of service must state that bounties reward information leading to
  recovery, and that recovery itself is for the owner and police.

## 2. Anti-stalking

> **CHANGED 2026-07-30 (live-on-payment).** This section previously read "No
> post is publicly visible before ownership verification passes." That is no
> longer true and had not been updated: the pre-publish review gate and the V5C
> proof-of-ownership upload were both removed so a stolen-car post goes live
> within minutes rather than after a moderator queue. What follows describes the
> controls that actually exist. The **open gap** is named explicitly below —
> it is not resolved, and it should not be lost again.

- A paid post is **publicly visible immediately**, with no human pre-check
  (`draft → active` on payment). Anti-stalking therefore rests on
  accountability and reaction, not prevention:
  - **Not anonymous, not free.** Every post is a real account with a card on
    file and a £50–£5,000 bounty in escrow. Posting to track a person costs
    money and is traceable to a payment instrument.
  - **Report → flag → takedown.** `post_flags` captures durable, attributable
    reports (`flag_post`); a moderator takes a post down via the
    deactivate/refund path. No auto-hide on N reports — that would let griefers
    bury a victim's real post during the hours that matter.
  - **Location coarsening.** A `driveway` theft's last-seen point is the
    victim's home, so it is coarsened to ~1km for non-owners (§6, DOMAIN.md).
- **OPEN GAP — no ownership check exists anywhere.** Nothing verifies that the
  poster owns the car. The `verification_documents` table, the private
  `verification-documents` bucket and `update_post_verification` remain in the
  schema but are dormant; no client writes them and there is **no moderator
  tooling at all**. Re-introducing a check (for high bounties, repeat posters,
  or in the garage at save time) is deferred and needs the moderation queue
  first. Any future document storage keeps the original rule: private bucket,
  uploader + moderators only, deleted 30 days after the post closes.
- **OPEN GAP — one active post per plate is DORMANT on every path.**
  `create_post` still raises `PLATE_IN_USE`, but it can never fire: plate
  capture was removed from the posting wizard on 2026-07-24 and the client sends
  `p_plate: null`. The garage collects a plate again and is *intended* to prefill
  it, but that link is **not wired** — `create_post` takes no vehicle id and the
  garage's plate is dropped on the way into the post (DOMAIN.md, "Garage"). So
  nothing currently prevents the same car being posted repeatedly, and the V5C
  check that was once the backstop for plate-less duplicates no longer exists
  either. Closing this needs the `create_post` follow-up migration.

## 3. Data protection (UK GDPR)

- Number plates, locations, and V5C documents are personal data. Collect
  the minimum, state the purpose in the privacy policy, honour deletion
  requests.
- **Saved vehicles (the garage) — cars that were never stolen.** The garage
  holds plates and photos for vehicles nobody has reported, which is a wider
  collection than posts alone. Therefore:
  - A saved vehicle is visible **only to its owner**. No RPC, feed, search or
    post surface exposes another user's garage; `list_my_vehicles` gates on
    `auth.uid()` and `anon` holds no grant on `vehicles` at all. Absence is
    asserted for both anon and a different signed-in user
    (`supabase/tests/garage_verification.sql` CHECK 6).
  - Plate uniqueness in the garage is **per user**, never global — a global
    index would answer "does anyone else have this plate saved?", which is an
    oracle over other people's garages.
  - Garage **rows** are deleted with the vehicle and cascade on account deletion
    (`vehicles.user_id → profiles ON DELETE CASCADE`). They are NOT subject to
    the 30-day post-closure rule, which governs post artefacts: a saved car has
    no closure event.
  - **OPEN GAP — storage objects are NOT deleted.** `delete_vehicle` removes
    rows only; the JPEGs stay in the public `post-photos` bucket and remain
    reachable by URL indefinitely. `update_vehicle` orphans replaced photos the
    same way, and no account-deletion Edge Function exists to trigger the
    cascade in the first place. This is a UK GDPR erasure gap on personal data,
    not merely doc drift. Any fix must first check `post_photos.url` /
    `post_distinctive_feature.photo_url` for the same object: the garage and
    posts deliberately SHARE objects, so deleting one blindly would blank the
    hero image of a live stolen-car listing.
  - Deleting a saved car never touches a post made from it — posts hold their
    own snapshot (DOMAIN.md, "Garage").
- Auth is passwordless (email OTP + Apple/Google — DOMAIN.md). Session tokens
  (access + refresh) are stored in the OS keychain via expo-secure-store,
  encrypted at rest — never in plaintext AsyncStorage. Emails are personal data:
  never logged in full (redactEmail).
- Spotter GPS is captured **only** at the moment of reporting a sighting —
  no background location tracking anywhere in the app.
- Closed posts are hidden from search; their sighting location history is
  purged after 90 days.
- Photos are stripped of EXIF metadata server-side before display; the
  original capture location is kept only in the sighting record itself.

## 4. Payments (Stripe Connect)

- The client app **never** touches amounts, fees, or payout logic. It only
  opens Stripe-hosted flows (PaymentSheet for escrow, Connect onboarding
  for spotters).
- Escrow charge on posting; payout of 95% / 5% application fee only via
  the `release-payout` Edge Function, which validates state transitions
  server-side (post must be `recovery_claimed`, sighting must belong to
  the post, spotter must be onboarded).
- Webhooks: verify Stripe signatures, dedupe by event id, and make every
  handler idempotent.
- Amounts are integer pence everywhere. `// MONEY:` lines require tests.

## 5. Fraud controls (v1)

- No gallery-ONLY sightings: every sighting requires ≥1 live in-app capture
  + server timestamp. Gallery photos are permitted ONLY as labelled
  supplementary evidence per ADR-0003 (approved 2026-07-15, not yet built),
  gated on the server-enforced ≥1-live-capture rule in `create_sighting`;
  they carry no location/time evidence weight and never feed payout.
- Rate limits: 3 sightings per spotter per post per day; posting requires
  a payment method, which itself deters throwaway abuse.
- Collusion check before payout: flag for moderator review if the owner
  and winning spotter share a device fingerprint, card fingerprint, or
  signup IP.
- Bounty cap £5,000 in v1.

## 6. Database security

- **RLS on every table, deny by default.** Examples:
  - `posts`: readable by anyone only when `status = 'active'`; owners see
    their own in any state; moderators see all.
  - `sightings`: spotter sees their own; the post's owner sees all
    sightings on their post; public sees none.
  - `verification_documents`: uploader + moderators only.
  - `messages`: only the two thread participants.
- Status transitions happen via `security definer` functions / Edge
  Functions, never direct client `update` on `posts.status`.
- Service-role keys exist only in Edge Function secrets — never in the app
  bundle or repo.

## 7. Moderation

- Moderator dashboard (v1: a simple internal Expo web or Next.js page) has
  queues for: ownership verification, flagged sightings/photos, disputes,
  and collusion flags.
- Every moderator action writes an audit log row (who, what, when, why).
- Any user can flag a post, sighting, photo, or message in two taps.
