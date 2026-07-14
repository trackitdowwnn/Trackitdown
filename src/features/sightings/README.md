# Sightings — report a sighted stolen car

**Actor:** a signed-in spotter. **One sentence:** the speed-first wizard where
a spotter photographs a sighted car in-app (photo + GPS + timestamp captured
atomically as evidence), optionally adds context, and sends the report —
reportable in under 60 seconds; plus the owner's read-only list of sightings
on their own post.

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
2. **Photos** — `CameraCapture` (shared/ui): in-app camera ONLY (`// SAFETY`
   cites DOMAIN — no gallery, anti-fraud). Each capture atomically bundles
   photo + GPS + timestamp. 1–3 photos, per-shot retake. Location permission
   via `PermissionPrimer`; **denied/failed GPS never blocks** — the report
   proceeds flagged `location_unavailable`. Poor accuracy (> ~100 m) is
   recorded with its value, never rejected.
3. **Context** (all optional) — "Anything else that helps?": chips (parked /
   driving / people nearby / plate changed or missing) + a short note. An
   empty step continues freely — skipping costs nothing.
4. **Confirm & send** — photos, a small non-interactive map of the CAPTURED
   point ("Reported near ‹area›") — display only, **no manual location
   editing** (`// SAFETY`: the capture point is the evidence), "Just now",
   chips/note. CTA **Send report**; failure keeps the wizard fully intact for
   retry (the posting flow's standard).

**Success screen:** "Report sent — thank you." → the owner can now see your
report; if your sighting leads to the recovery you'll receive the £X bounty.
One **Done** → back to source. No messaging promise until chat ships; **no
Stripe onboarding prompt** (DOMAIN: KYC at credit, not report).

**Rate-limit gate:** the route checks `my_sighting_quota` BEFORE rendering the
wizard; at 3/3 a kind state replaces the flow ("You've sent 3 reports for this
car today — the owner has them.").

## Screens

- `ReportSightingScreen` (route `src/app/report-sighting.tsx`) — quota gate →
  wizard → success.
- `PostSightingsScreen` (route `src/app/post-sightings.tsx`,
  `?postId=…`) — the OWNER's read-only sighting list: photos (signed reads),
  time, area, chips/note, status, spotter first name + reputation line.
  Entered from the post detail sighting-activity section (owner only).
  Marking helpful / crediting belongs to the recovery feature, not here.

## Data & server (migration `*_sightings.sql`)

- **Tables:** `sightings` (status default `'unverified'`, context_flags, note,
  area_label, location_unavailable) + `sighting_photos` (path, lat/lng
  both-or-neither, accuracy_m, captured_at, position).
- **Storage:** private `sighting-photos` bucket, paths
  `<post_id>/<spotter_id>/…`; path-based storage RLS (owner of the post OR the
  spotter reads; no public URLs; no update/delete — evidence immutability).
- **RPCs (SECURITY DEFINER):** `create_sighting` (validates active post,
  rejects the post's own owner, 3-per-spotter-per-post per rolling 24 h,
  pins paths + spotter to `auth.uid()`, derives `location_unavailable`,
  increments `profiles.sightings_reported`, machine-token errors);
  `my_sighting_quota`; `get_post_sightings` (owner-only; spotter exposed as
  **first name + reputation counters + member-since ONLY** — never
  `spotter_id`/surname — the absence-test boundary). `get_post_detail` now
  returns the real sighting aggregate.
- **RLS:** spotters SELECT their own rows (their history); the owner reads via
  the RPC only; anon: nothing; no client writes outside the RPC.

## Push notification — honest stub

`notify-owner-of-sighting` is **NOT built**: no push infra exists yet (no
expo-notifications, no token storage, no deployed Edge Functions). The owner
"is notified" only in the in-app sense (the aggregate + their list). The
notifications feature adds the Edge Function + trigger — ROADMAP.

## Logging (`[sightings]`)

`flow_entered {postId, source}` · step completions · camera/location
permission outcomes · `submitted {located, photoCount}` · `submit_failed
{code}` · `rate_limited`. **Never** coordinates, note text, or full storage
paths. Health metric: entered→submitted.

## Rules & safety applied

DOMAIN Sighting rules (in-app camera, evidence atomicity, `unverified` start,
3/day rate limit, safety line on every screen) · SECURITY_AND_TRUST §1
(spotter exposure boundary) + §6 (deny-by-default, server-owned status) ·
GPS-unavailable reports proceed flagged (DOMAIN addition, this session).

## Out of scope

Editing/deleting sightings · offline queueing (retry-in-flow only — ROADMAP) ·
sighting chains / "car has moved" re-alerts · video · marking helpful /
crediting · push delivery · spotter history UI (data/RLS ready; screen later).
