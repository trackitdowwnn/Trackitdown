-- =============================================================================
-- WHAT: Excludes no-reward listings from the home feed's "Highest bounties
--       nearby" carousel. One added predicate in get_home_feed's `highest` CTE;
--       every other line of the function is character-identical to
--       20260811100000_feed_distance_coarsens_driveway.sql.
--
-- WHY:  20260820110000 made posts.bounty_amount_pence NULLABLE (ADR-0014: a
--       no-bounty listing paid for with a fixed fee). The `highest` CTE ranks
--       with `order by bounty_amount_pence desc` — and **Postgres sorts NULLs
--       FIRST under DESC**. Without this change, no-reward posts would occupy
--       the top ten slots of a carousel titled "Highest bounties nearby", and
--       every real bounty would be pushed out of the section that exists to show
--       them.
--
--       This is the quietest of the three failure modes the nullable bounty
--       introduces: nothing errors, no number is wrong, the section simply stops
--       meaning what its title says. It is exactly the kind of regression a
--       reader of the diff would not spot, which is why it gets its own
--       migration and its own CHECK in the verification suite rather than being
--       folded into the money migration.
--
-- HOW:  `where (ir.post).bounty_amount_pence is not null` in the inner subquery
--       — NOT merely `nulls last` on the ORDER BY. `nulls last` would fix the
--       ORDERING while still letting a no-reward post fill a slot in a bounty
--       section whenever fewer than ten bounty posts are in radius. A section
--       about bounties should contain posts that have one; filtering says that,
--       ordering only hides it.
--
--       The predicate goes in the INNER query (which has the LIMIT 10), so the
--       limit is spent on ten real bounties. Putting it outside would filter
--       after the limit and yield a short — sometimes empty — carousel.
--
--       Everything else is untouched: near_you, the area carousels,
--       recently_recovered and the national/fallback modes all still include
--       no-reward posts, which is correct — they rank by distance, recency and
--       recovery date, none of which a missing bounty affects.
--
--       ⚠️ NEXT EDITOR: the live definition of get_home_feed is THIS file.
--       get_nearby_posts and post_pin_geog remain in 20260811100000.
-- LINKS: supabase/migrations/20260820110000_no_bounty_listing_fee.sql (made the
--          column nullable); docs/decisions/ADR-0014-no-bounty-listings.md;
--        supabase/tests/listing_fee_verification.sql (CHECK: a no-reward post
--          never appears in highest_bounties);
--        supabase/tests/home_feed_verification.sql.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: NONE. One CREATE OR REPLACE FUNCTION.
--        No schema change, no data change, no grant change (the function's
--        grants are unchanged from 20260711130000 and are re-asserted below
--        because CREATE OR REPLACE re-runs this project's ALTER DEFAULT
--        PRIVILEGES, which re-grant anon).
-- =============================================================================

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
      -- SAFETY (2026-08-20, ADR-0014): a no-reward listing has a NULL bounty and
      -- Postgres sorts NULLs FIRST under DESC — without this predicate they would
      -- take the top slots of a section titled "Highest bounties nearby". Filtered
      -- rather than `nulls last` so the LIMIT below is spent on ten REAL bounties;
      -- ordering alone would still let a no-reward post fill a slot whenever fewer
      -- than ten bounty posts are in radius. Inside the inner query on purpose, so
      -- the filter runs BEFORE the limit rather than shortening the carousel.
      where (ir.post).bounty_amount_pence is not null
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

  -- NOTE: this section can now be absent in a radius that HAS active posts —
  -- if every one of them is a no-reward listing, v_highest is empty and the
  -- carousel is omitted, exactly as it already is when the radius is empty.
  -- The client needs no change: sections have always been omitted when empty.
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
  -- not empty -> show recent UK posts under the empty state. Keyed on v_near
  -- (all active posts nearby), never on v_highest — a radius full of no-reward
  -- listings is not an empty radius.
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
  'Composes the Explore home feed server-side in one call: { sections: [...] }. SECURITY DEFINER (bypasses RLS) so every query carries an explicit status predicate — active only, except recently_recovered (recovered states within 30 days, location snapped to a ~1km grid). Radius clamped to 1–50 miles. EXCLUDES the caller''s own posts (feed only — the map and search still show them). highest_bounties EXCLUDES no-reward listings (2026-08-20, ADR-0014): their bounty is NULL and Postgres sorts NULLs first under DESC, so they would otherwise head a section named for the thing they lack; every other section still includes them. See DOMAIN.md / SECURITY_AND_TRUST §2.';

-- Grants unchanged from 20260711130000, RE-ASSERTED because CREATE OR REPLACE
-- re-runs this project's ALTER DEFAULT PRIVILEGES (which re-grant anon at CREATE
-- time). The feed is a public, guest-first surface: anon reads it deliberately.
revoke execute on function public.get_home_feed(double precision, double precision, integer) from public;
grant  execute on function public.get_home_feed(double precision, double precision, integer) to anon, authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
