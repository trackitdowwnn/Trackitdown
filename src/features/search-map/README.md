# search-map — Explore: home feed + map search

WHAT: Owns the Explore tab. v1 of this feature ships the **home feed** — an
Airbnb-style sectioned feed of stolen-car posts near the user — plus a stub
map-search screen that the feed's search pill, Map pill, and "See all" links
navigate to (real map/list search is this feature's next iteration).
Primary actor: **spotter** (any signed-in user browsing); owners see their
own posts here like anyone else. Read-only feature: never writes posts,
never touches status or money.

**Screens**
- `HomeFeedScreen` (route `src/app/(tabs)/explore.tsx`) — the feed.
- `MapSearchScreen` (route `src/app/search-map.tsx`) — v1 STUB: placeholder
  accepting `{ area?, query? }` params so feed links are wired for real.

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

**Out of scope (v1)** — realtime updates (pull-to-refresh only),
personalised ranking, saved-cars section, category chips, ads/featured
slots, the real map search itself, alert-settings storage.
