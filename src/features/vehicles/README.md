# vehicles — the post-detail screen

WHAT: The full listing page for one stolen car, Airbnb-detail-page style.
Route `/post/[id]` (the app's first dynamic route), reached from `VehicleCard`
everywhere (feed, map peek card, my-cars later). Read-only: never writes post
status or money. Actor: **spotter** (any viewer) and **owner** (their own
post); mode is decided once from the server-computed `is_owner`.

**Screens**
- `PostDetailScreen` (route `src/app/post/[id].tsx` — thin wrapper).

**Anatomy** (top → bottom; the 2026-07 redesign — composition "B",
domain-reordered per docs/design-refs/post-detail/GAP_ANALYSIS.md: a
spotter's job is WHERE + WHAT TO LOOK FOR, so those outrank trust/meta.
Section rhythm 32pt / title-scale headers; the body is a `radii.xl`
rounded-top sheet overlapping the hero.)
1. **Hero** — edge-to-edge swipeable photo carousel (`PostHero`) bleeding
   behind the status bar, dark "n / m" counter pill sitting above the sheet
   curve. The `AppHeader` floats over it: back (left), share (right),
   transparent → solid surface + hairline + title as the hero scrolls away;
   the buttons' white circles fade out in the same range, leaving flat icons.
2. **Title block** — "Make Model", `PlateChip` + colour + year, `StatusBadge`
   when not plain active, quiet meta "Last seen … near … · Posted …".
3. **Bounty block** — large terracotta bounty + "Paid to the spotter whose
   sighting leads to recovery."
4. **Last seen here** (promoted) — area + time line, then a large
   (`sizes.mapPreview`) non-interactive `AppMap` preview (`LastSeenMap`,
   `interactive={false}`) with a single pin and a small expand badge; tap
   opens the full search map centred there (`/search-map?lat&lng`).
5. **What to look for** — the spotter's recognition kit in one section: body
   type / distinguishing-features rows, the checkable-taxonomy feature list
   (`FeaturesGrid`, one per row), and the guided "how to spot it" prose
   (`desc_recognise`, `ReadMore`). Renders when ANY piece exists; omitted
   entirely otherwise (old posts).
6. **How it drives** (`desc_drives`, `ReadMore`); the legacy `owner_note`
   still renders under "Owner's note" for older posts with no guided prose.
7. **Trust & verification** (`TrustBlock`) — highlight rows (48pt tile,
   headline + evidence line): "Ownership verified" (derived from `status`;
   the owner's own unverified post reads "Pending verification") with its
   V5C evidence line, "Posted `<date>`", "Active until `<date>`" (while live).
8. **Theft details** — `stolen_from` + `keys_taken` (coarse; never an address).
   **SAFETY**: a driveway theft's last-seen point is coarsened to ~1km for
   non-owners in `get_post_detail` (the map/feed RPCs still need the same — see
   the migration's follow-up banner and DOMAIN.md).
9. **Owner** (`OwnerBlock`, Airbnb "meet the host" placement) — **SAFETY**:
   signed-in viewers see an initial-letter avatar + "Posted by `<first name>`"
   + member-since; anonymous viewers see a de-identified "Verified owner"
   (member-since only). **No photo** — a `<owner_id>/…` avatar path would leak
   `owner_id` (→ surname). Never surname/`display_name`, `owner_id`, or contact.
   Gated server-side in `get_post_detail`; see DOMAIN.md "Owner identity on a
   post".
10. **Sighting activity — DORMANT** — the RPC returns a zero aggregate today;
    the section renders only when count > 0 and lights up when the sightings
    feature ships. **SAFETY** (SECURITY_AND_TRUST §6): aggregate count ONLY,
    never individual sightings or their locations to a non-owner.
    Non-owners also get a **"Message the owner"** affordance in this section
    (sighting-gated — DOMAIN Chat): a viewer who has already reported gets a
    secondary **"Message the owner"** button that opens the thread; everyone
    else gets honest copy + a quiet **"Report a sighting"** link into the
    report flow (a text link, not a second button — the sticky bar's "I've
    seen this car" is the primary route). Hidden for the owner (they reach
    spotters via their sightings list). Driven by
    `get_post_detail.viewer_has_sighting`.
11. **SafetyNotice** banner (deliberately a banner, never quiet rows), then
    the underlined "Report this post" row (moved out of the header).

**Sticky bottom bar** (`PostBottomBar`) — always visible, safe-area padded.
- **Spotter:** bounty + "reward", primary "I've seen this car" → Toast
  "coming soon" (the sightings feature isn't built yet).
- **Owner:** "Your listing" + `StatusBadge`, secondary "Manage post" → the
  my-cars tab (a stub today).

**Share / flag** — share via React Native's `Share` (`lib/postShare.ts`,
placeholder URL, `// TODO` deep links). Flag is a **Phase-4 stub**:
`ConfirmDialog` → Toast, logs only (no flags table yet).

**Data** — one `get_post_detail(p_post_id)` RPC (SECURITY DEFINER). **SAFETY:**
it gates visibility itself (RLS is bypassed) — active posts are public; the
owner sees their own in any status via `auth.uid()`; anyone else hitting a
non-active post gets `{ visible: false, closedReason }` and nothing more. It
returns `is_owner` (never `owner_id`), exact last-seen coords for visible
posts, `post_photos`, a `sighting_stats` scalar, and `viewer_has_sighting`
(caller-only: whether THIS viewer has a sighting here — gates the message
affordance; never other users' data). Client hard-validates the
three-variant payload with zod (`api/vehicleApi.ts`).

**Message the owner** (migration `20260715130000`) — the section handler
opens the thread via `openThread` (deferred `import('@/features/chat')`) when
`viewerHasSighting`, else routes to `/report-sighting`; a stale-flag or
`NO_SIGHTING` race falls back to reporting. Guests pass the `message_owner`
auth gate first.

**Schema** — migration `20260713140000_post_detail.sql`: `posts` += `year`,
`body_type`, `distinguishing_features`, `owner_note` (read-path only — the
posting wizard adds them to its write grants later); `post_photos` table +
RLS mirroring post visibility; the RPC; seed. Upload/EXIF/Storage bucket is
the posting feature's, deferred.

**States** — loading: skeleton hero + text blocks (no spinners); non-active:
graceful "recovered / no longer active" `EmptyState`; error: `ErrorState` +
retry. **Logging** `createLogger('vehicles')`: `post_view` (postId, mode).

**Shared UI built with this feature** — `AppHeader` (+ scroll fade),
`StatusBadge` (extracted from VehicleCard), `SafetyNotice`, `ReadMore`, and an
`interactive` prop on `AppMap`.

**Out of scope** — chat entry (needs a sighting first, arrives with
sightings), owner editing (my-cars), related-cars, comments, the photo upload
pipeline, and the sightings table itself.
