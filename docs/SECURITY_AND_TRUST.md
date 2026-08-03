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
- **Push notifications leave our infrastructure.** Every push travels through
  Expo and then Apple/Google, so its contents are readable by parties outside
  the app. Therefore:
  - A push payload carries **ids only** (`postId` / `threadId`), parsed
    client-side through a `.strict()` schema so a widened payload fails to
    parse rather than being acted on. The client re-fetches everything else
    through RLS after the tap.
  - The visible body may name make, colour and a **district-grain** locality.
    **Never** the plate, never coordinates, and never
    `posts.last_seen_area` — that column holds the raw reverse-geocoded label
    and can be street-grain, which on a driveway theft is the victim's own
    street.
  - **Message content never transits push.** The body is the sender's first
    name plus post context, built server-side.
  - **Notification volume is capped**, because a push is a way to reach someone
    who has already been robbed: at most 3 spotter alerts per user per rolling
    24 hours, and at most one message push per thread per 2 minutes (chat
    itself allows 20 messages a minute). The messages still arrive; only the
    push is suppressed.
  - Every interpolated value in a push body is length-bounded **before** the
    sentence is assembled, never by truncating the finished string — the
    don't-approach clause is at the end, so bounding the whole sentence would
    let owner-authored text push the safety line off it.
  - Bodies are built in SQL rather than in the Edge Function, specifically so
    these absences are asserted by `npm run test:db`.
- **A spotter's alert locations are home-ish data.** The "approximate area"
  toggle is ON by default and the server snaps the point to a ~1km grid
  **before** storing it, so the database never holds the exact location. That
  snap is a server guarantee, not a client promise — `alert_zones` deliberately
  has no client write grant, so every write goes through `create_my_alert` /
  `update_my_alert`, which both snap. An alert is readable only by its owner;
  nothing exposes one, or its criteria, to anyone else.
  - The criteria (make/model/colour/body type/bounty/recency) are
    owner-authored and owner-only. They are never logged — write events record
    only the radius, whether the alert is narrowed at all, and a
    `redactLocation`-coarsened origin.
- **Push tokens are device credentials.** `push_tokens` is keyed on the token
  itself, not on `(user_id, token)`: a token identifies a handset and survives
  sign-out, so re-registration MOVES the device to whoever is signed in now.
  Without that, a shared or resold phone would keep delivering the previous
  user's sightings and messages. Sign-out releases the token before the
  session drops, and tokens are never logged.
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
  - **PARTLY CLOSED (2026-08-01) — account deletion now sweeps storage.** The
    `delete-account` Edge Function exists. It had been invoked by the client
    since 2026-07-10 but was never written, so the app shipped a delete button
    that could not delete. It now removes every object the user owns in
    `avatars`, `post-photos` and `verification-documents` before deleting the
    `auth.users` row. It sweeps via the Storage API, never by deleting
    `storage.objects` rows — a row delete leaves the bytes orphaned in the
    backing store, findable by nothing. Order is load-bearing: storage FIRST, so
    a failed sweep aborts while everything is still retryable, rather than
    stranding personal data with no owner left to erase it.
    - **`sighting-photos` is deliberately EXCLUDED.** Those are uploaded by the
      spotter into `<postId>/<uid>/…` but are evidence on somebody ELSE's
      listing, possibly a live one. Sweeping them would let anyone delete their
      account and, as a side effect, strip the only photographic evidence from a
      stranger's active theft case. The erasure still severs the link (profile
      and sighting rows cascade), leaving an anonymous photo of a vehicle in a
      public place — per ADR-0003 these are camera-only shots of the CAR, not
      the spotter — and Art. 17(3)(e) covers evidence for legal claims. Flagged
      as a judgement call, not a certainty.
  - **STILL OPEN — `delete_vehicle` / `update_vehicle` orphan objects.** Both
    remove rows only; the JPEGs stay in the public `post-photos` bucket and
    remain reachable by URL indefinitely. Any fix must first check
    `post_photos.url` / `post_distinctive_feature.photo_url` for the same
    object: the garage and posts deliberately SHARE objects, so deleting one
    blindly would blank the hero image of a live stolen-car listing. (Account
    deletion is safe from that trap because the whole account's posts cascade
    with it.)
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
  for spotters — the latter is not built yet).
- Escrow charge on posting; payout of 95% by **transfer**, with our 5%
  retained as the remainder that never leaves the platform balance — **not**
  an `application_fee_amount` (ADR-0002; this line said "application fee"
  until 2026-08-03). Only via the `release-payout` Edge Function, which
  validates state transitions server-side (post must be `recovery_claimed`,
  sighting must belong to the post, spotter must be onboarded) and whose
  `mark_recovery_paid` re-derives the split independently and rejects a
  mismatch.
  ⚠️ **Nothing calls `release-payout` today**, and no Connect onboarding
  exists, so a credited bounty currently stays on the platform balance
  indefinitely while both parties are shown copy saying it is on its way.
  Do not take a live payment until that is closed.
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
    sightings on their post. The public sees **no rows and no grant** — the
    single carve-out is `get_public_sighting_entries` (ADR-0008), a capped
    SECURITY DEFINER RPC returning `{time, locality}` for an ACTIVE post's
    five most recent sightings plus a count: no ids, no coordinates, no
    photos, no spotter fields, no notes. Locality is a dedicated
    coarse-by-construction column — never the street-level `area_label`.
  - `verification_documents`: uploader + moderators only.
  - `messages`: only the two thread participants.
- Status transitions happen via `security definer` functions / Edge
  Functions, never direct client `update` on `posts.status`.
- Service-role keys exist only in Edge Function secrets — never in the app
  bundle or repo.
- **RLS is not the whole story: `TRUNCATE` ignores it.** RLS filters rows for
  `SELECT`/`INSERT`/`UPDATE`/`DELETE`, but `TRUNCATE` is a *table-level*
  privilege checked before any policy runs. A role holding it empties the table
  regardless of every policy on it.

  > ### ⚠️ OPEN GAP — anon holds TRUNCATE on 24 tables
  >
  > This project ships `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon,
  > authenticated`, so **every `CREATE TABLE` silently grants both roles
  > `REFERENCES`, `TRIGGER` and `TRUNCATE`**. The per-table `grant select` lines
  > in each migration *add* to that default; they do not replace it.
  >
  > Found 2026-07-31 by `alerts_verification.sql` CHECK 28 on its first ever
  > execution, and confirmed by execution, not inference:
  >
  > ```sql
  > set local role anon;
  > truncate public.alert_zones;   -- 4 rows -> 0 rows
  > ```
  >
  > **Fixed** for the four notification tables by
  > `20260802170000_revoke_default_table_privileges.sql`, and now asserted by
  > CHECKs 28–29. **Still open on the other 24 public tables**, including
  > `payments`, `posts`, `profiles` and `sightings` — a single statement there
  > would erase the escrow ledger or every live report.
  >
  > **Severity today: defence-in-depth, not a live hole.** PostgREST exposes
  > only DML and RPCs — never `TRUNCATE` — and the anon API key is a JWT, not
  > Postgres credentials, so there is no route to issue it from outside. It
  > becomes exploitable the moment anything runs dynamic SQL as the caller.
  > A privilege nothing uses costs nothing to drop, so drop it.

## 7. Moderation

- Moderator dashboard (v1: a simple internal Expo web or Next.js page) has
  queues for: ownership verification, flagged sightings/photos, disputes,
  and collusion flags.
- Every moderator action writes an audit log row (who, what, when, why).
- Any user can flag a post, sighting, photo, or message in two taps.
