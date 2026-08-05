# search-map — Explore: home feed + map search

WHAT: Owns the Explore tab: the **home feed** — an Airbnb-style sectioned
feed of stolen-car posts near the user — and the **map search** (full map +
list of active posts) that the feed's search pill, Map pill, and "See all"
links navigate to.
Primary actor: **spotter** (any signed-in user browsing); owners see their
own posts here like anyone else. Read-only feature: never writes posts,
never touches status or money.

> ## ⚠️ THE FEED HAS NO PHOTOS IN A RELEASE BUILD (found 2026-08-03)
>
> `get_home_feed` has **no photo column**, so `api/feedApi.ts:66` fills cards
> from `src/shared/lib/devSampleImages.ts`, which returns ten Unsplash cars in
> `__DEV__` and **`[]` everywhere else**. Every card in the feed, the watchlist
> and the inbox renders the placeholder on a real build.
>
> This was invisible for weeks precisely BECAUSE of the dev fallback: the app
> looked finished on every dev build anyone ever ran it on. A stand-in that is
> only convincing to the developer is worse than a visible gap.
>
> The fix is a photo column on the feed/search/nearby RPCs and a real
> `photos` field on the card schemas; the dev fallback should be deleted in
> the same change, so dev and prod agree about what exists. Until then, treat
> any screenshot of the feed as fiction. Same fallback in
> `watchlist/api/watchlistApi.ts:70,91`, `chat/api/chatApi.ts:154`,
> `vehicles/api/vehicleApi.ts:124`.

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
   the screen only when no card is up). Card tap → post detail, wired at
   `MapSearchScreen.tsx:302` (this said "TODO until the vehicles feature
   ships" long after it shipped). The card is the shared VehicleCard `map`
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
`map_pin_select` (postId), `map_cluster_zoom` (clusterId),
`map_card_view` (postId, index, trigger: pin | swipe),
`map_card_swipe` (fromIndex, toIndex). No coordinates in logs.

**Out of scope (map search)** — recovered pins (locations coarsened),
realtime, recent / named / server-saved searches,
searching a different area from within the surface (an "Area" row →
LocationPicker is a follow-up; distance frames around the current centre for
now), drawing custom areas, heatmaps.
