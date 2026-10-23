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
    `ReportSafetySheet.tsx` (before every sighting report), `PostSightingsScreen.tsx`,
    `SightingWhereSection.tsx` (the sighting detail page's "Where", beside the
    exact point), `PostDetailBody.tsx` (post detail) — which
    `grep -rn "<SafetyNotice" src` will confirm. Onboarding is the fifth and
    carries the COPY rather than the component: `onboardingSlides.ts` imports
    `SAFETY_RULE_LINE` from `SafetyNotice.tsx` and `OnboardingSlide.tsx`
    renders it as a warning-bordered pill, with the 999 clause deliberately
    omitted at that stage. Between them they cover the moment someone is
    deciding whether to go and look at a car, which is the decision this rule
    exists to reach.
  - **The report gate is a sheet, not a wizard step (2026-09-30).**
    `ReportSafetySheet` opens over the listing (post detail, and the map's peek
    card) every time someone taps "I've seen this car", in SafetyNotice's
    `points` layout: the rule, "take your photos from where you are", and 999.
    Only its "Continue" starts the report. A swipe, scrim tap or
    Android Back cancels, never acknowledges (BottomSheet now handles Back
    itself; before, Back went to the screen under the sheet).
  - ⚠️ **The proof it was shown lives in memory, never in the URL.** A
    confirm marks `sightings/lib/safetyAck.ts` for that post, for 30 seconds,
    and `ReportSightingScreen` shows the same sheet itself when there's no
    fresh mark (a deep link, a future entry). The first version used a
    `safety=seen` route param, and the security review caught that any deep
    link could carry it straight to the camera. Don't bring a param back.
  - Inside the wizard, the photos helper ("From a distance…") keeps the
    DISTANCE half of the rule in view; the full notice (never approach,
    follow or confront; 999) is the sheet's, not repeated on each step.
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
    `OnboardingScreen.test.tsx`), and since 2026-09-30 the report safety sheet
    (`ReportSafetySheet.test.tsx`, plus `ReportSightingScreen.test.tsx` for the
    deep-link path), and since 2026-10-08 the sighting detail page
    (`SightingDetailScreen.test.tsx` — the notice, and both maps buttons,
    Google Maps and Waze, behind its confirm). **Post sightings still has no test asserting the notice
    renders** — one surface unguarded. Stated rather than glossed; closing it
    is a one-line assertion.
- We never build features that facilitate pursuit: no live navigation
  toward a sighted car, no "car is moving" live tracking, no directions
  from spotter to vehicle.
  - **The OWNER may open a sighting's point in their maps app** (2026-08-08).
    Only on the owner-only sighting detail screen — since 2026-10-20 (owner's
    request) as two buttons side by side, **Google Maps** and **Waze**, in
    place of one "Open in Maps" link. It does not bend the rule above, and
    the boundaries are load-bearing rather than incidental:
    - It drops a **pin**, never turn-by-turn. `googleMapsPinUrl` emits Google's
      *search* link (never `/maps/dir/`), a pin in the app and in the
      browser alike; `wazePinUrl` emits Waze's APP scheme `waze://?ll=` (a
      place card) and **never `navigate=yes`**, which would start a drive on
      open. Not Waze's https `ul?ll=` link: with Waze not installed it falls
      back to the browser and redirects to waze.com/live-map/**directions**
      (checked 2026-10-20) — the app scheme has no web fallback, so without
      Waze the screen just says it couldn't open it. Neither emits the navigation forms (`daddr=` /
      `google.navigation:`), so the app cannot produce live navigation even by
      accident; the functions are named for what they emit, and
      `mapsLink.test.ts` pins the absence of every navigation form. (The
      platform-chooser `mapPinUrl` remains, unused by this screen.)
    - Each button is **named for the app** ("Open in Google Maps", "Open in
      Waze"), never "Directions" — a place, not a journey.
    - Both sit **below the SafetyNotice** and behind the **same confirm that
      restates that notice verbatim** (the copy is imported from the component,
      not retyped, so the two cannot drift). Since the 2026-10-08 redesign the
      notice sits in the same "Where" section as the map and the buttons
      (`SightingWhereSection.tsx`), not sections further down the page: the
      exact point is where an owner is most tempted to act.
    - Nothing but the point is handed to the third-party app — no caption, so
      never the plate, the car, or the spotter.

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
  - A push payload carries **ids only** (`postId` / `threadId` /
    `sightingId`), parsed
    client-side through a `.strict()` schema so a widened payload fails to
    parse rather than being acted on. The client re-fetches everything else
    through RLS after the tap.
    Accepted trade-off (2026-10-09, #147): the owner's "new sighting" push
    and that spotter's later pushes about it carry the SAME `sightingId`, so
    Expo/Apple/Google could link one owner to one spotter per sighting — not
    only per post. Random ids, nothing about either person rides with them.
    The push-open log omits them (as it omits `threadId`); the sighting
    screens do log them, to our own first-party telemetry, which carries no
    user id — so nothing there widens what the push services see.
  - **A spotter's reason never reaches a push as their words** (2026-10-09,
    `sighting_withdrawn`). Why a sighting was taken back is a CLOSED
    vocabulary (`sightings.withdraw_reason`, CHECK-constrained, refused with
    INVALID_INPUT before any write), turned into one fixed sentence by
    `claim_sighting_withdrawn_notification` in SQL; its payload is the post id
    alone. Free text would land unmoderated (§7) on a theft victim's lock
    screen. `withdraw_sighting_verification` CHECK 10 asserts the copy per
    reason and that no plate or place appears.
    **The one exception is in-app, never pushed** (owner decision,
    2026-10-09): with "Something else" the spotter may add a note
    (`sightings.withdraw_note`, ≤200 characters, trimmed, CHECK-bound to
    `other`). The push only says a note exists ("…and left you a note.");
    the words are read after the tap through `get_post_withdrawals`, which is
    owner-only and returns no sighting id, spotter or place. The column is
    granted to no client role (the spotter can't read it back either);
    control, zero-width and text-direction characters are refused. The app
    logs only whether there was a note (`gaveNote`), never the words; sends
    `p_note` only with "Something else" and only when one is left after
    stripping the same hidden characters (`cleanWithdrawNote`, held to the
    server's set by `withdrawReasons.test.ts`); parses the owner's list
    through a strict three-field schema; and fetches it on the owner face
    only (`usePostWithdrawals`). It is
    **unmoderated** (§7) — the owner accepted that. CHECKS 12–14 assert the
    bounds, that the words never reach the copy, and the owner-only read.
    ⚠️ **Kept as long as the sighting row** — no purge yet. A note may hold
    personal data; nulling it some time after the post closes is an open
    follow-up.
    **The damage details follow the same rules** (2026-10-21,
    `20261021100000_a_sighting_says_what_damage.sql`): `sightings.damage_kinds`
    (a closed six-kind list) and `sightings.damage_note` (≤300 characters,
    trimmed, the same hidden-character refusal — the app strips that set as
    typed, held to the CHECK's every range and to create_sighting's copy by
    `supabase/tests/withdrawReasons.test.ts`), both only beside the
    `damage_visible` flag. Owner-only through `get_post_sightings`; granted to
    no client role; never in a push or the public timeline; the app logs
    only counts / whether there was a note, never the words. **Unmoderated**
    (§7), like the note. ⚠️ **Kept as long as the sighting row** — the
    90-day location purge clears coordinates only, and a damage note can
    still name a place; the same open follow-up as the withdrawal note.
    In the privacy policy ("What we collect", 2026-10-21) and the draft Art.
    30 record (`docs/RECORD_OF_PROCESSING.md` 4.4).
    **Which parts are missing follow them too** (2026-10-21,
    `20261021120000_a_sighting_says_what_is_missing.sql`):
    `sightings.missing_parts` (a closed six-part list — only parts seen from
    where the spotter stands, §1: nothing under the car or inside it) and
    `sightings.missing_parts_note` (≤300, the damage note's checks exactly,
    pinned to the same set by `supabase/tests/withdrawReasons.test.ts`), both
    only beside the `missing_parts` damage kind. Owner-only, never pushed or
    logged (counts only), **unmoderated**, ⚠️ **kept as long as the row** —
    the same retention follow-up; in the privacy policy and the Art. 30
    record beside the damage details (2026-10-21).
  - The visible push — title or body — may name make, colour and a
    **district-grain** locality. ⚠️ Deliberately field-agnostic since
    2026-09-22, when the copy pass moved the alert's locality and the
    sighting's make/colour INTO the title: the guarantee is about what a lock
    screen shows, and naming one field is how the rule goes stale the next
    time copy moves between them. The absence assertions in
    `alerts_verification` are written over title ‖ body for the same reason.
    **Never** the plate, never coordinates, and never
    `posts.last_seen_area` — that column holds the raw reverse-geocoded label
    and can be street-grain, which on a driveway theft is the victim's own
    street.
  - **Message content never transits push.** The push is the sender's first
    name (the TITLE since 2026-09-22 — "Message from Beth") plus post context
    (the body), built server-side. The absence is asserted over title AND body
    together in alerts_verification CHECK 25, because it stopped being a
    property of one field the day the push had two populated ones.
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
    `avatars`, `post-photos`, `verification-documents` and (since 2026-10-21)
    `bug-screenshots` before deleting the
    `auth.users` row. It sweeps via the Storage API, never by deleting
    `storage.objects` rows — a row delete leaves the bytes orphaned in the
    backing store, findable by nothing. Order is load-bearing: storage FIRST, so
    a failed sweep aborts while everything is still retryable, rather than
    stranding personal data with no owner left to erase it.
    - ⚠️ **Updated 2026-10-22 — a spotter's sightings and photos do NOT survive
      their account.** The sightings cascade, and since 20260921110000 each
      deleted `sighting_photos` row queues its file for the hourly sweep, so
      the images are erased too. The owner chose to keep that and the privacy
      policy now says so. The bullet below is the original (2026-08) reasoning
      for not sweeping the bucket in delete-account; it no longer describes
      the outcome.
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
  - **Cancelled-post deletion and the ledger snapshot (2026-09-21, recorded
    retention decision).** Deleting a cancelled post (owner action, or the
    30-day purge — DOMAIN.md lifecycle item 7) hard-deletes the post and its
    cascades, and queues BOTH photo buckets for the storage sweep
    (`orphaned_photos` for post photos, `orphaned_sighting_photos` —
    `20260921110000` — for the private sighting bucket, which previously had
    no removal path at all). The payments row is **detached, not deleted**,
    and its `post_snapshot` retains the post's identity (plate, owner id,
    make/model/colour, dates) plus any settled refund-hold / dispute /
    payout-review rows, indefinitely, on a table with **zero client access**.
    Basis: Art. 17(3)(b)/(e) — the financial record and its fraud/dispute
    evidence must survive the content's erasure (the same reasoning as
    `device_links` and `account_deletions`). This is deliberately MORE than
    the bare ledger needs; if minimisation is later preferred, trim the
    snapshot in `delete_cancelled_post`, not the detach.
  - **CLOSED 2026-10-23 — account deletion failed for anyone with money
    history** (`20261023120000`). The RESTRICT FKs on `payments`,
    `refund_holds`, `refund_disputes` and `payout_reviews` refused the cascade,
    and the user saw "try again". Now `delete_account_data` runs BEFORE the
    auth row goes, in one transaction:
    - every listing they own goes through the same afterlife (ledger detached
      with `post_snapshot`). **Recorded decision:** the snapshot keeps the
      deleted owner's id — an opaque uuid that matches nothing once the
      account is gone, kept so the ledger row still says whose money it was
      (same Art. 17(3)(b)/(e) basis as above);
    - payments paid TO them keep `payee_snapshot` (the Stripe account id) with
      no link to a person;
    - settled reviews/disputes on others' listings keep the record, anonymised
      — spotter, sighting and the dispute **statement** (their own words)
      cleared;
    - their sightings are deleted in the same transaction, the listings they
      sit on locked `FOR UPDATE` first, so `claim_recovery` can't credit one
      between the checks and the delete.
    It refuses with a named reason (DOMAIN.md, "Account deletion") while
    anything still moves. Afterwards the Edge Function closes their payout
    account at Stripe (v2 close, else v1 delete) and emails the operator if
    that fails. Tested by `supabase/tests/account_deletion_verification.sql`.
    - **Proof it's them, enforced at the server (2026-10-23).** A valid token
      only proves the phone is signed in, so `delete-account` refuses
      (`REAUTH_REQUIRED`) unless THIS session authenticated within 5 minutes —
      read from the token's signed `amr` timestamps (`_shared/recentSignIn`,
      fails closed; a refreshed token keeps its session's original time). The
      app gets there with a 6-digit code to the user's own address
      (`shouldCreateUser: false`) or, for an Apple account (relay addresses
      don't receive our codes), an Apple re-sign-in. Checked before the
      blockers, Stripe or anything irreversible. Caveat: the email-send budget
      is 2 codes/hour, so someone who has just signed in by code may be told
      "try again later".
    - **Recorded decision (2026-10-23, 20261023140000):** an owner's deletion
      now also takes down a LIVE listing that holds no reward money (free, an
      abandoned "add a reward", a lapsed reward), after the delete screen
      names it. Its spotters' sightings and photos go with it, as for any
      deleted listing — on a car that may still be missing. Reward money held
      or a claimed recovery still blocks.
    - Residuals: a refund that FAILS after the owner is gone leaves the ops
      alert with nobody to contact; the screen's "taken down now" count is
      read once, so a listing gone live on another device meanwhile is
      deleted unwarned; a deletion can now wait on (or deadlock with) live
      listing activity — it fails safe with "try again".
- Auth is passwordless (email OTP + Apple/Google — DOMAIN.md). Session tokens
  (access + refresh) are stored in the OS keychain via expo-secure-store,
  encrypted at rest — never in plaintext AsyncStorage. Emails are personal data:
  never logged in full (redactEmail).
- **Sign in with Apple on Android is a web round trip, done with PKCE
  (2026-10-15).** Apple has no Android kit, so Supabase OAuth sends the user
  back on `trackitdown://auth-callback?code=…`.
  - **Why not tokens in the URL:** the first draft carried the tokens
    themselves (the implicit flow), and the security review found three ways
    in:
    - **Login forgery:** any web page or QR code could open such a link with
      an attacker's tokens and sign the victim into the attacker's account.
    - **Interception:** an app claiming the same scheme could take the
      tokens.
    - **Replay:** Android re-delivers launch links.
  - **How it works now:** the URL carries only a one-time code. Only this
    device can redeem it, because it holds the verifier made when the
    sign-in started (`supabaseOAuthHandshake`, a separate PKCE-only client
    that keeps nothing but that verifier in the keychain). Redeeming spends
    both.
  - **What's refused:** token URLs are ignored outright, and a return
    arriving while someone is signed in changes nothing.
  - **Why a separate client:** the app's own client is untouched, so the
    email-code sign-in is unaffected.
  - **Handling:** the session goes to `supabase.auth.setSession` (then the
    keychain, as above). It's never logged, and each return is taken once
    (`oauthReturn.ts`).
  - **Apple's client secret expires after at most 6 months;** renewal is in
    the auth README.
- Spotter GPS is captured **only** at the moment of reporting a sighting —
  no background location tracking anywhere in the app.
- **In-memory location speed caches** (2026-10-08, #142): recent reverse-geocode
  answers (`placeLabels`, ≤20 points, ~10m keys) and the map-centre read-ahead
  (`useDefaultMapCentre`, 2 minutes), and the reward guidance per ~1km cell
  (`bountyGuidanceApi`, 5 minutes, keyed per account). The first two are
  memory only and never sent to us — a reverse geocode itself goes to the
  OS geocoder (Google on Android, Apple on iOS), as does the owner's
  sighting-page street address (`useSightingAddress`, 2026-10-20: the exact
  point, owner-only, nothing stored or logged); the guidance is asked for — snapped to
  the RPC's own 0.01° grid, never the raw pin — once the owner CONFIRMS the
  last-seen point (the map step's Next), as it always was before the reward
  step. All three are **forgotten on a deliberate sign-out or account deletion**
  (`forgetLocationMemory`). A cached OS fix only counts if it is under 10
  minutes old and within 200m — the post wizard commits the opening point as
  the last-seen answer.
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
  - The mitigations are **expiry, ownership and clearing**, not the medium:
    a draft older than 14 days is dropped on read; it is deleted the moment
    the post is created server-side; it records the account that saved it and
    is offered to no one else (a draft with no recorded owner — written before
    2026-10-08 — is offered to no one); and a **deliberate sign-out or account
    deletion deletes it** (`profileApi`). A session that merely EXPIRES does
    not — the owner keeps their own work (security review of #141).
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
  Kept 180 days (onboarding) and 90 days (telemetry): the purges, written in
  2026-08 but never scheduled, run in the hourly sweep since 2026-10-21.
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
  - It nulls the coordinates only. The photo row and the image stay (and,
    until 2026-10-22, the coarse `sightings.area_label` did too — it is what
    a spotter sees on their own "My sightings"; see the next bullet).
  - **Widened 2026-10-22 (`purge_closed_sighting_details`, 20261022100000):**
    at the same 90 days the street-level `area_label` and every free-text
    field (note, damage, missing-parts and withdrawal notes) are cleared
    too, unless money on the listing still moves (held/superseded payment,
    unresolved review, open dispute, live hold) or any payment on it is under
    180 days old — a card chargeback can still reach it, and chargebacks are
    not recorded here. Every screen that shows
    `area_label` already falls back when it is null. Recovered listings go
    12 months after closing (`purge_old_closed_posts` — delete_cancelled_
    post's guards and ledger afterlife exactly; a stray never-captured
    intent is cancelled at Stripe by the sweep first, as delete-post does,
    and one it cannot prove is counted as skipped); push tokens unused for
    270 days and webhook ids past 30 days are deleted. All run in the hourly
    sweep; `retention_rules_verification.sql` asserts each.
  - **The spotter sees their OWN photos there (2026-10-09).** Each card leads
    with the spotter's first in-app photo, read from `sighting_photos` under
    `sighting_photos_select_own_spotter` (their rows only) and signed under
    the storage policy for their own uploads — a direct read of four columns
    (`sighting_id, path, source, position`), never through
    `my_sighting_record`, which is not widened. No coordinates, nothing of the
    owner, and nobody else's photos. One thing it does hand over: the storage
    path begins with the post's id (`<post_id>/<spotter_id>/…`), so the client
    now holds post ids for CLOSED posts too, which `my_sighting_record`
    withholds. Low risk — it is the path the spotter uploaded to, and post RLS
    still hides a closed post — but it is why the path is never shown or
    logged. Read in batches of 100 ids.
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
- **Raw bank and identity details go from the phone STRAIGHT to Stripe — our
  servers never see them** (current accounts, Accounts v2 recipients, where
  the platform collects requirements). `src/features/payments/api/
  stripeTokens.ts` mints two single-use tokens with the PUBLISHABLE key — a v2
  account token (identity) and a v1 `btok_` (bank, by plain request since
  2026-10-16, not the SDK) — and `create-payout-account` receives only the two
  token ids. This is the ONE place client code calls Stripe directly, and it
  is publishable-key tokenisation only: no secret, nothing that moves money,
  and a token is useless until our server attaches it with the secret key.
  The values are **never stored** and **never logged**, not even masked.
  The older generation (`submit-payout-details`, Express accounts, where a
  `btok_` can't be attached) still forwards raw numbers through our function
  in transit; it is legacy and serves accounts made before Accounts v2.
- **The one bank detail we DO hold (2026-10-15, PR7): the last four digits**
  of the account Stripe pays into — `stripe_connected_accounts.bank_last4` —
  so the tracker can say "Paid into account ending 5678". Stripe's own
  answer (never what was typed), exactly four digits (a column CHECK), read
  only by the account's owner (select-own RLS), written only by the
  service-role `record_bank_last4`, never logged, and gone with the profile.
  The sort code and full number are still never stored. In the privacy
  policy ("Bounty payouts", 2026-10-21) and the draft Art. 30 record
  (`docs/RECORD_OF_PROCESSING.md` 4.12, with the legacy in-transit path).
- **Two pricing modes since 2026-08-20 (ADR-0014), and the amount is
  server-authoritative in both.** A post is PRICED as either a bounty (escrowed)
  or a fixed £5 listing fee. *(Since 2026-10-05 a live fee listing can ADD a
  reward, and then carries both: the £5 stays `collected` and non-refundable,
  and the reward is held like any other. Changing a live reward is a new
  charge whose amount the owner writes through `set_reward_renewal_amount`,
  never in the charge request. That function refuses to LOWER a reward while
  recent uncredited sightings exist, and capture re-checks it. See
  20261005130000.)*
  *(The reward TERM, 2026-10-05, ADR-0020: a reward lasts 60 days and is then
  refunded to its owner through the ADR-0011 hold. A term ends by capture +
  85 days and its 72-hour spotter window by capture + 88 (under Stripe's 90);
  only an open dispute holds money longer, and the 75-day operator alert is
  the backstop. Refunds are keyed per payment (`payment-refund-<pi>`). The
  reminder pushes carry the car and the date, never the plate or the amount,
  and collapse by POST id, never by a ledger id.)*
  *(The EXPIRY, 2026-10-06, `20261006130000`: `claim_reward_expiries` is
  service-role only and runs only when BOTH `REWARD_EXPIRY_ENABLED` and
  `REWARD_TERM_NOTICES_ENABLED` are on (the sweep enforces the pair). It
  raises a SYSTEM refund hold — not attested, so it never stands in for an
  owner's attestation; an owner exit during it is attested and upgrades it.
  The refund never runs over an open/upheld dispute, a credited sighting or an
  unresolved payout review (`refunds_due`), and a sighting reported during
  the window is taken in and told. Spotters see only `reward_end` vs `closed`
  on the dispute screen — never which owner exit closed a listing. By the
  owner's choice the `reward_ended` push names the exact refund figure
  (ADR-0021's fixed fee) — the only reward push that carries an amount;
  never the plate.)*
  The client never sends either amount, and specifically **never sends the fee**:
  a NULL-bounty post owes exactly 500p, decided server-side by
  `record_post_payment_intent` (any other amount raises `BOUNTY_MISMATCH`) and
  pinned by the `payments` CHECK (`kind = 'listing_fee'` ⇒ `amount_pence = 500`),
  so no client can name the price it pays. *(Corrected 2026-10-06: this used to
  cite `current_listing_fee_pence()`, `posts.listing_fee_pence`,
  `record_listing_fee_intent` and `FEE_MISMATCH` — ADR-0014's first design,
  never built. ADR-0014 records what shipped.)*
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
  **A payout and a deadline refund are mutually exclusive (2026-10-07).**
  Before any transfer, `release-payout` calls `begin_payout`, which takes the
  post lock, refuses with `PAYOUT_LAPSED` once the spotter's deadline refund
  has been claimed, and stamps `payout_started_at`. The sweep's
  `claim_payout_lapse` takes the same lock and refuses within an hour of a
  started payout. It still asks Stripe for a transfer in the post's
  `transfer_group` before refunding. If there is one, it alerts us, parks the
  lapse, and never refunds it. It also re-reads the spotter's payee status
  from Stripe first, so a missed webhook can't cost them the reward. A payout
  review short of approved (pending or rejected) is never lapsed: the gate's
  decision is ours, not the clock's (ADR-0020).
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
- ⚠️ **No check on a withdrawal note** (2026-10-09). A spotter's
  "Something else" note (≤200 characters) reaches the post owner in the app
  unread by anyone first, and there is no way to flag one (when flagging is
  built it needs an opaque per-note handle, never the sighting id). The
  owner accepted this. The note is kept in-app only (§3) and shown labelled
  "Written by the spotter" (`TakenBackList`), so it never reads as ours.
