# vehicles — the post-detail screen

WHAT: The full listing page for one stolen car, Airbnb-detail-page style.
Route `/post/[id]` (the app's first dynamic route), reached from `VehicleCard`
everywhere (feed, map peek card, my-cars later). Read-only: never writes post
status or money. Actor: **spotter** (any viewer) and **owner** (their own
post); mode is decided once from the server-computed `is_owner`.

**Screens**
- `PostDetailScreen` (route `src/app/post/[id].tsx` — thin wrapper).

**Anatomy** (top → bottom)
1. **Hero** — edge-to-edge swipeable photo carousel (`PostHero`) bleeding
   behind the status bar, dark "n / m" counter pill. The `AppHeader` floats
   over it: back (left), share + flag (right), transparent → solid surface +
   hairline + title as the hero scrolls away (Reanimated scroll value).
2. **Title block** — "Make Model", `PlateChip` + colour + year, `StatusBadge`
   when not plain active, quiet meta "Last seen … near … · Posted …".
3. **Bounty block** — large terracotta bounty + "Paid to the spotter whose
   sighting leads to recovery."
4. **Trust & verification** (`TrustBlock`) — icon rows: "Ownership verified"
   (derived from `status`; the owner's own unverified post reads "Pending
   verification"), "Posted `<date>`", "Active until `<date>`" (while live).
5. **Details grid** — body type / distinguishing features as icon+label rows
   (colour shows in the title line); the whole section drops out with no data.
6. **Features** (`FeaturesGrid`) — the checkable-taxonomy amenities grid
   (`post_feature` → `vehicle_feature`); omitted when a post has none.
7. **Descriptions** — guided prompts "How to spot it" (`desc_recognise`) and
   "How it drives" (`desc_drives`), each `ReadMore`; the legacy `owner_note`
   still renders under "Owner's note" for older posts.
8. **Theft details** — `stolen_from` + `keys_taken` (coarse; never an address).
   **SAFETY**: a driveway theft's last-seen point is coarsened to ~1km for
   non-owners in `get_post_detail` (the map/feed RPCs still need the same — see
   the migration's follow-up banner and DOMAIN.md).
9. **Last seen here** — a non-interactive `AppMap` preview (`LastSeenMap`,
   `interactive={false}`) with a single pin; tap opens the full search map
   centred there (`/search-map?lat&lng`).
8. **Owner** (`OwnerBlock`, Airbnb "meet the host" placement) — **SAFETY**:
   signed-in viewers see an initial-letter avatar + "Posted by `<first name>`"
   + member-since; anonymous viewers see a de-identified "Verified owner"
   (member-since only). **No photo** — a `<owner_id>/…` avatar path would leak
   `owner_id` (→ surname). Never surname/`display_name`, `owner_id`, or contact.
   Gated server-side in `get_post_detail`; see DOMAIN.md "Owner identity on a
   post".
9. **Sighting activity — DORMANT** — the RPC returns a zero aggregate today;
   the section renders only when count > 0 and lights up when the sightings
   feature ships. **SAFETY** (SECURITY_AND_TRUST §6): aggregate count ONLY,
   never individual sightings or their locations to a non-owner.
8. **SafetyNotice** banner above the bottom bar.

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
posts, `post_photos`, and a dormant `sighting_stats` scalar. Client hard-
validates the three-variant payload with zod (`api/vehicleApi.ts`).

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
