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

## 2. Anti-stalking / verification

- **No post is publicly visible before ownership verification passes**
  (moderator reviews the V5C/proof upload). This is the primary control
  against someone using the platform to track a person rather than recover
  a car.
- Verification documents are stored in a **private** Supabase Storage
  bucket, accessible only to the uploading user and moderators via RLS +
  signed URLs. They are deleted (or anonymised) 30 days after the post
  closes.
- One active post per plate. Re-posting a plate that was previously
  rejected flags the account for moderator review. The plate is optional
  (DOMAIN.md): this uniqueness rule applies only to posts that HAVE a plate —
  plate-less posts can't be deduped this way, so mandatory moderation (the V5C
  check) is the backstop against duplicate/abusive plate-less reports.

## 3. Data protection (UK GDPR)

- Number plates, locations, and V5C documents are personal data. Collect
  the minimum, state the purpose in the privacy policy, honour deletion
  requests.
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
