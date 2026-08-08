# vehicles — the post-detail screen

WHAT: The full listing page for one stolen car, Airbnb-detail-page style.
Route `/post/[id]` (the app's first dynamic route), reached from `VehicleCard`
everywhere (feed, map peek card, my-cars later). Read-only: never writes post
status or money. Actor: **spotter** (any viewer) and **owner** (their own
post); mode is decided once from the server-computed `is_owner`.

**Screens**
- `PostDetailScreen` (route `src/app/post/[id].tsx` — thin wrapper).
- `PostStatsScreen` (route `src/app/post-stats.tsx` — thin wrapper). **Owner
  only.** "Activity" for one listing: spotters alerted, days live/left, the
  sighting split and a 28-day sparkline, and whether anyone has been in touch.
  Flat hairline sections at the reference rhythm — no cards; see the screen
  header for why a dashboard register is the wrong one here. Reached from
  `PostManageSheet` → "View activity".

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
2. **Title cluster** (redesigned 2026-07-23) — a right-aligned "Listed on
   `<date>`" dateline hugging the sheet's curved top, then "Make Model" with
   the `PlateChip` and a colour chip inline beside it (one chip grammar; the
   colour chip reads at the plate's 14pt so the plate stays dominant),
   `StatusBadge` when not plain active, then the **stat band**: three
   hairline-divided cells — bounty (near-black) / sightings / last-seen — the
   reference's stat-module anatomy. The bounty label carries an ⓘ opening a
   `ConfirmDialog` explainer ("How the bounty works"); the old solo
   display-size bounty section was removed (it duplicated the sticky bar).
3. **Last seen here** (promoted) — the title + a place/time fact chip
   ("St Albans · 1w ago") inline, then a large
   (`sizes.mapPreview`) non-interactive `AppMap` preview (`LastSeenMap`,
   `interactive={false}`) with a single pin and a small expand badge; tap
   opens the full search map centred there (`/search-map?lat&lng`).
4. **About this car** — the reference's clamped description: the guided
   "how to spot it" prose (`desc_recognise`; older posts fall back to
   `desc_drives` then `owner_note`) clamped at 6 lines, then a grey
   `subtle` "Show more" button pushing **`/post-about`**
   (`PostAboutScreen`) — the full prose under bold subheads ("How to spot
   it", "How it drives", "Owner's note"). ALWAYS renders: a prose-less post
   shows "The owner hasn't added a description yet." (honest absence, no
   Show more).
5. **Car details** — the reference's amenities anatomy with the FULL list
   in-page (`lib/carDetails.ts`; no Show-all tap — product call
   2026-07-23): identity facts, taxonomy features, distinguishing marks,
   theft context, then muted struck-through **"Not provided"** rows naming
   the gaps (stated, never omitted — report-completeness as a trust
   device). **SAFETY**: theft context stays coarse (`stolen_from` +
   `keys_taken`, never an address); a driveway theft's last-seen point is
   coarsened to ~1km for non-owners in `get_post_detail` (the map/feed RPCs
   still need the same — see the migration's follow-up banner and DOMAIN.md).
6. **Owner** (`OwnerCard`, the reference's host-passport card — the page's
   one elevated object): centred avatar + first name + "Owner" caption
   beside a stat column (time on Trackitdown; sightings on this post).
   Calm register — "Owner", never "Meet the owner". **SAFETY**: signed-in
   viewers see an initial-letter avatar + first name; anonymous viewers a
   de-identified "Verified owner" shield. **No photo** — a `<owner_id>/…`
   avatar path would leak `owner_id` (→ surname). Never
   surname/`display_name`, `owner_id`, or contact. Gated server-side in
   `get_post_detail`; see DOMAIN.md "Owner identity on a post".
   Non-owners also get a **"Message the owner"** affordance HERE (sighting-
   gated — DOMAIN Chat): a viewer who has already reported gets a quiet grey
   (`subtle`) **"Message the owner"** button that opens the thread (the
   reference's "Message host" treatment); everyone else gets honest copy + a
   quiet **"Report a sighting"** link into the report flow (a text link, not
   a second button — the sticky bar's "I've seen this car" is the primary
   route). Hidden for the owner. Driven by
   `get_post_detail.viewer_has_sighting`.
7. **Sighting activity — DORMANT** — the RPC returns a zero aggregate today;
    the section renders only when count > 0 and lights up when the sightings
    feature ships. **SAFETY** (SECURITY_AND_TRUST §6): aggregate count ONLY,
    never individual sightings or their locations to a non-owner.
8. **SafetyNotice** banner (deliberately a banner, never quiet rows), then
    the underlined "Report this post" row (moved out of the header).
9. **More cars nearby** (`useSimilarPosts`) — the reference's "More stays
    nearby" shelf at the page's end: a full-bleed compact-`VehicleCard` rail
    from the public `get_home_feed` RPC centred on THIS car's last-seen point
    (title drops the "nearby" and the coord centring when the post has no
    coords). Reuses the feed pipeline, adds no server surface; excludes the
    post itself, caps at 6, and is quietly absent (never an error) on failure.

**Sticky bottom bar** (`PostBottomBar`) — always visible, safe-area padded.
- **Spotter:** bounty + "reward", primary "I've seen this car" → the
  report-sighting flow (auth-gated).
- **Owner:** "Your listing" + `StatusBadge`, secondary "Manage post" →
  **`PostManageSheet`**, a `BottomSheet` of `ListRow`s for THIS listing: view
  sightings, one row per section currently editable, share, and (paid posts) the
  destructive "Deactivate & refund". It used to push `/my-posts`, which bounced
  the owner off the very post they were managing. Rows are built from the
  handlers the screen passes — an absent handler means an absent row, so the
  sheet can never offer an edit the server would reject.

**Deactivate confirm** — owned by `PostDetailScreen`, not the body: the body's
"Deactivate listing" section button and the manage sheet's row both open the same
`ConfirmDialog`, so the destructive copy and the refund estimate
(`estimateRefundPence`, `src/shared/lib/money.ts`) exist exactly once. The quoted figure is an ESTIMATE;
the post-refund toast shows the server's exact amount.

**Share / flag** — share via React Native's `Share` (`lib/postShare.ts`,
placeholder URL, `// TODO` deep links). Flag is real: `ConfirmDialog` →
`flag_post` RPC → `post_flags` (`20260730110000_post_flags.sql`).

**Data** — one `get_post_detail(p_post_id)` RPC (SECURITY DEFINER). **SAFETY:**
it gates visibility itself (RLS is bypassed) — active posts are public; the
owner sees their own in any status via `auth.uid()`; anyone else hitting a
non-active post gets `{ visible: false, closedReason }` and nothing more. It
returns `is_owner` (never `owner_id`), exact last-seen coords for visible
posts, `post_photos`, a `sighting_stats` scalar, and `viewer_has_sighting`
(caller-only: whether THIS viewer has a sighting here — gates the message
affordance; never other users' data). Client hard-validates the
three-variant payload with zod (`api/vehicleApi.ts`).

**Activity data** — one `get_post_stats(p_post_id)` RPC (SECURITY DEFINER,
`20260807130000`), read by `api/postStatsApi.ts` (zod `.strict()`) via
`hooks/usePostStats.ts`. **SAFETY:** `owner_id = auth.uid()` is the only gate
and there is no user-id parameter; a post owned by someone else returns the
same `null` as one that does not exist, so the client treats `null` as
"not found", never as an error. Counts only — never rows, never identities.
Two invariants a future change must not break: `spotters_alerted` is FLOORED to
0 below 5 (an unfloored count is a density oracle over strangers' alert zones
for the price of posting a car), and the count reads `kind = 'alert'` rows ONLY
— recovery/credited/sighting notifications carry the same `postId` but go to
WATCHERS, and DOMAIN.md forbids exposing watcher counts to an owner. Both are
pinned by `post_detail_verification.sql` CHECK 16.

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
`StatusBadge` (extracted from VehicleCard), `SafetyNotice`, the `subtle`
`Button` variant, and an `interactive` prop on `AppMap`.

**Out of scope** — chat entry (needs a sighting first, arrives with
sightings), owner editing (my-cars), related-cars, comments, the photo upload
pipeline, and the sightings table itself.
