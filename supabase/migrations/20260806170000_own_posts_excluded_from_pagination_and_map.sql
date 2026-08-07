-- =============================================================================
-- WHAT: Completes the owner-exclusion started in
--       20260806160000_home_feed_excludes_own_posts.sql — get_nearby_posts,
--       search_posts and search_posts_count now also skip the caller's own
--       listings.
--
-- WHY:  Two reasons, one of them a bug in the previous migration.
--
--       1. get_nearby_posts is the "Near you" rail's PAGINATION
--          (src/features/search-map/api/feedApi.ts fetchNearbyPosts). Fixing
--          only get_home_feed left the feed self-contradicting: your own post
--          was absent from page 1 and reappeared on page 2 as the rail scrolled.
--          A partial rule is worse than none — it reads as a glitch.
--
--       2. The map/search surfaces are extended to match (product call
--          2026-08-06, superseding the feed-only call taken the same day). The
--          cost accepted with it: an owner can no longer find their own car on
--          the map. The OWNER-ONLY sighting trail map is unaffected — it is a
--          different surface with its own RPC, and remains how an owner follows
--          their own case.
--
--       `is distinct from`, NOT `<>` — auth.uid() is NULL for anonymous callers
--       and `owner_id <> NULL` is NULL, which would drop every row and hand
--       logged-out browsers an empty map. Same trap as the previous migration.
--
--       NOT changed: get_posts_in_viewport (retired — no caller in src/) and
--       home_feed_post_json (a serialiser that deliberately does no filtering;
--       every caller owns its own predicates).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- get_nearby_posts — the near_you rail's pagination.
-- Body copied from 20260711130000_home_feed_location_and_rpcs.sql apart from
-- v_viewer and the one added predicate.
--
-- SAFETY (carried forward): p_limit is capped at 25 so a client cannot request
--   an unbounded page. Same SECURITY DEFINER caveat as get_home_feed — RLS is
--   bypassed, so the status = 'active' predicate is load-bearing and must stay.
--   p_radius_m is clamped server-side to 1–50 miles for the same
--   anti-trilateration / unbounded-sort reasons.
-- -----------------------------------------------------------------------------
create or replace function public.get_nearby_posts(
  p_lat      double precision,
  p_lng      double precision,
  p_radius_m integer,
  p_offset   integer,
  p_limit    integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_origin geography;
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_limit  integer := least(greatest(coalesce(p_limit, 10), 1), 25);  -- hard cap 25
  -- SAFETY: clamp caller radius to 1–50 miles (default 20 miles), same as
  -- get_home_feed. 1609 m ≈ 1 mile, 80467 m ≈ 50 miles, 32187 m ≈ 20 miles.
  v_radius integer := least(greatest(coalesce(p_radius_m, 32187), 1609), 80467);
  v_viewer uuid := auth.uid();   -- NULL for anon
  v_result jsonb;
begin
  -- No location -> nothing to page (national mode is served by get_home_feed).
  if p_lat is null or p_lng is null then
    return '[]'::jsonb;
  end if;

  v_origin := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;

  select coalesce(jsonb_agg(t.j order by t.dist), '[]'::jsonb)
    into v_result
  from (
    select public.home_feed_post_json(p,
             round((ST_Distance(p.last_seen_location, v_origin) / 1609.344)::numeric, 1)) as j,
           ST_Distance(p.last_seen_location, v_origin) as dist
    from public.posts p
    where p.status = 'active'                    -- SAFETY: active only
      and p.last_seen_location is not null
      and p.owner_id is distinct from v_viewer   -- never your own listing
      and ST_DWithin(p.last_seen_location, v_origin, v_radius)
    order by dist
    offset v_offset
    limit v_limit
  ) t;

  return v_result;
end;
$$;

comment on function public.get_nearby_posts(double precision, double precision, integer, integer, integer) is
  'Pagination for the near_you rail: a flat JSON array of PostSummary, active only, nearest first, p_limit capped at 25 and radius clamped to 1–50 miles. SECURITY DEFINER (bypasses RLS) so the status predicate is load-bearing. EXCLUDES the caller''s own posts — must stay in step with get_home_feed or the rail contradicts its own first page.';


-- -----------------------------------------------------------------------------
-- search_posts — the map's results + handle total.
-- The SHARED PREDICATE appears twice here and once in search_posts_count; all
-- three must stay identical, so the owner clause is added to all three.
--
-- The two blocks below are carried forward VERBATIM from
-- 20260725100000_search_posts_rpc.sql. They are not decoration: this is now the
-- live definition, so it is what the next editor copies, and DOMAIN.md points
-- at this function's own SAFETY notes as the tracker for the driveway gap.
--
-- SAFETY (exact coordinates): like get_posts_in_viewport, this RPC returns EXACT
--   lat/lng. That is deliberate and safe ONLY because the predicate is
--   active-only: an active post's location is already public under RLS
--   (posts_select_active_public). NEVER widen this function to any other status
--   without also coarsening the coordinates.
--
-- SAFETY (driveway home-address coarsening — KNOWN GAP, carried forward): DOMAIN.md
--   requires that a `stolen_from = 'driveway'` post's last-seen point (which IS
--   the owner's home) be snapped to a ~1km grid for non-owners on the map/feed.
--   This RPC — like the retired get_posts_in_viewport — currently returns EXACT
--   lat/lng regardless of stolen_from. This is a PRE-EXISTING, latent gap (no post
--   reaches 'active' until the verification/payment flow ships, so no active
--   driveway post exists yet). As the SINGLE coordinate-emitting search RPC, this
--   is the place to add the driveway snap (or an explicit blocker/test) BEFORE
--   active driveway posts exist. Tracked with the posting flow (DOMAIN.md).
-- -----------------------------------------------------------------------------
create or replace function public.search_posts(
  p_min_lat   double precision,
  p_min_lng   double precision,
  p_max_lat   double precision,
  p_max_lng   double precision,
  p_criteria  jsonb,
  p_limit     integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_bbox  geography;
  -- Hard server cap 100; default 100; floor 1.
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_total integer;
  v_posts jsonb;
  v_viewer uuid := auth.uid();   -- NULL for anon
  -- Criteria, each extracted ONCE. Blank strings collapse to NULL (= no filter).
  v_text   text;    -- LIKE-escaped free-text term (matches make OR model)
  v_make   text;
  v_model  text;
  v_colour text;
  v_bmin   integer;
  v_bmax   integer;
  v_days   integer;
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
  v_colour := nullif(p_criteria->>'colour', '');
  v_bmin   := nullif(p_criteria->>'bounty_min',   '')::integer;
  v_bmax   := nullif(p_criteria->>'bounty_max',   '')::integer;
  v_days   := nullif(p_criteria->>'recency_days', '')::integer;

  -- total: count of ALL matching active posts (not limited) for the button/handle.
  -- SHARED PREDICATE (keep identical to the page subquery + search_posts_count).
  select count(*)
    into v_total
  from public.posts p
  where p.status = 'active'                                    -- SAFETY: active only
    and p.last_seen_location is not null
    and p.owner_id is distinct from v_viewer                   -- never your own listing
    and p.last_seen_location && v_bbox
    and (v_text   is null or (p.make  ilike '%' || v_text || '%' escape '\'
                           or p.model ilike '%' || v_text || '%' escape '\'))
    and (v_make   is null or p.make   = v_make)
    and (v_model  is null or p.model  = v_model)
    and (v_colour is null or p.colour = v_colour)
    and (v_bmin   is null or p.bounty_amount_pence >= v_bmin)
    and (v_bmax   is null or p.bounty_amount_pence <= v_bmax)
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
      public.home_feed_post_json(p, null::numeric)
        || jsonb_build_object(
             'lat', ST_Y(p.last_seen_location::geometry),
             'lng', ST_X(p.last_seen_location::geometry)
           ) as j,
      p.last_seen_at
    from public.posts p
    where p.status = 'active'                                   -- SAFETY: active only
      and p.last_seen_location is not null
      and p.owner_id is distinct from v_viewer                  -- never your own listing
      and p.last_seen_location && v_bbox
      and (v_text   is null or (p.make  ilike '%' || v_text || '%' escape '\'
                             or p.model ilike '%' || v_text || '%' escape '\'))
      and (v_make   is null or p.make   = v_make)
      and (v_model  is null or p.model  = v_model)
      and (v_colour is null or p.colour = v_colour)
      and (v_bmin   is null or p.bounty_amount_pence >= v_bmin)
      and (v_bmax   is null or p.bounty_amount_pence <= v_bmax)
      -- recency: NULL last_seen_at is dropped here (>= against NULL is NULL). Intended.
      and (v_days   is null or p.last_seen_at >= now() - (v_days || ' days')::interval)
    order by p.last_seen_at desc nulls last
    limit v_limit
  ) t;

  return jsonb_build_object('total', v_total, 'posts', v_posts);
end;
$$;

comment on function public.search_posts(double precision, double precision, double precision, double precision, jsonb, integer) is
  'Returns { total, posts } for active posts inside a lat/lng bbox matching an optional jsonb criteria bag (text=make/model ILIKE, exact make/model/colour, bounty_min/max, recency_days). SECURITY DEFINER (bypasses RLS); the UNCONDITIONAL status = active predicate is the enforcement. EXCLUDES the caller''s own posts. posts capped at 100, newest first, exact lat/lng (safe only because active locations are already public under RLS). Plate is deliberately never a filter (privacy). Degenerate/inverted bbox -> empty.';


-- -----------------------------------------------------------------------------
-- search_posts_count — the live "Show N cars" count. Its predicate must stay
-- byte-for-byte in step with search_posts, or the button promises N and the
-- map delivers N-1.
-- -----------------------------------------------------------------------------
create or replace function public.search_posts_count(
  p_min_lat   double precision,
  p_min_lng   double precision,
  p_max_lat   double precision,
  p_max_lng   double precision,
  p_criteria  jsonb
)
returns integer
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_bbox  geography;
  v_total integer;
  v_viewer uuid := auth.uid();   -- NULL for anon
  v_text   text;
  v_make   text;
  v_model  text;
  v_colour text;
  v_bmin   integer;
  v_bmax   integer;
  v_days   integer;
begin
  -- Degenerate / null / inverted bbox -> 0 (mirrors search_posts's empty result).
  if p_min_lat is null or p_min_lng is null
     or p_max_lat is null or p_max_lng is null
     or p_min_lat >= p_max_lat or p_min_lng >= p_max_lng then
    return 0;
  end if;

  v_bbox := ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)::geography;

  -- Criteria extraction — identical to search_posts (see its escaping note).
  v_text := nullif(trim(p_criteria->>'text'), '');
  v_text := replace(replace(replace(v_text, '\', '\\'), '%', '\%'), '_', '\_');
  v_make   := nullif(p_criteria->>'make',   '');
  v_model  := nullif(p_criteria->>'model',  '');
  v_colour := nullif(p_criteria->>'colour', '');
  v_bmin   := nullif(p_criteria->>'bounty_min',   '')::integer;
  v_bmax   := nullif(p_criteria->>'bounty_max',   '')::integer;
  v_days   := nullif(p_criteria->>'recency_days', '')::integer;

  -- SHARED PREDICATE (keep identical to both subqueries in search_posts).
  select count(*)
    into v_total
  from public.posts p
  where p.status = 'active'                                    -- SAFETY: active only
    and p.last_seen_location is not null
    and p.owner_id is distinct from v_viewer                   -- never your own listing
    and p.last_seen_location && v_bbox
    and (v_text   is null or (p.make  ilike '%' || v_text || '%' escape '\'
                           or p.model ilike '%' || v_text || '%' escape '\'))
    and (v_make   is null or p.make   = v_make)
    and (v_model  is null or p.model  = v_model)
    and (v_colour is null or p.colour = v_colour)
    and (v_bmin   is null or p.bounty_amount_pence >= v_bmin)
    and (v_bmax   is null or p.bounty_amount_pence <= v_bmax)
    -- recency: NULL last_seen_at is dropped here (>= against NULL is NULL). Intended.
    and (v_days   is null or p.last_seen_at >= now() - (v_days || ' days')::interval);

  return v_total;
end;
$$;

comment on function public.search_posts_count(double precision, double precision, double precision, double precision, jsonb) is
  'Cheap live count of active posts matching bbox + criteria — drives the "Show N cars" button. SAME shared predicate as search_posts, including the caller''s-own-posts exclusion; they must stay identical or the button''s count disagrees with the map.';
