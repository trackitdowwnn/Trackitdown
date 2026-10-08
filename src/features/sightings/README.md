# Sightings — report a sighted stolen car

**Actor:** a signed-in spotter. **One sentence:** the speed-first wizard where
a spotter photographs a sighted car in-app (photo + GPS + timestamp captured
atomically as evidence), optionally adds context, and sends the report —
reportable in under 60 seconds; plus the sighting TIMELINE on the post: the
owner's rich chronology (entries → per-sighting detail with message /
mark-helpful) and the restrained public face (time + locality only, ADR-0008).

**Entered from** "I've seen this car" — the post detail bottom bar and the
search-map peek card — through the auth gate (`report_sighting` context) with
intent continuation. Full-screen route
`/report-sighting?postId=…&source=detail|map&bounty=<pence>`, outside `(tabs)`.

## Character

A SPEED flow: the spotter may be standing near the vehicle. The shared wizard
in its lightest shape — one phase, **no intro screens** (the framework's
`intro` became optional for this flow), 3 steps, big targets, everything
optional skippable. Safety copy calm, unmissable, never lecturing.

## Steps

0. **Safety sheet, BEFORE the flow** (`components/ReportSafetySheet.tsx`,
   2026-09-30; it was the wizard's first screen, "Before you report"). A
   bottom sheet over the listing, titled "Stay safe — report, don't
   approach", with SafetyNotice's `points`: never approach / take photos
   from where you are / 999. Primary **Continue** (owner's call over the research's "I'm at a safe
   distance"), plus a
   red-outline **Call 999** (`tel:`, keeps the sheet open). Dismissing
   cancels. Shown every time; logged as `safety_sheet` (shown / continued /
   dismissed / call_999). A confirm leaves an in-memory proof for that post
   (`lib/safetyAck.ts`, 30s); without one (a deep link) the report screen
   shows the sheet itself before the camera. Never a URL param: those can be
   forged.
1. **Photos** — camera-FIRST: with no evidence yet the full-screen
   `CameraCapture` opens immediately (the car may drive off); once something
   is captured the **`PhotoGridPicker` grid (source="capture") is the
   resting state** — tap a tile for a full-screen preview, ⋯/a11y actions to
   remove, the add tile reopening the camera ("Room for N more"), auto-close
   at 3/3. In-app camera ONLY (`// SAFETY` cites DOMAIN + ADR-0003 — no
   gallery path exists in capture mode; gallery-as-supplementary is decided
   but NOT built). Each capture atomically bundles photo + GPS + timestamp;
   removing a tile removes the WHOLE evidence unit. Location permission via
   `PermissionPrimer`; **denied/failed GPS never blocks** — the report
   proceeds flagged `location_unavailable`. Poor accuracy (> ~100 m) is
   recorded with its value, never rejected.
2. **Context** (all optional, redesigned 2026-10-01): "Anything else that
   helps?", ONE page with every question visible (no drawer, no sheet).
   Single-select rows are `ChoiceChips` (tap again to clear), each with an
   equal **Not sure** chip that stores nothing (its selected look lives in the
   UI-only `contextUnsure` answer, never sent). The words are
   `lib/contextLabels.ts`, shared with every owner-facing summary.
   - **What was it doing?** Parked · Moving · Being loaded or towed, stored in
     `context_flags` (Moving is stored `driving`). Follow-ups appear
     inline: Parked asks **Did it look like it was staying?** (Looks parked
     up = `settled` · Looks about to move = `moving`; `street` is no longer
     offered, old rows still read); Moving shows the **compass grid**
     (`CompassPicker`) plus Not sure. Switching state clears the other
     follow-up.
   - **Anyone in or near it?** 3-way `people_presence` (No one seen · People
     near it · Someone in it); the last two, and Not sure, reveal the fixed
     inline register "Don’t approach — your report is enough."
     (`SAFETY_PRESENCE_LINE`), announced to screen readers as it appears.
   - **Its condition**: multi-select chips (plate changed or missing · damage
     visible · being stripped · looks intact); "Looks intact" is exclusive.
   - **Could you see any of these?** The post's distinctive marks as checkbox
     rows with the owner's photo (`confirmed_feature_ids`; absent when the
     post has none; the screen seeds `confirmableFeatures`, and the car as
     `reportedCar`, from one `get_post_detail` call, best-effort via
     `lib/reportSeed.ts`. Both are read-only seeds and never sent).
   - **A note for the owner**: multiline, with a 0/500 counter.
   One way on: the footer reads **Skip** until something is added, then
   **Continue** (`ctaLabel` as a function); "N details added" ("Nothing added
   yet" at 0, always shown so the page never jumps) counts above.
3. **Check and send** (`components/ConfirmStep.tsx`, redesigned 2026-10-02
   on the GOV.UK check-answers pattern): labelled sections.
   - **You're reporting**: the car from the listing (its first photo across
     the top, then the plate and colour make model on one line), from the
     `reportedCar` seed. Hidden if the seed fetch failed; the photo drops
     out if it fails to load. Not editable.
   - **Photos** (Edit → the photos step): the real shots in three 3:4 columns,
     tap for full screen, "Library" badge on gallery photos.
   - **Where and when**: the display-only map of the CAPTURED point, "Near
     ‹area›" (or "At the spot you took the photo"), "Approximate location"
     when the fix is worse than 100 m, "Photo taken ‹ago›" from the first LIVE
     photo, and why it can't be changed. **No Edit, no manual location
     editing** (`// SAFETY`: the capture point is the evidence). No fix: "No
     location on this report — your photos still help."
   - **What you saw** (Edit → the context step): one row per answer in the
     contextLabels words (`contextReviewRows`), the marks and the note;
     "Nothing added" with an Add link when skipped.
   - Above the CTA, the step's `footerNote`: "Only the owner sees your photos
     and the exact spot. They'll see your first name, not your contact
     details." (Strictly true: the public sees that a sighting happened.)
   An Edit is a wizard edit spur: the step's button reads **Done** and
   returns here; Back cancels and restores the answers (photos taken on a
   cancelled spur are dropped). No confirm dialog, no safety banner. CTA
   **Send report**; failure keeps the wizard fully intact for retry (the
   posting flow's standard).

**Success screen:** "Report sent — thank you." → the owner can now see your
report; if your sighting leads to the recovery you'll receive the £X bounty;
you and the owner can message each other about it (chat shipped — "Message
the owner" opens the sighting-gated thread, and the copy sets the
inbox expectation). One **Done** → back to source. **No Stripe onboarding
prompt** (DOMAIN: KYC at credit, not report).

**Rate-limit gate:** the route checks `my_sighting_quota` BEFORE rendering the
wizard; at 3/3 a kind state replaces the flow ("You've sent 3 reports for this
car today — the owner has them.").

## Screens

- `ReportSightingScreen` (route `src/app/report-sighting.tsx`) — quota gate →
  wizard → success.
- `PostSightingsScreen` (route `src/app/post-sightings.tsx`, `?postId=…`) —
  the OWNER's FULL timeline: every sighting as a rail entry (newest first,
  day-grouped, movement hint), tap → the sighting detail.
- `SightingDetailScreen` (route `src/app/sighting/[sightingId].tsx`,
  `?postId=…`) — one sighting examined, laid out like the post page
  (redesigned 2026-10-08, "hard to read and understand"):
  - **Hero:** the photos full-bleed and swipeable (`PhotoPager`; a library
    photo is badged ON the photo), with a floating back header.
  - **Title:** "Seen near …", when it was seen, and the owner's decision so
    far ("Your car" / "Credited" / "Not your car", "You decided …").
  - **Where:** the map, "Approximate — within about N m", and Open in Maps
    (behind the safety confirm).
  - **What they saw:** the spotter's answers as labelled rows, in the same
    words they checked (`sightingDetailRows`), their note, and the owner's
    marks they could see.
  - **Spotted by:** their record, and View profile (fed from the narrow
    payload; no uid exists client-side). "Message" stays here while
    undecided.
  - **Safety notice.**
  - **Pinned decision bar:** "Is this your car?"
    - **Yes** credits the spotter and can't be undone, so it is confirmed
      first.
    - **Not my car** is reversible ("Actually, it is").
    - After the decision, the bar is Message (by sighting id).

  A "new sighting" push opens this page (`pushRoute`) once the server sends
  the sighting's id.
- `MySightingsScreen` (route `src/app/my-sightings.tsx`) — the SPOTTER's own
  history: every sighting they filed, newest first, with the owner's verdict.
  Rows are `ReportCard` + `CarColourTile` (a colour tile → car → where/when →
  a marked outcome), and the tile exists because `my_sighting_record` carries
  no photo, plate, location or post id — the car's colour is the only picture
  this surface is allowed. The one place a `not_mine` verdict is ever shown,
  and only to the spotter themselves.
- `PostSightingsSection` — the detail page's "Sighting activity" section,
  BOTH faces from one mount: owner preview (3 newest + warm empty + "View
  all") vs `PublicSightingTimeline` — or nothing at all (public sees no
  section while it's empty; absence is deliberate).

## The timeline's two faces (// SAFETY — the load-bearing rule)

One visual language (`SightingTimeline`: sage rail, day groups, newest dot
emphasised, NEWEST-FIRST — a live theft reads most-recent-down), two depths:

- **Owner:** everything `get_post_sightings` carries — time, area, thumbs,
  spotter chip, note, status — plus the client-side movement hint ("Most
  recent sighting is 2.1 mi north-east of the first"), computable only from
  coordinates the owner's payload already holds.
- **Public/spotter/guest:** `get_public_sighting_entries` ONLY — 5 newest
  `{sighted_at, locality}` + an earlier-count. No ids, no coordinates, no
  photos, no spotter fields, no notes — the strict zod shape is the client
  fence, the RPC's projection the server fence, and the SQL absence CHECKs
  the proof. Decision + rationale: `docs/decisions/ADR-0008`.

The public `locality` is derived at REPORT time by `derivePlaceLabels` —
one geocode yields the owner's street-grain `areaLabel` AND the public
district/city-grain `locality`; the street is excluded from the locality
fallback chain by construction.

## Data & server (migration `*_sightings.sql`)

- **Tables:** `sightings` (status default `'unverified'`, context_flags —
  8-flag whitelist since `*_sighting_context_v2.sql` — note, area_label,
  location_unavailable, parked_likelihood, direction, people_presence,
  confirmed_feature_ids uuid[]) + `sighting_photos` (path, lat/lng
  both-or-neither, accuracy_m, captured_at, position). Context-v2 fields are
  nullable/empty on older rows and every renderer treats absence as "not
  answered" (old sightings stay first-class).
- **Storage:** private `sighting-photos` bucket, paths
  `<post_id>/<spotter_id>/…`; path-based storage RLS (owner of the post OR the
  spotter reads; no public URLs; no update/delete — evidence immutability).
- **RPCs (SECURITY DEFINER):** `create_sighting` (validates active post,
  rejects the post's own owner, 3-per-spotter-per-post per rolling 24 h,
  pins paths + spotter to `auth.uid()`, derives `location_unavailable`,
  increments `profiles.sightings_reported`, machine-token errors; since
  `*_sighting_timeline.sql` also takes `p_locality` ≤80 — the public place
  grain; since `*_sighting_context_v2.sql` also `p_people_presence` and
  `p_confirmed_feature_ids` — the latter validated against THE post's
  `post_distinctive_feature` rows, deduped, max 8);
  `my_sighting_quota`; `get_post_sightings` (owner-only; carries the
  context-v2 fields + `confirmed_features` as `{id, description}`; spotter
  exposed as **first name + reputation counters + member-since ONLY** —
  never `spotter_id`/surname — the absence-test boundary);
  `get_public_sighting_entries` (the ADR-0008 carve-out: anon-granted,
  active posts only, 5 newest `{sighted_at, locality}` + earlier_count,
  identical empty shape for missing/non-active — no existence oracle);
  `mark_sighting_helpful` (owner-of-post only, `unverified` or `not_mine →
  helpful`, never back — `mark_sighting_not_mine` refuses with
  ALREADY_COUNTED; idempotent, bumps the spotter's `sightings_helpful` once, never
  re-labels `credited`, opaque `NOT_OWNER` for absent-or-not-yours).
  `get_post_detail` returns the real sighting aggregate.
- **RLS:** spotters SELECT their own rows (their history); the owner reads via
  the RPC only; anon: nothing; no client writes outside the RPC.

## Push notification — SHIPPED (2026-07-30)

This section said "NOT built — no push infra exists yet" until 2026-08-03,
which was wrong for four days. It ships as
`supabase/functions/notify-sighting/` (the name changed from the specced
`notify-owner-of-sighting`), invoked from `sightingApi.ts:306` via
`notifications/api/notifyApi.ts:50`. The DB side authorises it:
`claim_sighting_notification` verifies the caller is that sighting's own
spotter, is idempotent, and collapses per post.

**Known weakness, not a stub:** the invoke is CLIENT-side and
fire-and-forget, so a spotter's app dying between `create_sighting` and the
invoke means the owner is never pushed. Nothing is lost permanently — the
sighting is in the owner's list either way — but the URGENT half of this
feature is best-effort, which is exactly the wrong half to be best-effort.
`notifyApi.ts:18` names the fix (a `pg_net` DB trigger); it is not built.

## Logging (`[sightings]`)

`flow_entered {postId, source}` · step completions · camera/location
permission outcomes · `submitted {located, photoCount}` · `submit_failed
{code}` · `rate_limited` · `sighting_timeline_viewed {postId, face}` ·
`sighting_entry_opened {postId, sightingId}` · `sighting_detail_viewed` ·
`sighting_marked_helpful {sightingId, changed}`. **Never** coordinates, note
text, locality/area strings, or full storage paths. Health metric:
entered→submitted.

## Rules & safety applied

DOMAIN Sighting rules (in-app camera, evidence atomicity, `unverified` start,
3/day rate limit, safety line on every screen) · SECURITY_AND_TRUST §1
(spotter exposure boundary) + §6 (deny-by-default, server-owned status) ·
GPS-unavailable reports proceed flagged (DOMAIN addition, this session).

## Out of scope

Editing/deleting sightings · offline queueing (retry-in-flow only — ROADMAP) ·
sighting chains / "car has moved" re-alerts · a PUBLIC map of sighting points
(deliberately unbuilt — ADR-0008: no coordinate ever reaches a non-owner
face; the OWNER's interactive trail map shipped 2026-07-30 in
`SightingsTrailMap`, drawn purely from the owner payload) · video · crediting
(recovery flow's write) · push delivery.

Spotter history UI **shipped** — `MySightingsScreen`, above. Still out: making
its cards pressable, which would need somewhere to go. The dispute route
(`SightingDisputeScreen`) is reachable only from a push today, so a spotter who
dismissed the notification cannot reach it at all.
