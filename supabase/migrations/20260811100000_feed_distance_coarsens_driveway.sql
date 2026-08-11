-- =============================================================================
-- WHAT: Computes feed `distance_miles` from the COARSENED point for driveway
--       thefts, closing the last route to a victim's home address.
--
-- WHY:  get_home_feed and get_nearby_posts derived distance from the EXACT
--       last_seen_location. Distance is rounded to 0.1 mile (~160m), so varying
--       p_lat/p_lng across calls trilaterates a post to roughly street
--       precision — well inside the ~1km grid a driveway theft is supposed to
--       be blurred to. Neither function emits coordinates, so this was the only
--       way in, and it survived the coarsening added to search_posts
--       (20260810160000 / 20260810200000).
--
--       ⚠️ The SAFETY note carried in get_home_feed claims the radius clamp
--       defends trilateration. It does not: the clamp bounds the RADIUS, not
--       the precision of the distance returned for a post inside it. That note
--       is corrected below rather than left to mislead the next reader.
--
-- HOW:  One helper, post_pin_geog, so the rule lives in a single place and the
--       three functions that need it cannot drift. Both distance sites in
--       get_nearby_posts are patched — the emitted value AND the ordering — so
--       a driveway post sorts by the same point it reports.
--
--       No membership predicate changes: ST_DWithin still runs on the exact
--       point, so a driveway post appears in exactly the feeds it did before.
--       This changes what a returned row DISCLOSES, not which rows return —
--       and unlike search_posts there is no bbox to bisect here, because the
--       caller supplies a centre and radius rather than a rectangle.
--
--       ⚠️ NEXT EDITOR: the live definitions of get_home_feed and
--       get_nearby_posts are THIS file.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- post_pin_geog — the point a post may be located BY, for non-owners.
--
-- A driveway theft's last-seen point IS the victim's home address, so it is
-- snapped to the same ~1km grid get_post_detail and search_posts use. Every
-- other theft keeps its exact point. IMMUTABLE and pure, so it inlines and the
-- planner can still use posts_last_seen_location_gix for predicates that do
-- not go through it.
-- -----------------------------------------------------------------------------
create or replace function public.post_pin_geog(
  p_location geography,
  p_stolen_from text
)
returns geography
language sql
immutable
set search_path = public, extensions
as $$
  select case
           when p_stolen_from = 'driveway'
             then ST_SnapToGrid(p_location::geometry, 0.01)::geography
           else p_location
         end;
$$;


create or replace function public.get_home_feed(
  p_lat      double precision,
  p_lng      double precision,
  p_radius_m integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  -- National / fallback mode when the client has no usable location fix.
  v_national boolean := (p_lat is null or p_lng is null);
  v_origin   geography;
  -- SAFETY: clamp caller radius to 1–50 miles (default 20 miles). 1609 m ≈ 1
  -- mile, 80467 m ≈ 50 miles, 32187 m ≈ 20 miles.
  v_radius   integer := least(greatest(coalesce(p_radius_m, 32187), 1609), 80467);
  -- The caller, or NULL for anon. Read once: auth.uid() parses the request JWT
  -- on every call, and it is referenced from four predicates below.
  v_viewer   uuid := auth.uid();
  v_near      jsonb := '[]'::jsonb;
  v_areas     jsonb := '[]'::jsonb;
  v_highest   jsonb := '[]'::jsonb;
  v_recovered jsonb := '[]'::jsonb;
  v_recent    jsonb := '[]'::jsonb;
  v_sections  jsonb := '[]'::jsonb;
begin
  -- ---------------------------------------------------------------------------
  -- NATIONAL MODE: no location -> only the most recent active posts UK-wide.
  -- ---------------------------------------------------------------------------
  if v_national then
    select coalesce(jsonb_agg(t.j order by t.created_at desc), '[]'::jsonb)
      into v_recent
    from (
      select public.home_feed_post_json(p, null::numeric) as j, p.created_at
      from public.posts p
      where p.status = 'active'                 -- SAFETY: active only
        and p.owner_id is distinct from v_viewer  -- never your own listing
      order by p.created_at desc
      limit 10
    ) t;

    if jsonb_array_length(v_recent) > 0 then
      v_sections := jsonb_build_array(
        jsonb_build_object(
          'id', 'recent_uk', 'title', 'Recent posts across the UK',
          'layout', 'hero-vertical', 'posts', v_recent));
    end if;

    return jsonb_build_object('sections', v_sections);
  end if;

  -- ---------------------------------------------------------------------------
  -- LOCAL MODE. Origin point (note ST_MakePoint takes lng, lat).
  -- ---------------------------------------------------------------------------
  v_origin := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;

  -- Build near_you, the area carousels, and highest_bounties from ONE in-radius
  -- active set; recently_recovered scans the recovered window separately (it is
  -- a different status set). Each CTE re-states its status predicate.
  with in_radius as (
    -- Active posts with a location inside the requested radius. `p as post`
    -- keeps the whole row so home_feed_post_json can consume it downstream.
    -- Excluding the viewer HERE covers near_you, the area carousels and
    -- highest_bounties in one place — they all read from this CTE.
    select p as post, ST_Distance(public.post_pin_geog(p.last_seen_location, p.stolen_from), v_origin) as dist
    from public.posts p
    where p.status = 'active'                    -- SAFETY: active only
      and p.last_seen_location is not null
      and p.owner_id is distinct from v_viewer   -- never your own listing
      and ST_DWithin(p.last_seen_location, v_origin, v_radius)
  ),
  near_you as (
    select coalesce(jsonb_agg(t.j order by t.dist), '[]'::jsonb) as posts
    from (
      select public.home_feed_post_json(ir.post,
               round((ir.dist / 1609.344)::numeric, 1)) as j, ir.dist
      from in_radius ir
      order by ir.dist
      limit 10                                   -- first page; rest via get_nearby_posts
    ) t
  ),
  areas as (
    -- Nearest (min distance) up to 3 localities that have >= 2 in-radius posts.
    select (ir.post).last_seen_area as area, min(ir.dist) as min_dist
    from in_radius ir
    where (ir.post).last_seen_area is not null
    group by (ir.post).last_seen_area
    having count(*) >= 2
    order by min_dist
    limit 3
  ),
  area_sections as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id',     'area_' || public.slugify(a.area),
        'title',  'Recently stolen in ' || a.area,
        'layout', 'carousel',
        'area',   a.area,
        'posts',  (
          -- Up to 10 of this locality's in-radius active posts, newest first.
          select coalesce(jsonb_agg(t.j order by t.last_seen_at desc nulls last),
                          '[]'::jsonb)
          from (
            select public.home_feed_post_json(ir.post,
                     round((ir.dist / 1609.344)::numeric, 1)) as j,
                   (ir.post).last_seen_at as last_seen_at
            from in_radius ir
            where (ir.post).last_seen_area = a.area
            order by (ir.post).last_seen_at desc nulls last
            limit 10
          ) t
        )
      )
      order by a.min_dist
    ), '[]'::jsonb) as sections
    from areas a
  ),
  highest as (
    select coalesce(jsonb_agg(t.j order by t.bounty desc), '[]'::jsonb) as posts
    from (
      select public.home_feed_post_json(ir.post,
               round((ir.dist / 1609.344)::numeric, 1)) as j,
             (ir.post).bounty_amount_pence as bounty
      from in_radius ir
      order by (ir.post).bounty_amount_pence desc
      limit 10
    ) t
  ),
  recovered as (
    -- SAFETY (anti-trilateration): unlike active posts (whose exact location is
    -- already public under RLS), a recovered post's precise point is withheld.
    -- Matching + measuring on the EXACT point would leak it back: an anon caller
    -- could vary the origin/radius and read the 0.1-mile distance to trilaterate
    -- the point. So for THIS section only we snap the location to a ~1 km grid
    -- (ST_SnapToGrid on a ~0.01° cell, matching the client's redactLocation
    -- coarseness) and both match AND measure on that snapped point, returning
    -- distance in WHOLE miles. (This also means the GiST index can't serve this
    -- predicate — acceptable: the recovered+30-day set is tiny and narrowed by
    -- posts_recovered_recent_idx first.)
    select coalesce(jsonb_agg(t.j order by t.recovered_at desc), '[]'::jsonb) as posts
    from (
      select public.home_feed_post_json(p,
               round((ST_Distance(
                        ST_SnapToGrid(p.last_seen_location::geometry, 0.01)::geography,
                        v_origin) / 1609.344)::numeric, 0)) as j,
             p.recovered_at
      from public.posts p
      where p.status in ('recovered', 'recovered_no_spotter')  -- SAFETY: recovered only
        and p.recovered_at is not null
        and p.recovered_at >= now() - interval '30 days'       -- SAFETY: 30-day window
        and p.last_seen_location is not null
        and p.owner_id is distinct from v_viewer               -- never your own listing
        and ST_DWithin(
              ST_SnapToGrid(p.last_seen_location::geometry, 0.01)::geography,
              v_origin, v_radius)
      order by p.recovered_at desc
      limit 10
    ) t
  )
  select near_you.posts, area_sections.sections, highest.posts, recovered.posts
    into v_near, v_areas, v_highest, v_recovered
  from near_you, area_sections, highest, recovered;

  -- ---------------------------------------------------------------------------
  -- Assemble sections in fixed order; omit any that came back empty.
  -- ---------------------------------------------------------------------------
  if jsonb_array_length(v_near) > 0 then
    v_sections := v_sections || jsonb_build_array(
      jsonb_build_object(
        'id', 'near_you', 'title', 'Near you',
        'layout', 'hero-vertical', 'posts', v_near));
  end if;

  -- v_areas is already a JSON array of section objects, each with >= 2 posts.
  v_sections := v_sections || v_areas;

  if jsonb_array_length(v_highest) > 0 then
    v_sections := v_sections || jsonb_build_array(
      jsonb_build_object(
        'id', 'highest_bounties', 'title', 'Highest bounties nearby',
        'layout', 'carousel', 'posts', v_highest));
  end if;

  if jsonb_array_length(v_recovered) > 0 then
    v_sections := v_sections || jsonb_build_array(
      jsonb_build_object(
        'id', 'recently_recovered', 'title', 'Recently recovered near you',
        'layout', 'carousel', 'posts', v_recovered));
  end if;

  -- Good-news fallback: nothing active within the radius, but the country is
  -- not empty -> show recent UK posts under the empty state.
  if jsonb_array_length(v_near) = 0 then
    select coalesce(jsonb_agg(t.j order by t.created_at desc), '[]'::jsonb)
      into v_recent
    from (
      select public.home_feed_post_json(p, null::numeric) as j, p.created_at
      from public.posts p
      where p.status = 'active'                 -- SAFETY: active only
        and p.owner_id is distinct from v_viewer  -- never your own listing
      order by p.created_at desc
      limit 10
    ) t;

    if jsonb_array_length(v_recent) > 0 then
      v_sections := v_sections || jsonb_build_array(
        jsonb_build_object(
          'id', 'recent_uk', 'title', 'Recent posts across the UK',
          'layout', 'hero-vertical', 'posts', v_recent));
    end if;
  end if;

  return jsonb_build_object('sections', v_sections);
end;
$$;

comment on function public.get_home_feed(double precision, double precision, integer) is
  'Composes the Explore home feed server-side in one call: { sections: [...] }. SECURITY DEFINER (bypasses RLS) so every query carries an explicit status predicate — active only, except recently_recovered (recovered states within 30 days, location snapped to a ~1km grid). Radius clamped to 1–50 miles. EXCLUDES the caller''s own posts (feed only — the map and search still show them). See DOMAIN.md / SECURITY_AND_TRUST §2.';


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
             round((ST_Distance(public.post_pin_geog(p.last_seen_location, p.stolen_from), v_origin) / 1609.344)::numeric, 1)) as j,
           ST_Distance(public.post_pin_geog(p.last_seen_location, p.stolen_from), v_origin) as dist
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
