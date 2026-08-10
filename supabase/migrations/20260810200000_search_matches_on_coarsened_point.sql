-- =============================================================================
-- WHAT: Makes the search RPCs MATCH and MEASURE on the coarsened point, not
--       merely emit it — closing the bbox bisection oracle that still exposed
--       a driveway theft's exact home address.
--
-- WHY:  20260810160000 snapped the pin search_posts EMITS. It left both
--       functions matching on `p.last_seen_location` — the exact point — so an
--       anonymous caller could narrow p_criteria to a single post, then bisect
--       the bbox axis by axis watching search_posts_count flip 1 -> 0, and
--       recover the true location to sub-metre precision in a few dozen
--       requests. Emitting a blurred point while answering precise questions
--       about the sharp one is not coarsening.
--
--       That migration's header framed "the row predicate is untouched" as a
--       safety property. It was the opposite, and is corrected here.
--
--       get_home_feed already had the right shape for its recovered-post rule:
--       match AND measure on the snapped point (20260711130000). This applies
--       the same discipline to search.
--
-- THE INDEX. `p.last_seen_location && v_bbox` is what posts_last_seen_location_gix
--       serves. Replacing it with an expression would force a sequential scan
--       for EVERY post, not just driveway ones — a real cost on the app's
--       hottest query to fix a leak affecting a minority of rows. So the
--       predicate is now two lines:
--         1. `p.last_seen_location && v_bbox_pad` — index-served, and PADDED by
--            one 0.01° cell so it is always a superset (a snap moves a point by
--            at most half a cell, so nothing that should match is filtered out
--            before line 2 sees it).
--         2. `pin.geog && v_bbox` — the authoritative membership test, on the
--            coarsened point.
--       The pre-filter narrows; the second line decides. Neither alone is
--       correct, and the order matters only for speed.
--
-- CONSEQUENCE, deliberate: a driveway post is now discoverable only at ~1km
--       grain. Panning a tight box around its true location no longer reveals
--       it more precisely than the grid — which is the entire point. Its pin,
--       its membership and its distance now all agree, because all three read
--       the same `pin.geog`.
--
--       ⚠️ STILL OPEN after this: feed `distance_miles` (get_home_feed /
--       get_nearby_posts) is computed from the exact point for active posts,
--       so varying the origin trilaterates a driveway home. Different
--       functions, different change. See docs/SECURITY_AND_TRUST.md §2.
--
--       ⚠️ NEXT EDITOR: the live definition of BOTH functions is now THIS file.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- search_posts — results + total. The SHARED PREDICATE appears twice here and
-- once in search_posts_count; all three must stay identical.
--
-- SAFETY (status enforcement — TIER 1): SECURITY DEFINER, so RLS is bypassed
--   and the UNCONDITIONAL `status = 'active'` predicate IS the enforcement. No
--   parameter, criteria key or code path relaxes it.
--
-- SAFETY (exact coordinates): this RPC emits coordinates. That is safe ONLY
--   because the predicate is active-only (an active post's location is public
--   under RLS) and because driveway points are coarsened. NEVER widen the
--   status set without revisiting both.
--
-- SAFETY (home-address coarsening): see the header. Snapped for membership,
--   distance and emission alike.
--
-- SAFETY (caller-supplied origin): p_origin_lat/p_origin_lng are the exact
--   centre of the bbox sent in the same call, so they are arithmetically
--   redundant — the corners already encode them. ⚠️ If the origin is ever
--   DECOUPLED from the bbox, that argument collapses and it needs a
--   SECURITY_AND_TRUST entry.
--
-- SAFETY (radius clamp): p_radius_m is anon-reachable and clamped to 1–50
--   miles. That buys performance and range consistency, NOT confidentiality.
--
-- CASE-INSENSITIVE MATCHING: make/model/colour/body_type compare
--   lower(btrim(...)) on BOTH sides. See 20260807110000 for what happens when
--   this is silently dropped.
-- -----------------------------------------------------------------------------
create or replace function public.search_posts(
  p_min_lat   double precision,
  p_min_lng   double precision,
  p_max_lat   double precision,
  p_max_lng   double precision,
  p_criteria  jsonb,
  p_limit     integer,
  -- GEO ORIGIN + RADIUS. Named parameters rather than p_criteria keys, for
  -- three reasons: get_home_feed(p_lat, p_lng, p_radius_m) sets the house
  -- precedent; every existing p_criteria key is a POST ATTRIBUTE while an
  -- origin is a frame of reference; and a caller-supplied location should be
  -- visible in \df and in this function's comment, not buried in a bag.
  -- DEFAULT NULL so a pre-migration client is still a valid caller.
  p_origin_lat double precision default null,
  p_origin_lng double precision default null,
  p_radius_m   integer          default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_bbox  geography;
  v_origin geography;
  -- The bbox WIDENED by one grid cell. See the predicate note.
  v_bbox_pad geography;
  -- SAFETY (radius clamp): see the header block. NULL stays NULL — deliberately
  -- NOT coalesced to a default, or every unfiltered search would silently
  -- acquire a radius and the map would stop agreeing with the bbox the client
  -- framed.
  v_radius integer := case when p_radius_m is null then null
                           else least(greatest(p_radius_m, 1609), 80467) end;
  -- Hard server cap 100; default 100; floor 1.
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_total integer;
  v_posts jsonb;
  v_viewer uuid := auth.uid();   -- NULL for anon
  -- Criteria, each extracted ONCE. Blank strings collapse to NULL (= no filter).
  v_text    text;    -- LIKE-escaped free-text term (matches make OR model)
  v_make    text;
  v_model   text;
  v_colours text[];  -- already lower(btrim(...))'d
  v_bodies  text[];  -- already lower(btrim(...))'d
  v_bmin    integer;
  v_bmax    integer;
  v_ymin    integer;
  v_ymax    integer;
  v_days    integer;
  -- Absolute last-seen window. GUARDED parse, not a bare ::timestamptz cast —
  -- see the file header.
  v_from    timestamptz;
  v_to      timestamptz;
begin
  -- Guard degenerate input: any null coordinate, or a zero-area / inverted box
  -- (min >= max on either axis) yields nothing. Returned as an empty result so
  -- the client renders "0 cars" rather than erroring.
  if p_min_lat is null or p_min_lng is null
     or p_max_lat is null or p_max_lng is null
     or p_min_lat >= p_max_lat or p_min_lng >= p_max_lng then
    return jsonb_build_object('total', 0, 'posts', '[]'::jsonb);
  end if;

  -- Bounding box. ST_MakeEnvelope takes (xmin=min_lng, ymin=min_lat,
  -- xmax=max_lng, ymax=max_lat) — lng first. The && overlap operator on
  -- geography is served by the GiST index posts_last_seen_location_gix.
  -- ANTIMERIDIAN: UK-only app — dateline-crossing viewports are deliberately
  -- unsupported (no ±180° split); the guard above already rejects min >= max.
  v_bbox := ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)::geography;
  -- Padded by one 0.01° cell so a driveway post whose SNAPPED point falls
  -- inside the view is still a candidate even when its exact point is just
  -- outside it. A snap moves a point by at most half a cell.
  v_bbox_pad := ST_MakeEnvelope(p_min_lng - 0.01, p_min_lat - 0.01,
                                p_max_lng + 0.01, p_max_lat + 0.01, 4326)::geography;

  -- ORIGIN. ST_MakePoint takes lng first. Built ONLY when BOTH coordinates AND
  -- a radius arrived: a client sending one without the other degrades to
  -- bbox-only rather than returning an empty map, which is a failure the user
  -- can neither see nor fix.
  if p_origin_lat is not null and p_origin_lng is not null and v_radius is not null then
    v_origin := ST_SetSRID(ST_MakePoint(p_origin_lng, p_origin_lat), 4326)::geography;
  end if;

  -- Extract criteria. nullif(...,'') turns an absent OR blank key into NULL so
  -- every predicate below is skipped by its `v_x is null` guard.
  -- LIKE-ESCAPING: a raw free-text term is escaped BEFORE it is wrapped in
  -- '%...%' so a user typing '%' or '_' cannot turn the search into match-all /
  -- match-any. Escape the escape char '\' FIRST, then the wildcards '%' and '_',
  -- and pair the ILIKE with `escape '\'`. Result: wildcards typed by the user
  -- are treated as literal characters.
  v_text := nullif(trim(p_criteria->>'text'), '');
  v_text := replace(replace(replace(v_text, '\', '\\'), '%', '\%'), '_', '\_');
  v_make   := nullif(p_criteria->>'make',   '');
  v_model  := nullif(p_criteria->>'model',  '');
  v_bmin   := nullif(p_criteria->>'bounty_min',   '')::integer;
  v_bmax   := nullif(p_criteria->>'bounty_max',   '')::integer;
  v_ymin   := nullif(p_criteria->>'year_min',     '')::integer;
  v_ymax   := nullif(p_criteria->>'year_max',     '')::integer;
  v_days   := nullif(p_criteria->>'recency_days', '')::integer;
  v_from   := public.search_criteria_ts(p_criteria, 'seen_from');
  v_to     := public.search_criteria_ts(p_criteria, 'seen_to');

  -- MULTI-SELECT FACETS. Lowered/trimmed ONCE here so the row predicate stays a
  -- plain `= any(...)` against a prepared array and keeps the SAME
  -- lower(btrim(...))-on-both-sides comparison the scalar facets use. Blank
  -- entries are dropped; an absent, wrongly-typed or empty value collapses to
  -- NULL = "no filter", so {"colours": []} means ANY, never NOTHING.
  select nullif(array_agg(lower(btrim(e))) filter (where btrim(e) <> ''), '{}'::text[])
    into v_colours
  from jsonb_array_elements_text(
         case when jsonb_typeof(p_criteria->'colours') = 'array'
              then p_criteria->'colours' else '[]'::jsonb end) as e;

  -- LEGACY ALIAS: a client older than this migration sends a singular `colour`
  -- string. Honoured because the failure mode is SILENT (see the file header).
  -- Remove once no pre-2026-08-10 build can reach production.
  if v_colours is null and nullif(p_criteria->>'colour', '') is not null then
    v_colours := array[lower(btrim(p_criteria->>'colour'))];
  end if;

  select nullif(array_agg(lower(btrim(e))) filter (where btrim(e) <> ''), '{}'::text[])
    into v_bodies
  from jsonb_array_elements_text(
         case when jsonb_typeof(p_criteria->'body_types') = 'array'
              then p_criteria->'body_types' else '[]'::jsonb end) as e;

  -- Bound the caller's arrays. The whole vocabulary is 15 colours / 9 body
  -- types, so anything longer is malformed or hostile; same posture as the
  -- p_limit and radius clamps.
  if array_length(v_colours, 1) > 32 then v_colours := v_colours[1:32]; end if;
  if array_length(v_bodies,  1) > 32 then v_bodies  := v_bodies[1:32];  end if;

  -- total: count of ALL matching active posts (not limited) for the button/handle.
  -- SHARED PREDICATE (keep identical to the page subquery + search_posts_count).
  select count(*)
    into v_total
  from public.posts p
  -- SAFETY (home-address coarsening): stolen_from = 'driveway' means the
  -- last-seen point IS the victim's home, so it is snapped to the same ~1km
  -- grid get_post_detail uses. Computed ONCE here and used for membership,
  -- distance AND emission, so those three can never disagree.
  -- No owner check: the predicate below already excludes the caller's own
  -- posts, so every row is a non-owner view by construction.
  cross join lateral (
    select case
             when p.stolen_from = 'driveway'
               then ST_SnapToGrid(p.last_seen_location::geometry, 0.01)::geography
             else p.last_seen_location
           end as geog
  ) pin
  where p.status = 'active'                                    -- SAFETY: active only
    and p.last_seen_location is not null
    and p.owner_id is distinct from v_viewer                   -- never your own listing
    -- GEO MEMBERSHIP runs on pin.geog, the COARSENED point — not on
    -- p.last_seen_location. Emitting a snapped pin while matching on the exact
    -- one left the bbox a bisection oracle: shrink the box around a driveway
    -- post and watch the count flip, and you recover the home to sub-metre
    -- precision in a few dozen anonymous calls. get_home_feed does the same
    -- for recovered posts: match AND measure on the snapped point.
    --
    -- The first line is an INDEX PRE-FILTER, not the answer: it keeps
    -- posts_last_seen_location_gix serving the query (an expression here would
    -- force a seq scan for every post, not just driveway ones), and it is
    -- padded so it can only ever be a superset. The second line decides.
    and p.last_seen_location && v_bbox_pad
    and pin.geog && v_bbox
    -- DISTANCE — applied ON TOP of the bbox, never instead of it. Both read the
    -- same GiST index (posts_last_seen_location_gix): PostGIS expands
    -- ST_DWithin on geography into an && bbox test plus an exact recheck, so
    -- this is a cheap second filter on an already-narrowed set, not a seq scan.
    -- use_spheroid stays at its default true, matching match_alert_zones —
    -- search and alerts must not measure distance differently.
    and (v_origin is null or ST_DWithin(pin.geog, v_origin, v_radius))
    and (v_text   is null or (p.make  ilike '%' || v_text || '%' escape '\'
                           or p.model ilike '%' || v_text || '%' escape '\'))
    -- lower(btrim(...)) on BOTH sides: posts.make/model/colour/body_type have no
    -- CHECK and no normalisation, so an exact `=` drops the owner who typed
    -- "bmw". Identical to match_alert_zones — search and alerts must never
    -- disagree.
    and (v_make   is null or lower(btrim(p.make))   = lower(btrim(v_make)))
    and (v_model  is null or lower(btrim(p.model))  = lower(btrim(v_model)))
    -- MULTI-SELECT: `= any(...)`, NOT `&&`. p.colour and p.body_type are SCALAR
    -- columns, so this is scalar-in-set; `&&` is array-overlap and would not
    -- even typecheck. A NULL colour/body_type drops out while its filter is on,
    -- the same shape as the recency line: a post that never said what colour it
    -- is has not told us it is blue.
    and (v_colours is null or lower(btrim(p.colour))    = any(v_colours))
    and (v_bodies  is null or lower(btrim(p.body_type)) = any(v_bodies))
    -- YEAR: posts.year is NULLABLE (the wizard's year step is optional), and a
    -- NULL year is dropped by BOTH comparisons. DELIBERATE: adding
    -- `or p.year is null` would make "2020–2024" return 1998 cars, which reads
    -- as a broken filter. The cost is visible — the live "Show N cars" count
    -- falls the moment a year bound is set — rather than hidden.
    and (v_ymin   is null or p.year >= v_ymin)
    and (v_ymax   is null or p.year <= v_ymax)
    and (v_bmin   is null or p.bounty_amount_pence >= v_bmin)
    and (v_bmax   is null or p.bounty_amount_pence <= v_bmax)
    -- ABSOLUTE WINDOW. seen_to is HALF-OPEN (< not <=): last_seen_at is a
    -- timestamp and the user picks a DATE, so the client sends the start of the
    -- day AFTER the one chosen. An inclusive <= would silently drop a car last
    -- seen at 14:00 on the end date — the very day that was asked for.
    -- A NULL last_seen_at drops out here too, same as recency below.
    and (v_from   is null or p.last_seen_at >= v_from)
    and (v_to     is null or p.last_seen_at <  v_to)
    -- recency: NULL last_seen_at is dropped here (>= against NULL is NULL). Intended.
    and (v_days   is null or p.last_seen_at >= now() - (v_days || ' days')::interval);

  -- posts: capped, newest first, each carrying exact lat/lng for its pin.
  -- SHARED PREDICATE (keep identical to the count subquery + search_posts_count).
  select coalesce(jsonb_agg(t.j order by t.last_seen_at desc nulls last), '[]'::jsonb)
    into v_posts
  from (
    select
      -- Reuse the shared summary shape (distance is null — irrelevant on a map)
      -- and add the pin coordinates. ST_Y = latitude, ST_X = longitude.
      --
      -- SAFETY (home-address coarsening): the pin comes from the LATERAL below,
      -- never straight from p.last_seen_location, so a driveway theft's home
      -- address cannot be emitted at street precision.
      public.home_feed_post_json(p, null::numeric)
        || jsonb_build_object(
             'lat', ST_Y(pin.geog::geometry),
             'lng', ST_X(pin.geog::geometry)
           ) as j,
      p.last_seen_at
    from public.posts p
    -- SAFETY (home-address coarsening): stolen_from = 'driveway' means the
    -- last-seen point IS the victim's home, so it is snapped to the same ~1km
    -- grid get_post_detail uses. Computed ONCE here and used for membership,
    -- distance AND emission, so those three can never disagree.
    -- No owner check: the predicate below already excludes the caller's own
    -- posts, so every row is a non-owner view by construction.
    cross join lateral (
      select case
               when p.stolen_from = 'driveway'
                 then ST_SnapToGrid(p.last_seen_location::geometry, 0.01)::geography
               else p.last_seen_location
             end as geog
    ) pin
    where p.status = 'active'                                   -- SAFETY: active only
      and p.last_seen_location is not null
      and p.owner_id is distinct from v_viewer                  -- never your own listing
      -- GEO MEMBERSHIP runs on pin.geog, the COARSENED point — not on
      -- p.last_seen_location. Emitting a snapped pin while matching on the exact
      -- one left the bbox a bisection oracle: shrink the box around a driveway
      -- post and watch the count flip, and you recover the home to sub-metre
      -- precision in a few dozen anonymous calls. get_home_feed does the same
      -- for recovered posts: match AND measure on the snapped point.
      --
      -- The first line is an INDEX PRE-FILTER, not the answer: it keeps
      -- posts_last_seen_location_gix serving the query (an expression here would
      -- force a seq scan for every post, not just driveway ones), and it is
      -- padded so it can only ever be a superset. The second line decides.
      and p.last_seen_location && v_bbox_pad
      and pin.geog && v_bbox
      -- DISTANCE — see the count subquery above.
      and (v_origin is null or ST_DWithin(pin.geog, v_origin, v_radius))
      and (v_text   is null or (p.make  ilike '%' || v_text || '%' escape '\'
                             or p.model ilike '%' || v_text || '%' escape '\'))
      -- lower(btrim(...)) on BOTH sides — see the count subquery above.
      and (v_make   is null or lower(btrim(p.make))   = lower(btrim(v_make)))
      and (v_model  is null or lower(btrim(p.model))  = lower(btrim(v_model)))
      and (v_colours is null or lower(btrim(p.colour))    = any(v_colours))
      and (v_bodies  is null or lower(btrim(p.body_type)) = any(v_bodies))
      and (v_ymin   is null or p.year >= v_ymin)
      and (v_ymax   is null or p.year <= v_ymax)
      and (v_bmin   is null or p.bounty_amount_pence >= v_bmin)
      and (v_bmax   is null or p.bounty_amount_pence <= v_bmax)
      -- ABSOLUTE WINDOW. seen_to is HALF-OPEN (< not <=): last_seen_at is a
      -- timestamp and the user picks a DATE, so the client sends the start of the
      -- day AFTER the one chosen. An inclusive <= would silently drop a car last
      -- seen at 14:00 on the end date — the very day that was asked for.
      -- A NULL last_seen_at drops out here too, same as recency below.
      and (v_from   is null or p.last_seen_at >= v_from)
      and (v_to     is null or p.last_seen_at <  v_to)
      -- recency: NULL last_seen_at is dropped here (>= against NULL is NULL). Intended.
      and (v_days   is null or p.last_seen_at >= now() - (v_days || ' days')::interval)
    order by p.last_seen_at desc nulls last
    limit v_limit
  ) t;

  return jsonb_build_object('total', v_total, 'posts', v_posts);
end;
$$;

comment on function public.search_posts(double precision, double precision, double precision, double precision, jsonb, integer, double precision, double precision, integer) is
  'Returns { total, posts } for active posts inside a lat/lng bbox matching an optional jsonb criteria bag (text=make/model ILIKE; make/model compared lower(btrim(...)) on BOTH sides; colours/body_types multi-select arrays compared the same way via = any(...); bounty_min/max; year_min/max; recency_days) AND, when p_origin_lat/p_origin_lng/p_radius_m are supplied, an ST_DWithin radius applied ON TOP of the bbox. The origin is the MAP CENTRE the client already derived the bbox from — never stored, never logged; the radius is clamped to 1-50 miles for performance and range consistency, not confidentiality. SECURITY DEFINER (bypasses RLS); the UNCONDITIONAL status = active predicate is the enforcement. EXCLUDES the caller''s own posts. posts capped at 100, newest first. Coordinates are exact for every theft EXCEPT stolen_from=''driveway'', whose point is the owner''s home and is snapped to a ~1km grid (matching get_post_detail) — no owner branch is needed because this function never returns the caller''s own posts. Exact coordinates elsewhere are safe only because active locations are already public under RLS. A NULL colour/body_type/year drops out while that filter is set. The singular legacy `colour` key is aliased to `colours` for pre-2026-08-10 clients. seen_from/seen_to bound posts.last_seen_at to an absolute window; seen_to is EXCLUSIVE (the client sends the start of the day after the one picked) so a car seen during the end date is not silently dropped, and a malformed date is ignored rather than raising. Plate is deliberately never a filter (privacy). Degenerate/inverted bbox -> empty.';


-- -----------------------------------------------------------------------------
-- search_posts_count — the live "Show N cars" count. Same shared predicate,
-- same coarsening. If these drift, the button promises N and the map draws N-1.
-- -----------------------------------------------------------------------------
create or replace function public.search_posts_count(
  p_min_lat   double precision,
  p_min_lng   double precision,
  p_max_lat   double precision,
  p_max_lng   double precision,
  p_criteria  jsonb,
  p_origin_lat double precision default null,
  p_origin_lng double precision default null,
  p_radius_m   integer          default null
)
returns integer
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_bbox  geography;
  v_origin geography;
  -- The bbox WIDENED by one grid cell. See the predicate note.
  v_bbox_pad geography;
  v_radius integer := case when p_radius_m is null then null
                           else least(greatest(p_radius_m, 1609), 80467) end;
  v_total integer;
  v_viewer uuid := auth.uid();   -- NULL for anon
  v_text    text;
  v_make    text;
  v_model   text;
  v_colours text[];
  v_bodies  text[];
  v_bmin    integer;
  v_bmax    integer;
  v_ymin    integer;
  v_ymax    integer;
  v_days    integer;
  -- Absolute last-seen window. GUARDED parse, not a bare ::timestamptz cast —
  -- see the file header.
  v_from    timestamptz;
  v_to      timestamptz;
begin
  -- Degenerate / null / inverted bbox -> 0 (mirrors search_posts's empty result).
  if p_min_lat is null or p_min_lng is null
     or p_max_lat is null or p_max_lng is null
     or p_min_lat >= p_max_lat or p_min_lng >= p_max_lng then
    return 0;
  end if;

  v_bbox := ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)::geography;

  -- Padded by one 0.01° cell so a driveway post whose SNAPPED point falls

  -- inside the view is still a candidate even when its exact point is just

  -- outside it. A snap moves a point by at most half a cell.

  v_bbox_pad := ST_MakeEnvelope(p_min_lng - 0.01, p_min_lat - 0.01,

                                p_max_lng + 0.01, p_max_lat + 0.01, 4326)::geography;

  if p_origin_lat is not null and p_origin_lng is not null and v_radius is not null then
    v_origin := ST_SetSRID(ST_MakePoint(p_origin_lng, p_origin_lat), 4326)::geography;
  end if;

  -- Criteria extraction — identical to search_posts (see its escaping note).
  v_text := nullif(trim(p_criteria->>'text'), '');
  v_text := replace(replace(replace(v_text, '\', '\\'), '%', '\%'), '_', '\_');
  v_make   := nullif(p_criteria->>'make',   '');
  v_model  := nullif(p_criteria->>'model',  '');
  v_bmin   := nullif(p_criteria->>'bounty_min',   '')::integer;
  v_bmax   := nullif(p_criteria->>'bounty_max',   '')::integer;
  v_ymin   := nullif(p_criteria->>'year_min',     '')::integer;
  v_ymax   := nullif(p_criteria->>'year_max',     '')::integer;
  v_days   := nullif(p_criteria->>'recency_days', '')::integer;
  v_from   := public.search_criteria_ts(p_criteria, 'seen_from');
  v_to     := public.search_criteria_ts(p_criteria, 'seen_to');

  select nullif(array_agg(lower(btrim(e))) filter (where btrim(e) <> ''), '{}'::text[])
    into v_colours
  from jsonb_array_elements_text(
         case when jsonb_typeof(p_criteria->'colours') = 'array'
              then p_criteria->'colours' else '[]'::jsonb end) as e;

  -- LEGACY ALIAS — see search_posts.
  if v_colours is null and nullif(p_criteria->>'colour', '') is not null then
    v_colours := array[lower(btrim(p_criteria->>'colour'))];
  end if;

  select nullif(array_agg(lower(btrim(e))) filter (where btrim(e) <> ''), '{}'::text[])
    into v_bodies
  from jsonb_array_elements_text(
         case when jsonb_typeof(p_criteria->'body_types') = 'array'
              then p_criteria->'body_types' else '[]'::jsonb end) as e;

  if array_length(v_colours, 1) > 32 then v_colours := v_colours[1:32]; end if;
  if array_length(v_bodies,  1) > 32 then v_bodies  := v_bodies[1:32];  end if;

  -- SHARED PREDICATE (keep identical to both subqueries in search_posts).
  select count(*)
    into v_total
  from public.posts p
  -- SAFETY (home-address coarsening): stolen_from = 'driveway' means the
  -- last-seen point IS the victim's home, so it is snapped to the same ~1km
  -- grid get_post_detail uses. Computed ONCE here and used for membership,
  -- distance AND emission, so those three can never disagree.
  -- No owner check: the predicate below already excludes the caller's own
  -- posts, so every row is a non-owner view by construction.
  cross join lateral (
    select case
             when p.stolen_from = 'driveway'
               then ST_SnapToGrid(p.last_seen_location::geometry, 0.01)::geography
             else p.last_seen_location
           end as geog
  ) pin
  where p.status = 'active'                                    -- SAFETY: active only
    and p.last_seen_location is not null
    and p.owner_id is distinct from v_viewer                   -- never your own listing
    -- GEO MEMBERSHIP runs on pin.geog, the COARSENED point — not on
    -- p.last_seen_location. Emitting a snapped pin while matching on the exact
    -- one left the bbox a bisection oracle: shrink the box around a driveway
    -- post and watch the count flip, and you recover the home to sub-metre
    -- precision in a few dozen anonymous calls. get_home_feed does the same
    -- for recovered posts: match AND measure on the snapped point.
    --
    -- The first line is an INDEX PRE-FILTER, not the answer: it keeps
    -- posts_last_seen_location_gix serving the query (an expression here would
    -- force a seq scan for every post, not just driveway ones), and it is
    -- padded so it can only ever be a superset. The second line decides.
    and p.last_seen_location && v_bbox_pad
    and pin.geog && v_bbox
    and (v_origin is null or ST_DWithin(pin.geog, v_origin, v_radius))
    and (v_text   is null or (p.make  ilike '%' || v_text || '%' escape '\'
                           or p.model ilike '%' || v_text || '%' escape '\'))
    -- lower(btrim(...)) on BOTH sides — see search_posts.
    and (v_make   is null or lower(btrim(p.make))   = lower(btrim(v_make)))
    and (v_model  is null or lower(btrim(p.model))  = lower(btrim(v_model)))
    and (v_colours is null or lower(btrim(p.colour))    = any(v_colours))
    and (v_bodies  is null or lower(btrim(p.body_type)) = any(v_bodies))
    and (v_ymin   is null or p.year >= v_ymin)
    and (v_ymax   is null or p.year <= v_ymax)
    and (v_bmin   is null or p.bounty_amount_pence >= v_bmin)
    and (v_bmax   is null or p.bounty_amount_pence <= v_bmax)
    -- ABSOLUTE WINDOW. seen_to is HALF-OPEN (< not <=): last_seen_at is a
    -- timestamp and the user picks a DATE, so the client sends the start of the
    -- day AFTER the one chosen. An inclusive <= would silently drop a car last
    -- seen at 14:00 on the end date — the very day that was asked for.
    -- A NULL last_seen_at drops out here too, same as recency below.
    and (v_from   is null or p.last_seen_at >= v_from)
    and (v_to     is null or p.last_seen_at <  v_to)
    -- recency: NULL last_seen_at is dropped here (>= against NULL is NULL). Intended.
    and (v_days   is null or p.last_seen_at >= now() - (v_days || ' days')::interval);

  return v_total;
end;
$$;

comment on function public.search_posts_count(double precision, double precision, double precision, double precision, jsonb, double precision, double precision, integer) is
  'Cheap live count of active posts matching bbox + criteria + optional origin/radius — drives the "Show N cars" button. SAME shared predicate as search_posts, including the caller''s-own-posts exclusion, the lower(btrim(...)) case-insensitive comparisons, the colours/body_types = any(...) multi-select, the year bounds, the absolute seen_from/seen_to window and the ST_DWithin radius; they must stay identical or the button''s count disagrees with the map.';
