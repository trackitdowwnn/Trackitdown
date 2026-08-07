# search-map — Explore: home feed + map search

WHAT: Owns the Explore tab: the **home feed** — an Airbnb-style sectioned
feed of stolen-car posts near the user — and the **map search** (full map +
list of active posts) that the feed's search pill, Map pill, and "See all"
links navigate to.
Primary actor: **spotter** (any signed-in user browsing). Every browse surface
here EXCLUDES your own posts (2026-08-06) — the feed, its near_you pagination,
and the map/search results and count. They are the one listing you can do
nothing about, in the place cars you could help with should be. An owner
follows their own case through the post page and the owner-only sighting trail
map instead. The rule lives in SQL (`owner_id is distinct from auth.uid()` —
never `<>`, which NULL-eliminates every row for anonymous callers); all four
RPCs must stay in step, and CHECK 20/21 in
`supabase/tests/home_feed_verification.sql` assert they do.
Read-only feature: never writes posts, never touches status or money.

> ## ✅ THE FEED HAS ITS PHOTOS (found 2026-08-03, fixed 2026-08-06)
>
> For weeks `get_home_feed` had **no photo column**, so `feedApi` filled cards
> from `src/shared/lib/devSampleImages.ts` — ten Unsplash cars in `__DEV__`,
> `[]` everywhere else. Every card in the feed, the watchlist and the inbox
> rendered a placeholder on a real build.
>
> **Why it survived so long is the lesson worth keeping.** The dev fallback
> was the bug's own camouflage: the app looked finished on every dev build
> anyone ever ran it on. A stand-in that is only convincing to the developer
> is worse than a visible gap, and `devSampleImages.ts` was deleted in the
> same commit as the fix so the two can never disagree again.
>
> The fix is in the SHARED serialiser — `home_feed_post_json` now emits
> `'photos'` as the first photo by position (`[{url}]`, or `[]`), so
> `get_home_feed`, `get_nearby_posts`, `search_posts`, `get_map_posts` and
> post detail all gained it at once, and a tenth caller added later cannot
> forget it. The client schema REQUIRES the key: a server that stops sending
> it fails loudly rather than quietly reinstating a blank feed. See
> `supabase/migrations/20260806130000_feed_photos.sql` and CHECKS 17–19 in
> `supabase/tests/home_feed_verification.sql`.

**Screens**
- `HomeFeedScreen` (route `src/app/(tabs)/explore.tsx`) — the feed.
- `MapSearchScreen` (route `src/app/search-map.tsx`) — the full map search
  (see the map-search section below); accepts `{ area?, query? }` params.

**Home feed anatomy** (top → bottom)
1. Location header: "Cars near <Area>" (title type). Area name tappable →
   `LocationPickerModal` (full-screen, "Set my area") which updates the
   feed-location preference ONLY — never alert settings.
2. Search pill: floating, radius `xl`, `surfaceSubtle`, "Search make or
   model" → opens the full search surface on the map (navigates to
   `/search-map?search=1`, which auto-opens the surface). (Copy dropped
   "plate" — plate capture is deferred, see the Search surface section.)
3. Sectioned feed (below).
4. Floating "Map" pill (dark, white text, map icon) bottom-centre → pushes
   `/search-map` (`HomeFeedScreen.tsx:175`); this line said "stub" long after
   it was wired. Hides on scroll-down, returns on scroll-up (Reanimated 4).

**Feed-location preference**
Versioned AsyncStorage key `trackitdown.feed_location_v1`:
`{ latitude, longitude, addressLabel, radiusMiles }` (zod-validated, falls
back silently on parse failure — the onboardingStorage pattern).
Resolution chain: feed pref → current location (inline permission primer
card + expo-location + reverse geocode) → national fallback ("the UK").
When the notifications feature later ships a saved alert location, it
becomes the seed value for this pref.

**Sections — config-driven**
Composed server-side, rendered from an ordered `FeedSection[]`:
`{ id, title, layout: 'hero-vertical' | 'carousel', area?, posts }`.
v1 order: `near_you` (hero, distance-ordered, paginated 10/page via
`get_nearby_posts`) → up to 3 `area_<slug>` carousels ("Recently stolen in
<Town>", ≥2 posts each) → `highest_bounties` → `recently_recovered`
(30-day window, social proof). Empty sections are omitted server-side AND
guarded client-side. National mode / good-news fallback: `recent_uk`.

**Tables** — `posts` only (read). Migration
`20260711130000_home_feed_location_and_rpcs.sql` added PostGIS,
`last_seen_location geography(Point,4326)` + GiST index, `last_seen_area`
(locality label written by the future posting flow from LocationPicker's
`addressLabel`), `recovered_at` (server-only, written by the recovery Edge
Function).

**RPCs** (no Edge Functions) — `get_home_feed(lat, lng, radius_m)` composes
the whole feed in one round trip; `get_nearby_posts(lat, lng, radius_m,
offset, limit)` paginates the hero section. Both SECURITY DEFINER with
explicit status predicates (Tier 1 SAFETY: active only; recovered states
only inside the 30-day window — see the migration's safety notes and
`supabase/tests/home_feed_verification.sql`).

**List performance** (non-negotiable) — ONE vertical FlashList; sections
flattened to typed items (`sectionHeader | heroCard | carouselRow`) with
`getItemType` recycling. Each `carouselRow` is one item wrapping a
horizontal FlatList (snap scroll, compact VehicleCards). Recycled rows
derive all state from props. Target: smooth on mid-range Android.

**States** — loading: full skeleton feed (no spinners); pull-to-refresh via
shared `ThemedRefreshControl`; cold-start empty: good-news EmptyState ("No
stolen cars reported near <Area> right now — that's a good thing") with
"Widen the area" + the `recent_uk` fallback section; error: shared
`ErrorState` + retry.

**Config** — `lib/feedConfig.ts`: radius default 20 mi (range 1–50), page
size 10, recovered window 30 days (mirrors the RPC), max 3 area carousels.

**Logging** — `createLogger('search-map')`: `feed_load`,
`feed_section_impression` (once per section per load),
`feed_location_change`. Coordinates pass through `redactLocation`.

**Out of scope (home feed)** — realtime updates (pull-to-refresh only),
personalised ranking, saved-cars section, category chips, ads/featured
slots, alert-settings storage.

---

## Map search (replaces the MapSearchScreen stub)

WHAT: The full-screen map + list search of ACTIVE stolen-car posts — the
app's centrepiece. Route `/search-map` accepting `{ area?, search? }`
(`search=1` auto-opens the search surface). Actor: spotter. Read-only.

**Anatomy (Airbnb map mechanics, our brand)**
1. Full-bleed `AppMap` under everything; floating back button top-left.
2. BOUNTY PINS — markers are near-black pill tags (the amount), not dots;
   the selected pin inverts to `surfaceInverse` (`components/MapPins.tsx`).
3. NO CLUSTERING (removed 2026-08-06) — every post in view gets its own
   marker. supercluster used to collapse dense areas into count bubbles; the
   pill/price split in item 7 does that job now, and a bubble was a tap that only
   ever led to another tap. `lib/mapPins.ts` still CULLS to the viewport,
   which is load-bearing: `result.posts` only refreshes when a search lands
   (~600ms behind the gesture), so without it a pan keeps drawing markers the
   user has already moved away from. Worst case is now
   `VIEWPORT_POST_LIMIT` (100) simultaneous markers.
   - **They mount in BATCHES, not all at once** (`hooks/useProgressivePins.ts`
     + `revealPins`). The highest-ranked markers land in the first commit and
     the long tail fills in ~20 per tick. Each marker holds `tracksViewChanges` open for
     500ms as it rasterises, so a hundred in one commit is the precise Android
     jank clustering used to hide. The reveal restarts on a landed SEARCH, not
     on a pan — a pan re-culls posts whose markers are already mounted, and
     resetting there would make visible markers disappear mid-gesture.
4. PEEK CARD (pin ↔ card loop — definitive spec). Tapping a pin springs a
   floating card up from the bottom (~250ms Reanimated spring, translateY +
   fade); the card is a horizontal pager (snap paging, ~8px neighbour peek)
   over ALL posts on the map **ordered by distance from the searched
   region's centre** (`lib/regionMath.ts` haversine — stable while the user
   pans; order changes only when a search lands). ONE source of truth in
   `hooks/useMapSelection.ts`:

   ```ts
   selectedId: string | null   // THE truth; survives re-search
   selectedIndex: number       // DERIVED: sortedPosts.findIndex (-1 = none)
   selected: MapPost | null    // DERIVED from index
   ```

   Pin styles, pager position, and camera all derive from `selectedId`;
   a re-search that drops the selected post derives index -1 → the card
   slides away, no cleanup effects. Loop guards: the pager tracks the index
   it last REPORTED (programmatic scroll echoes stay silent), and camera
   moves never write selection (selection → camera only). Swiping pans the
   camera ONLY when the pin isn't comfortably visible (region shrunk 15%
   per edge — `isComfortablyVisible`); tapping another pin animates the
   pager across. While a card is up the list sheet slides away (the card
   owns the bottom of the screen); it returns at peek on dismiss.
   Dismiss: map-background tap or Android back (back exits
   the screen only when no card is up). Card tap → post detail, wired at
   `MapSearchScreen.tsx:302` (this said "TODO until the vehicles feature
   ships" long after it shipped). The card is the shared VehicleCard `map`
   variant: photo, make/model, VISIBLE PlateChip, near-black bounty,
   distance. Selection changes announce to screen readers ("Blue BMW
   3 Series, £500 bounty — swipe for more results").
   (`components/MapCardPager.tsx`, `hooks/useMapSelection.ts`.)
5. LIST-AS-SHEET — a persistent (non-modal) gorhom sheet at peek/half/full;
   handle reads "N cars in this area" (server total), or "Searching this
   area…" while a re-search runs — it is the map's ONLY searching indicator,
   which works because a search can only run when no card is up and the sheet
   only hides when one is. The handle label is a TITLE (`typography.heading`,
   `textPrimary`), not a caption — at peek this line is the entire sheet, and
   the reference gives that slot a confident count. Body is the full
   VehicleCard list, scrolled back to the top on each landed search
   (`components/MapListSheet.tsx`).
   - **It OPENS ITSELF to half on entry**, once, a beat after the first search
     settles (`expandOnEntry`). Gated on the search rather than on mount so it
     opens onto cars instead of skeletons, and the beat lets the fit-to-results
     framing commit first — the rise then zooms out FROM the framed camera
     rather than racing it. A user who drags the sheet before the beat elapses
     cancels it; they have already said where they want it.
6. RESULTS FOLLOW THE MAP — panning re-searches itself ~600ms after the map
   settles (2026-08-06; there used to be a "Search this area" button, which
   made the user do bookkeeping the app can do itself). Three things keep it
   from being jumpy, and none is optional: `movedEnough` ignores nudges and
   momentum drift; the debounce collapses a burst of hunting gestures into ONE
   search at the final region; and it is PAUSED while a peek card is open, so
   results never change under someone who is reading — the postponed search
   runs when they close it. A failed refresh keeps the pins and says so in a
   toast; the region stays unsearched so the next pan re-attempts by itself.
   (`hooks/useViewportPosts.ts`, `lib/regionMath.ts` `movedEnough`.)
7. EVERY MARKER SHOWS ITS PRICE (2026-08-07). There is no second tier. A
   marker with no price on it reads as a GROUP — there is nothing else it
   could be saying — so the price-less `mini` pin borrowed from the reference
   was quietly claiming to be several cars; it was reported as grouping
   four times in a day. The ink argument for it (a wall of price tags is
   unreadable) was sound and beside the point.
   - Overlapping pills are fine where overlapping dots were not: a pill has an
     edge and a number, so a pile still reads as a pile of prices. The
     reference piles them too (`docs/design-refs/map/`, shot 2).
   - Markers that would stack are LEFT to stack. A marker is always drawn on
     its car. Spreading them apart (`fanOutOverlaps`) shipped on 2026-08-07 and
     was reverted the same day: keeping a constant on-screen gap needs a GROUND
     offset proportional to the zoom span, so every fanned marker slid across
     the map each time the camera settled, and moved further out the more you
     zoomed out. Markers that move are worse than markers that overlap. Do not
     reintroduce it without solving that; it is not a tuning problem.
   - `keepMarkersOnScreen` survives the same critique because it moves the
     marker's BOX (its anchor) and never its coordinate: the offset is bounded
     by the marker's own width instead of growing with the zoom.
   - Bounty rank survives for paint order (highest on top, so a tap in a crowd
     hits the car worth tapping — equal zIndex between overlapping Android
     markers is undefined) and for the assistive-tech cap (`AT_MARKER_LIMIT`).
     ⚠️ The drawn set and the reachable set therefore DIFFER; the sheet is the
     complete path and lists every car with more detail.
8. CAMERA INSETS, AND THE SHEET DRIVES THE ZOOM — the sheet and the card pager
   cover the bottom of the map, so everything that FRAMES something (card
   follow, recentre, the sort anchor, the opening frame) goes through
   `visibleRegion`/`cameraForVisible` and frames into the band the user can
   actually see. The insets TRACK THE SHEET's snap point, so raising the sheet
   zooms the map out and lowering it zooms back in. Reported via gorhom's
   `onAnimate` (as the move starts) rather than `onChange` (~250ms later), so
   map and sheet read as one gesture.
   - **The zoom uses a DIFFERENT inset from the framing** —
     `zoomInsetsForSheet` / `sheetZoomFraction`, not `insetsForSheet`. Framing
     must dodge the sheet or it centres results behind it; the zoom must not,
     or it is far too aggressive. Measured off `docs/design-refs/map/` (the
     same map at two snap positions): the reference's camera scale between
     them is 0.59, where holding the ground exactly would give 0.50 — it
     frames the whole map at PEEK and insets only by the rise above it. The
     two insets never conflict because `handleSheetSnap` applies its one on
     both sides of the move, so only the ratio survives and a round trip
     returns to the identical camera.
   Deliberately NOT react-native-maps'
   `mapPadding`: that changes what `onRegionChangeComplete` reports, and
   differently per platform, which would desync the searched bbox from the
   drawn map on one OS only.
9. RECENTRE — a top-right control flies to the device position at the current
   zoom. It asks for permission only from its own onPress; the map never
   cold-fires the OS dialog, and the blue dot is drawn only when permission is
   already granted (`components/MapRecentreButton.tsx`).

**Ordering safety.** The list is sorted by distance from the searched region,
which now moves on every settled pan — and selection is derived from the list
INDEX, so a reorder mid-read would point the pager at a different car than the
one on screen. `hooks/useSortAnchor.ts` freezes the anchor while a card is
open. Pausing the search protects MEMBERSHIP; freezing the anchor protects
ORDER; a selected card needs both.

**Entry** — the Map/search pill frames the feed's resolved location at its
radius; "See all → <Area>" forward-geocodes the town and centres there. Those
give the map somewhere to START, but the camera then RE-FRAMES ONCE around the
posts the first search returns (2026-08-06): a fixed radius opens nearly empty
in one place and crowded in another, and framing what actually came back is
honest in both. Once only, guarded by a ref — it must never re-fire when an
auto-search lands new results under someone mid-browse. Empty results keep the
entry region; framing nothing would zoom to a point.

**Data** — RPC `search_posts(min_lat, min_lng, max_lat, max_lng, criteria,
limit)` → `{ total, posts }` with exact per-post `lat`/`lng`, and the cheap
`search_posts_count(…, criteria)` → int for the live "Show N cars" button.
Both SECURITY DEFINER, **status = 'active' ONLY** (SAFETY: exact coordinates
are exposed, which is safe ONLY because active locations are already public
under RLS — NEVER widen to other statuses; contrast the coarsened recovered
section). `search_posts` with empty criteria is a strict superset of the old
`get_posts_in_viewport` (dropped in `20260725100000_search_posts_rpc.sql`).
Server LIMIT cap 100; bbox served by the GiST index; attribute filters are
residual within the bbox (no new index — a `pg_trgm` GIN on make/model is a
measured follow-up if national-zoom text search needs it). Client zod
(`api/mapApi.ts`) hard-rejects any non-active status carrying coordinates.

**Search surface** (`components/SearchSheet.tsx`) — the Airbnb "assemble
everything in one place, apply once" filter page. A FULL-SCREEN overlay (NOT an
RN Modal — a transparent Modal flickers and can't host gorhom sheets; it's an
absolute overlay in the same screen) that MORPHS out of the search pill
(measure-and-grow: `SearchSheet` measures the pill's window rect and springs the
box from it to full screen, a ghost pill label fading early, content fading in;
reduced-motion cross-fades). Header is a title + close. Body is collapsible
accordion filter cards: **Vehicle** (make/model pickers reused from the posting
flow + colour chips), **Bounty** (`MoneyRangeSlider` — the range consumer the
slider's TODO anticipated — + quick chips), **Distance** chips, and **When**
(recency) chips. A footer live-counts results (`hooks/useSearchCount.ts`,
debounced) on the shared-`Button` "Show N cars" CTA.

It opens INSTANTLY on the feed (`HomeFeedScreen` hosts it — no navigation);
"Show N cars" then navigates to the map carrying the criteria + framed region as
params, so the map skips its location-resolution loader (`MapSearchScreen`'s pill
re-opens the surface to refine). Applied criteria are STICKY across pans ("Search
this area" keeps the filter). The criteria model + its server mapping live in
`lib/searchCriteria.ts` (`toRpcCriteria` drops defaults and NEVER emits plate or
distance; `parseCriteria` validates a criteria route param fail-soft). Distance
only FRAMES the initial bbox (`regionAround`) — the geo filter is always the
bbox — so "Any" frames national. (Free-text make/model search is not exposed in
the UI; `search_posts` still supports a `text` ILIKE if it's re-added.)

**Plate search — DROPPED (deferred).** `posts.plate` is going dark (plate
capture was removed from the posting flow).
Two guardrails stay regardless: suggestions can never enumerate real plates
(the corpus is the static datasets), and `search_posts` ignores any `plate`
key in the criteria (a server test asserts this).

**States** — resolving: FullscreenLoader; loading: skeleton rows in the
sheet; empty: "No stolen cars in this area" good-news EmptyState; error:
`ErrorState` + retry in the sheet.

**Logging** — `map_search_area` (bbox SPANS only, never corners, plus the
criteria KEY names used — never their values), `search_apply` (criteria key
presence + the coarse distance band, no coordinates, no plate),
`map_pin_select` (postId), `map_recentre` (no payload),
`map_sheet_snap` (from, to — the sheet drives the camera, so without this a
drag and a pinch are indistinguishable in the log, and only one of them may
search),
`map_card_view` (postId, index, trigger: pin | swipe),
`map_card_swipe` (fromIndex, toIndex). No coordinates in logs.

**Out of scope (map search)** — recovered pins (locations coarsened),
realtime, recent / named / server-saved searches,
searching a different area from within the surface (an "Area" row →
LocationPicker is a follow-up; distance frames around the current centre for
now), drawing custom areas, heatmaps.
