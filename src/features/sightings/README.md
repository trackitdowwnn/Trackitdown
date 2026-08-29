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
`intro` became optional for this flow), 4 steps, big targets, everything
optional skippable. Safety copy calm, unmissable, never lecturing.

## Steps

1. **Safety gate** (not skippable, 3-second pass) — SafetyNotice as hero:
   report from a distance / never approach / 999 first. Primary **Continue**
   plus a distinct **Call 999** (`tel:` link). Shown every time.
2. **Photos** — camera-FIRST: with no evidence yet the full-screen
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
3. **Context** (all optional) — "Anything else that helps?", four tap groups
   + the note, everything skippable and tap-again-clears:
   - **What's it doing?** — single-select state (Parked · Driving · Being
     loaded/towed), stored in `context_flags`. Parked reveals **Likely to
     stay?** (settled / street / about to move); Driving reveals the 3×3
     **compass grid** (`CompassPicker`) for the 8-way heading. Switching
     state clears the other state's follow-up.
   - **Condition at a glance** — multi-select chips: plate changed/missing ·
     damage visible · being stripped · looks intact.
   - **Could you see…?** — the post's registered distinctive marks as
     checkmarks (`confirmed_feature_ids`; section absent when the post has
     none — the screen seeds `confirmableFeatures` from `get_post_detail`
     best-effort).
   - **Anyone around?** — 3-way `people_presence` (nobody / nearby / someone
     in it); the last two reveal the fixed inline register "Don't approach —
     your report is enough."
   An empty step continues freely — skipping costs nothing.
4. **Confirm & send** — photos, a small non-interactive map of the CAPTURED
   point ("Reported near ‹area›") — display only, **no manual location
   editing** (`// SAFETY`: the capture point is the evidence), "Just now",
   chips/note. CTA **Send report**; failure keeps the wizard fully intact for
   retry (the posting flow's standard).

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
  `?postId=…`) — one sighting examined: photos large, the exact point on a
  map, chips/note, the spotter's passport row (tap → `PublicProfileSheet`,
  fed from the sighting's narrow payload — no uid exists client-side),
  **Message** (by sighting id) and **Mark helpful** (owner-side reputation
  credit; hidden once the status is no longer `unverified`).
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
  `mark_sighting_helpful` (owner-of-post only, `unverified → helpful` one
  way, idempotent, bumps the spotter's `sightings_helpful` once, never
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
