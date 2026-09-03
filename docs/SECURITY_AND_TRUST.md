# Security & Trust

Trackitdown handles money, precise locations, identity documents, and a
crowd pointed at physical vehicles. These rules are product requirements,
not suggestions. Code enforcing them is marked `// SAFETY:` per the
commenting standards.

## 1. User safety — "report, don't approach"

- Every sighting flow and alert notification displays the SafetyNotice
  component: **report from a distance; never approach the vehicle, follow it,
  or confront anyone; if a crime is in progress call 999.**
  - **Five surfaces, in two forms.** The COMPONENT renders on four —
    `sightingSteps.tsx` (the sighting wizard), `PostSightingsScreen.tsx`,
    `SightingDetailScreen.tsx`, `PostDetailBody.tsx` (post detail) — which
    `grep -rn "<SafetyNotice" src` will confirm. Onboarding is the fifth and
    carries the COPY rather than the component: `onboardingSlides.ts` imports
    `SAFETY_RULE_LINE` from `SafetyNotice.tsx` and `OnboardingSlide.tsx`
    renders it as a warning-bordered pill, with the 999 clause deliberately
    omitted at that stage. Between them they cover the moment someone is
    deciding whether to go and look at a car, which is the decision this rule
    exists to reach.
  - ⚠️ **Do not audit this list with `grep "<SafetyNotice"` alone.** On
    2026-08-29 I did exactly that, concluded onboarding was not a safety
    surface, and wrote that into this paragraph — deleting a true statement
    about coverage in the same change that reduced coverage. The copy travels
    through a prop, so the component name never appears at the render site.
  - ⚠️ **THE CHAT THREAD NO LONGER SHOWS IT (owner decision, 2026-08-29),** and
    the automatic "Safety first…" system message that opened every conversation
    was removed with it (`20260829120000_thread_without_system_message.sql`).
    Threads created before that date keep the message they already have;
    nothing was deleted.
  - This paragraph previously required the notice on a chat thread and
    described the `collapsible` form added on 2026-08-05 to satisfy it. That
    requirement is withdrawn, not quietly dropped: it is recorded here so the
    code and the doc agree, and so the next reader can see it was decided
    rather than lost. The `collapsible` variant has no consumers as a result.
  - What did NOT change: the quick-reply safety register (no reply may suggest
    meeting, following, waiting, watching or approaching) and its lexicon test;
    the ban on features that facilitate pursuit, below; and the notice on all
    five remaining surfaces.
  - ⚠️ **What is actually pinned by a test, precisely.**
    `SafetyNotice.test.tsx` pins the COPY and the collapsible behaviour in
    isolation; `quickReplies.test.ts` pins the reply lexicon. RENDER
    assertions exist only for post detail (`PostDetailBody.test.tsx`) and
    onboarding (`onboardingSlides.test.ts`, `OnboardingSlide.test.tsx`,
    `OnboardingScreen.test.tsx`). **Sighting detail, post sightings and the
    sighting wizard have no test asserting the notice renders at all** — three
    of the five surfaces this rule now leans on are unguarded. Stated rather
    than glossed; closing it is a one-line assertion per suite.
- We never build features that facilitate pursuit: no live navigation
  toward a sighted car, no "car is moving" live tracking, no directions
  from spotter to vehicle.
  - **The OWNER may open a sighting's point in their maps app** (2026-08-08).
    Exactly one control, on the owner-only sighting detail screen. It does not
    bend the rule above, and the boundaries are load-bearing rather than
    incidental:
    - It drops a **pin**, never turn-by-turn. `mapPinUrl` emits only the
      *show me this place* forms (`ll=` / `geo:?q=`) and never the navigation
      forms (`daddr=` / `google.navigation:`), so the app cannot produce live
      navigation even by accident. The function is named for what it emits.
    - It reads **"Open in Maps"**, not "Directions" — a place, not a journey.
    - It sits **below the SafetyNotice** and behind a **confirm that restates
      that notice verbatim** (the copy is imported from the component, not
      retyped, so the two cannot drift).
    - The caption handed to the third-party maps app is a fixed, non-identifying
      string — never the plate, the car, or the spotter.

    The ban above is *spotter→vehicle* and against *live* navigation; recovery
    itself is "for the owner and police" (below), and the police ask "where".
    A "Directions" button was also added to the **public** listing body on the
    same day and removed on review: that body is what every spotter and every
    logged-out browser reads, so it WAS the banned feature — the coordinate was
    already public, but the affordance turned "a car to look out for" into
    "drive here". Pinned by `src/shared/lib/mapsLink.test.ts`.
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
    file and a £10–£5,000 bounty in escrow. Posting to track a person costs
    money and is traceable to a payment instrument.
  - **Report → flag → takedown.** `post_flags` captures durable, attributable
    reports (`flag_post`); a moderator takes a post down via the
    deactivate/refund path. No auto-hide on N reports — that would let griefers
    bury a victim's real post during the hours that matter.
  - **Location coarsening.** A `driveway` theft's last-seen point is the
    victim's home, so it is coarsened to ~1km for non-owners (§6, DOMAIN.md).
    Exactly TWO surfaces emit coordinates, and both snap: `get_post_detail`
    (since 20260713180000) and `search_posts` (since 20260810160000).
    `get_home_feed` and `get_nearby_posts` need no snap because they emit no
    coordinates at all — only `last_seen_area` and a distance. (The
    `ST_SnapToGrid` inside `get_home_feed` is a *different* rule for a
    different status: it withholds a **recovered** post's precise point.)
    The `search_posts` gap was a LIVE leak, not a latent one — posts go
    straight to `active` on payment, so the earlier "no active driveway post
    can exist yet" justification was false.
    **⚠️ OPEN — two ways the exact point is still reachable:**
    (a) **CLOSED 2026-08-10** (20260810200000). `search_posts` /
    `search_posts_count` used to MATCH on the unsnapped point (`&&` and
    `ST_DWithin`) while emitting a snapped one, so an anonymous caller could
    bisect the bbox and recover a driveway post's true location to sub-metre
    precision in a few dozen requests. Membership, distance and emission now
    all read the same coarsened point; an index-served padded pre-filter keeps
    the GiST index usable. `search_verification.sql` CHECK 19 runs the attack.
    (b) **CLOSED 2026-08-11** (20260811100000). Feed `distance_miles` was
    computed from the exact point at 0.1mi precision, so varying the origin
    trilaterated a home to roughly street precision — inside the ~1km grid it
    is meant to be blurred to. `get_home_feed` and `get_nearby_posts` now
    measure from the coarsened point via `post_pin_geog`. (The radius clamp
    never defended this, despite an old note saying so: it bounds the radius,
    not the precision reported for a post inside it.)
    Both routes are now closed, and every coordinate-emitting or
    distance-reporting surface measures a driveway theft from the ~1km grid.
  - **Map-search distance filter (2026-08-10).** `search_posts` /
    `search_posts_count` take a caller-supplied origin and a radius clamped to
    1–50 miles, mirroring `get_home_feed`. The origin is always the exact
    **centre of the bbox sent in the same call**, so it is arithmetically
    REDUNDANT — the four corners already encode it, and the server learns
    nothing it was not already being told. That, not the origin's provenance,
    is why it is safe: on the FEED path that centre *is* the device fix, because
    `HomeFeedScreen` frames the search region around the device's position; on
    the map it is wherever the user has panned to. It is
    **transient**: both functions are `stable` and write nothing, and the client
    logs only `hasOrigin` and the chosen `radiusMiles`, never the coordinates.
    It is deliberately NOT snapped, unlike `alert_zones.point` below — that snap
    exists because the value *persists*, and snapping a transient origin would
    only make the count disagree with the circle the sheet drew.
    ⚠️ If the origin is ever DECOUPLED from the bbox — sent for a point the
    caller is not simultaneously querying a rectangle around, e.g. a "cars near
    me wherever the map is pointing" mode — the redundancy argument above
    collapses and it becomes a genuinely new disclosure. That needs its own
    entry here.
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
  - **CLOSED 2026-09-01 — `delete_vehicle` / `update_vehicle` orphan objects.**
    Was: both remove rows only, and the JPEGs stayed in the public
    `post-photos` bucket reachable by URL indefinitely, so a person told their
    photographs were deleted still had them online.

    `20260901160000` adds `orphaned_photos` and an AFTER DELETE trigger on all
    four tables that hold such a URL (`post_photos`, `vehicle_photos`, and the
    two `distinctive_feature` tables), queueing the storage path. The hourly
    sweep (`release-held-refunds`) removes the objects **through the storage
    API** — never by deleting `storage.objects` rows, per the rule
    `delete-account` set out: a row delete leaves the bytes behind as an orphan
    no listing can find again.

    ⚠️ **The shared-object trap this entry warned about is handled at DRAIN
    time, not at enqueue.** A post snapshots a garage vehicle's URLs, so one
    object is routinely named by both. `claim_orphaned_photos` re-checks all
    four tables and hands back only paths nothing still references; a shared
    path is dropped from the queue and re-queued later if it is ever genuinely
    orphaned. `orphaned_photos_verification` CHECKS 4 and 5 are that guarantee,
    and they are the most important checks in the file — over-deleting is
    irreversible and the victim is a stranger.

    ⚠️ **Claim and forget are separate calls.** Dropping the queue row when the
    path is handed out would lose it permanently if the storage call then
    failed — stranding exactly the orphan this feature exists to remove.
    Removal is also inherited from the sweep's health: if that stops firing,
    erasure stops silently, the same caveat the retention purges carry.
  - Deleting a saved car never touches a post made from it — posts hold their
    own snapshot (DOMAIN.md, "Garage").
- Auth is passwordless (email OTP + Apple/Google — DOMAIN.md). Session tokens
  (access + refresh) are stored in the OS keychain via expo-secure-store,
  encrypted at rest — never in plaintext AsyncStorage. Emails are personal data:
  never logged in full (redactEmail).
- Spotter GPS is captured **only** at the moment of reporting a sighting —
  no background location tracking anywhere in the app.
- **An unfinished post-a-car report is saved on the device** (2026-09-03,
  review #19 — a nine-step flow ending in a card charge previously lost
  everything to a phone call). It lives in AsyncStorage, and **it contains the
  last-seen location**, which on a driveway theft is the owner's home.
  - The rule above about plaintext AsyncStorage is about **session tokens** —
    credentials that unlock an account. This is the owner's own data, about
    their own theft, on their own device, and the post publishes it minutes
    later anyway.
  - SecureStore is not the alternative: iOS caps a value at ~2KB and this
    object exceeds it (the same cap `shared/api/supabase.ts` records).
  - The mitigations are **expiry and clearing**, not the medium: a draft older
    than 14 days is dropped on read, and it is deleted the moment the post is
    created server-side.
  - **Photos are never written** — they are cache uris that may already point
    at nothing, and an explicit whitelist (`PERSISTED_KEYS`) means a future
    answer field is persisted only by decision, never by default.
- **Analytics carry no identifier, and that is deliberate.** Two tables collect
  behaviour — `onboarding_events` (2026-08-24) and `telemetry_events`
  (2026-08-30) — and neither has a `user_id`, a device id, or an install id.
  Each row carries an id generated **in memory** at the start of a run or a
  session and thrown away at the end, so two runs by the same person are
  unlinkable, and a run is unlinkable to an account that person later creates.
  Both are read by `service_role` only: RLS is enabled with no client policies
  and both tables carry an explicit `revoke all` from `anon`/`authenticated`.
  - ⚠️ **These are the app's only two anon-writable endpoints**
    (`record_onboarding_step`, `record_telemetry_events`), and that is inherent
    to the question rather than a shortcut: onboarding and much of the funnel
    happen before sign-in, and buffering until an account exists would record
    only the journeys that succeeded — the one population that cannot explain
    why people leave. The cost is that counts can be **inflated** by anyone; it
    is a data-quality problem, not a disclosure one, because neither table
    holds anything about anybody.
  - ⚠️ **If you ever persist either id to the device, stop.** That single
    change turns an anonymous counter into tracking of a person who has agreed
    to nothing, and every argument above stops holding.
  - `telemetry_events.props` is the only place free-form data could enter. It
    is constrained server-side (scalars only, 8 keys, 200-char strings, via a
    trigger) and filtered client-side by a key denylist covering coordinates,
    plates, emails, addresses and postcodes — see `src/shared/lib/telemetry.ts`.
    Adding a `user_id` later is one migration; **un-collecting behaviour you
    already gathered is not possible**, which is why the reversible choice is
    the default here. If that changes, it should change deliberately and be
    recorded in this section, not arrive as a side effect.
- Closed posts are hidden from search; their sighting location history is
  purged after 90 days — `purge_sighting_location_history()`, which nulls
  `sighting_photos.lat/lng/accuracy_m` for photos whose post closed over 90 days
  ago, asserted by `sightings_verification.sql` CHECK 25.
  - ⚠️ **This line asserted the purge from 2026-07-14 and nothing performed it
    until 2026-09-01.** The privacy policy made the same promise to users. It
    was written as a fact here, and in the `sightings` table's own header as
    "a separate retention job", and neither reading tells you it did not exist —
    which is why the check matters more than the function.
  - It nulls the coordinates only. The photo row, the image, and the coarse
    `sightings.area_label` all stay: the promise is about *detailed* location,
    and `area_label` is what a spotter sees on their own `My reports`.
  - ⚠️ **Scheduling is the remaining weakness.** pg_cron runs
    `release-held-refunds` hourly and that function calls this; nothing
    schedules the purge itself. If the sweep stops firing, retention stops
    silently. A pg_cron entry pointing at the RPC directly would decouple them —
    a dashboard action, as the existing job was.
- ⚠️ **OPEN GAP — EXIF stripping is CLIENT-SIDE, and this line used to claim it
  was server-side.** Corrected 2026-09-01. The false version had stood since
  the file was written, and it is the worst kind of documentation error: it
  tells a reader the control exists, so nobody looks.

  What is true: `photoUpload.uploadOwnFolderPhoto` and `sightingApi`'s image
  pipeline both re-encode a picked image to a fresh JPEG, and **that re-encode
  is a genuine EXIF strip** — including any GPS that would pinpoint an owner's
  home. `photoUpload.ts`'s own header says so, and correctly calls
  server-side stripping "a tracked cross-cutting gap".

  What is not true is that anything enforces it:
  - `post-photos` is a **PUBLIC** bucket, and URLs are plain `getPublicUrl`
    values — no transform, so nothing re-encodes on the way out either.
  - `post_photos_insert_own_folder` lets any signed-in user write directly to
    their own folder. That policy is right and must stay, but it means the
    app's re-encode is a convention, not a boundary: a scripted upload with a
    real session token puts the original bytes in a public bucket.

  **The realistic harm is the owner's own home address.** Someone photographs
  their car on the driveway; the object is world-readable by URL; the EXIF
  carries the coordinates. That is the same thing CHECK 12 in
  `anon_role_verification` protects `posts.last_seen_location` from, arrived at
  by a different route.

  Sighting photos are less exposed on this axis — they live in the PRIVATE
  `sighting-photos` bucket, and their capture GPS is deliberately shared with
  the owner as structured evidence anyway (and is purged after 90 days, above).

  Closing it properly means one of: re-encoding server-side after upload (a
  storage webhook into an Edge Function), or making the bucket private and
  serving signed transform URLs. Serving through Supabase's image transform
  alone is NOT sufficient — the untransformed object stays fetchable at its own
  URL.

## 4. Payments (Stripe Connect)

- The client app **never** touches amounts, fees, or payout logic. It opens
  Stripe's own flows (PaymentSheet for escrow, the embedded
  `ConnectAccountOnboarding` component for spotters) and, since 2026-08-03,
  collects payout details in a native form of our own — see below.
- ⚠️ **We transit raw bank details.** `submit-payout-details` receives a sort
  code and account number from our form and forwards them to Stripe's Accounts
  API. Stripe permits this only until an Account Link or Session exists for
  that account, which is why the session mint is gated on
  `details_submitted_at`. They are **never stored** — no column holds them —
  and **never logged**, not even masked; a partial account number in a log is
  still an account number in a log. Tokenising instead is not available: a
  `btok_` may only be attached where `controller.requirement_collection` is
  `application`, and ours are Express. **This is financial PII in transit and
  must appear in the privacy policy and the Art. 30 record.**
- **Two pricing modes since 2026-08-20 (ADR-0014), and the amount is
  server-authoritative in both.** A post carries EITHER a bounty (escrowed) OR a
  fixed £5 listing fee — never both, never neither, enforced by a table CHECK.
  The client never sends either amount, and specifically **never sends the fee**:
  `create_post` stamps it from `current_listing_fee_pence()` and
  `posts.listing_fee_pence` is deliberately absent from the client column grants,
  so no client can name the price it pays. `record_listing_fee_intent` re-checks
  the charge against the post's own stamped value (`FEE_MISMATCH`), exactly as
  the bounty path does (`BOUNTY_MISMATCH`).
  - **A listing fee reaches `collected` and NEVER `held`.** Every refund and
    payout query selects `held`, so a fee is outside all of them by
    construction. Both capture handlers refuse the other kind's rows; the
    dangerous direction is an escrowed **bounty** wrongly marked `collected`,
    which would vanish from every refund path — the owner's money silently kept.
  - The fee is **not refundable** and a fee listing has **no refund hold and no
    dispute window** (§5's owner-denial control protects a spotter's claim on a
    bounty; there is none here). Non-refundability is disclosed on the pricing
    step, before any money moves.
- Escrow charge on posting; payout of 95% by **transfer**, with our 5%
  retained as the remainder that never leaves the platform balance — **not**
  an `application_fee_amount` (ADR-0002; this line said "application fee"
  until 2026-08-03). Only via the `release-payout` Edge Function, which
  validates state transitions server-side (post must be `recovery_claimed`,
  sighting must belong to the post, spotter must be onboarded) and whose
  `mark_recovery_paid` re-derives the split independently and rejects a
  mismatch.
  **Wired 2026-08-03.** `release-payout` is called from `RecoverPostScreen`
  when a spotter is credited, and again from the post's manage sheet ("Send the
  bounty") for the usual case where they had not yet onboarded. Connect
  onboarding exists. This entry previously said nothing called it and told the
  reader not to take a live payment; that gate is met.
  ⚠️ **Two things still stand between this and real money:**
  - `account.updated` must be enabled by hand on the Stripe webhook endpoint.
    It is not a default, and without it `payouts_enabled` never becomes true,
    so every payout answers `awaiting_payee` forever — silently.
  - **The collusion check is BUILT (2026-08-03)** and runs inside
    `release-payout` before any transfer, replacing the "do not take a live
    payment" gate that stood here. Three signals, any hit → the payout answers
    `held_for_review`, a `payout_reviews` row is written, and a human (us)
    resolves it by hand in the console — `approved` unblocks the next run,
    `rejected` keeps the escrow held deliberately, because in the fraud shape
    this catches, the refund-claimant is the fraudster:
    1. **shared_device** — the `device_links` ledger records a push token
       moving between accounts (the same handset signed into both). Recorded
       by `register_push_token` at the moment of the move, because
       `push_tokens` itself deliberately forgets the previous owner.
    2. **shared_card** — the card fingerprint behind this bounty's escrow
       charge matches a card the spotter has paid with on their own posts
       (Stripe lookups at payout time; nothing stored).
    3. **matching_email** — the accounts' emails normalise to one address
       (case, `+tags`, gmail's ignored dots).
    **Honest limits, on the record:** two phones, two cards and unrelated
    emails defeat all three — this raises the cost of fraud from zero to
    "maintain genuinely separate identities", it does not make fraud
    impossible. Signup-IP matching was considered and REJECTED: we store no
    IPs, the only source is undocumented auth-schema internals, and UK mobile
    CGNAT would drown true positives in false ones. The gate **fails closed**
    (an unevaluable signal is a retryable error, never "assume innocent"), and
    review REASONS never reach any client — telling a fraudster which signal
    caught them is a tutorial.
- Webhooks: verify Stripe signatures, dedupe by event id, and make every
  handler idempotent.
- Amounts are integer pence everywhere. `// MONEY:` lines require tests.

## 5. Fraud controls (v1)

- No gallery-ONLY sightings: every sighting requires ≥1 live in-app capture
  + server timestamp. Gallery photos are permitted ONLY as labelled
  supplementary evidence per ADR-0003 (approved 2026-07-15, SHIPPED
  2026-08-01 — this said "not yet built" until 2026-09-03),
  gated on the server-enforced ≥1-live-capture rule in `create_sighting`;
  they carry no location/time evidence weight and never feed payout.
- Rate limits: 3 sightings per spotter per post per day; posting requires
  a payment method, which itself deters throwaway abuse.
- Collusion check before payout: flag for moderator review if the owner
  and winning spotter share a device fingerprint, card fingerprint, or
  signup IP.
- Owner-denial control (built 2026-08-05, ADR-0011) — the collusion check's
  mirror image: collusion is an owner paying THEMSELVES; denial is an owner
  refusing to pay the spotter who earned it. Any exit-with-refund while
  uncredited sightings from the last 14 days exist requires an explicit
  recorded attestation ("none of these led me to the car", with the exact
  sighting ids shown), delists immediately but HOLDS the refund 72 hours,
  and notifies every such spotter, who may dispute once per sighting. An
  open/upheld dispute blocks the refund; disputes are resolved by hand
  against the immutable evidence trail (capture-GPS photos, timestamps,
  retained chat), and an upheld one credits the spotter through the normal
  payout machinery, collusion gate included. The spotter-facing surface is
  no-oracle: every refusal is one indistinguishable answer.
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

  > ### ✅ CLOSED 2026-09-01 — anon held TRUNCATE on 24 tables
  >
  > `20260901130000_revoke_anon_truncate.sql` revokes `TRUNCATE`, `REFERENCES`
  > and `TRIGGER` from `anon` and `authenticated` on **every** table in
  > `public`, and `anon_role_verification.sql` **CHECK 13** now fails the build
  > if any table grants them again. The history below is kept because the shape
  > of the failure is the useful part: it was found by a suite's first-ever run,
  > fixed on four tables, correctly recorded as open on the other 24 — and then
  > sat that way for a month, because a documented gap reads as a decision.
  >
  > ⚠️ THE CAUSE IS NOT FIXED AND CANNOT BE, FROM HERE. The
  > `ALTER DEFAULT PRIVILEGES` that grants this is set by Supabase's project
  > bootstrap, not by any migration in this repo, so its grantor role is not
  > ours to assume — **every new `CREATE TABLE` still gets these privileges.**
  > CHECK 13 is the guard: add a table without an explicit revoke and CI goes
  > red. That is why the check matters more than the migration did.
  >
  > The revoke is surgical rather than `revoke all` + re-grant (the shape
  > `20260802170000` used on the four tables it owned): across 36 tables in
  > every feature, re-deriving each one's real DML needs would be a large and
  > silent way to break the app — a missed `grant select` is a screen that
  > returns nothing, with RLS-shaped symptoms and no error.
  >
  > <details><summary>The original gap, as recorded</summary>
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
  >
  > </details>

## 7. Moderation

⚠️ **RECONCILED 2026-09-03.** The first two bullets below were written in the
future tense and read as present tense for months. Neither is built. The
section now says what exists, and what does not, in that order — because a
security document describing controls that do not run is worse than one that
admits the gap.

**What exists:**

- Any user can flag a post, sighting, photo, or message in two taps. Those
  flags land in `post_flags` and `flags`.
- The queues are readable **by hand**, via the SQL in `OPERATIONS.md` §1–5.
  ⚠️ That file is the ONLY reader: no code anywhere reads `bug_reports`,
  `post_flags`, `flags`, `refund_disputes`, `payout_reviews`,
  `onboarding_events` or `telemetry_events`.
- Collusion holds (§4) are resolved by hand in the Supabase console —
  `approved` unblocks the next payout run, `rejected` keeps the escrow held.

**What does NOT exist** (review finding #22):

- ⚠️ **No moderator dashboard**, and no `features/moderation/` — no role, no
  claim, no queue screen, no route. The internal Expo/Next page described here
  was never started.
- ⚠️ **No moderator audit log.** Nothing records who resolved what, when, or
  why. A console action leaves no trace beyond the row it changed.
- No ownership-verification queue — verification itself was removed by
  ADR-0007, so there is nothing to queue.
