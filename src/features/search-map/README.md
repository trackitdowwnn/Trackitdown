# search-map — Explore: home feed + map search

WHAT: Owns the Explore tab: the **home feed** — an Airbnb-style sectioned
feed of stolen-car posts near the user — and the **map search** (full map +
list of active posts) that the feed's search pill, Map pill, and "See all"
links navigate to.
Primary actor: **spotter** (any signed-in user browsing); owners see their
own posts here like anyone else. Read-only feature: never writes posts,
never touches status or money.

**Screens**
- `HomeFeedScreen` (route `src/app/(tabs)/explore.tsx`) — the feed.
- `MapSearchScreen` (route `src/app/search-map.tsx`) — the full map search
  (see the map-search section below); accepts `{ area?, query? }` params.

**Home feed anatomy** (top → bottom)
1. Location header: "Cars near <Area>" (title type). Area name tappable →
   `LocationPickerModal` (full-screen, "Set my area") which updates the
   feed-location preference ONLY — never alert settings.
2. Search pill: floating, radius `xl`, `surfaceSubtle`, "Search make, model
   or plate" → navigates to the MapSearchScreen stub.
3. Sectioned feed (below).
4. Floating "Map" pill (dark, white text, map icon) bottom-centre → stub;
   hides on scroll-down, returns on scroll-up (Reanimated 4).

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
app's centrepiece. Route `/search-map` accepting `{ area?, query? }`
(query reserved; text search is a follow-up). Actor: spotter. Read-only.

**Anatomy (Airbnb map mechanics, our brand)**
1. Full-bleed `AppMap` under everything; floating back button top-left.
2. BOUNTY PINS — markers are near-black pill tags (the amount), not dots;
   the selected pin inverts to `surfaceInverse` (`components/MapPins.tsx`).
3. CLUSTERING — supercluster (`lib/mapClustering.ts`) over the current
   result set; clusters render as sage count bubbles; tapping zooms to fit.
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
   the screen only when no card is up). Card tap → post detail (TODO until
   the vehicles feature ships). The card is the shared VehicleCard `map`
   variant: photo, make/model, VISIBLE PlateChip, near-black bounty,
   distance. Selection changes announce to screen readers ("Blue BMW
   3 Series, £500 bounty — swipe for more results").
   (`components/MapCardPager.tsx`, `hooks/useMapSelection.ts`.)
5. LIST-AS-SHEET — a persistent (non-modal) gorhom sheet at peek/half/full;
   handle reads "N cars in this area" (server total); body is the full
   VehicleCard list (`components/MapListSheet.tsx`).
6. "SEARCH THIS AREA" — panning never auto-refreshes; a floating pill offers
   to re-search the moved viewport (`hooks/useViewportPosts.ts`,
   `lib/regionMath.ts` `movedEnough`).

**Entry** — the Map/search pill frames the feed's resolved location at its
radius; "See all → <Area>" forward-geocodes the town and centres there.

**Data** — RPC `get_posts_in_viewport(min_lat, min_lng, max_lat, max_lng,
limit)` → `{ total, posts }` with exact per-post `lat`/`lng`. SECURITY
DEFINER, **status = 'active' ONLY** (SAFETY: exact coordinates are exposed,
which is safe ONLY because active locations are already public under RLS —
NEVER widen to other statuses; contrast the coarsened recovered section).
Server LIMIT cap 100; bbox served by the GiST index. Client zod
(`api/mapApi.ts`) hard-rejects any non-active status carrying coordinates.

**States** — resolving: FullscreenLoader; loading: skeleton rows in the
sheet; empty: "No stolen cars in this area" good-news EmptyState; error:
`ErrorState` + retry in the sheet.

**Logging** — `map_search_area` (bbox SPANS only, never corners),
`map_pin_select` (postId), `map_cluster_zoom` (clusterId),
`map_card_view` (postId, index, trigger: pin | swipe),
`map_card_swipe` (fromIndex, toIndex). No coordinates in logs.

**Out of scope (map search)** — working text search (the pill is a stub),
recovered pins (locations coarsened), realtime, saved searches, drawing
custom areas, heatmaps.
