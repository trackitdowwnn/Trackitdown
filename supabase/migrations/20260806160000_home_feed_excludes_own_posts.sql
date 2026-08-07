-- =============================================================================
-- WHAT: get_home_feed stops returning the caller's OWN posts.
--
-- WHY:  Explore is a browse surface for spotters. Your own stolen car listed at
--       "0 mi · last seen 16h ago" is the one listing you can do nothing about,
--       sitting where the cars you could help with should be. This mirrors the
--       rule the alert matcher already enforces for pushes
--       (20260802160000_alert_criteria_matching.sql: "SAFETY (owner exclusion):
--       never push the victim their own theft") and extends it to the feed.
--
--       SCOPE: the FEED ONLY. search_posts / get_posts_in_viewport /
--       get_nearby_posts deliberately keep showing owners their own post — a
--       map that silently omits a car is more confusing than one that shows it,
--       and an owner checking where their car was last seen is a legitimate
--       read. Product call 2026-08-06.
--
--       `is distinct from`, NOT `<>`. auth.uid() is NULL for an anonymous
--       caller, and `owner_id <> NULL` evaluates to NULL — which would drop
--       EVERY row and hand anon browsers an empty feed. `is distinct from`
--       returns true when the uid is null, so anon sees everything as before.
--
--       Replaces the body from 20260711130000_home_feed_location_and_rpcs.sql
--       verbatim apart from the four added predicates (national recent_uk,
--       in_radius, recovered, fallback recent_uk). The serialiser it calls,
--       home_feed_post_json, was last replaced by 20260806130000_feed_photos.sql
--       and is untouched here.
-- =============================================================================

-- SAFETY (Tier 1 — read this before editing any query below):
--   This function is SECURITY DEFINER, so it BYPASSES RLS. The
--   posts_select_active_public policy DOES NOT protect these queries. Every
--   query therefore carries an EXPLICIT status predicate and must keep it:
--     * near_you / area carousels / highest_bounties / recent_uk  ->  status = 'active'
--     * recently_recovered  ->  status in ('recovered','recovered_no_spotter')
--                               AND recovered_at within the last 30 days.
--   No draft / pending_verification / recovery_claimed / cancelled / expired /
--   rejected post may EVER leave this function (anti-stalking, SECURITY_AND_TRUST
--   §2: nothing public before verification). Do not weaken these predicates or
--   rely on RLS to backstop them. (supabase/tests/home_feed_verification.sql
--   asserts this and is meant to gate CI.)
--
-- SAFETY (radius clamp): p_radius_m is caller-supplied (anon-reachable). It is
--   clamped server-side to 1–50 miles below; an unclamped radius would let a
--   caller binary-search a post's distance down to ~1 m (trilateration) and
--   force planet-wide sorts. Every ST_DWithin uses the clamped v_radius.
--
-- search_path fixed to public, extensions so the PostGIS operators (ST_DWithin
-- etc.) resolve whether PostGIS was installed into public (fresh local) or the
-- extensions schema (Supabase-hosted). STABLE: reads only, no writes.
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
    select p as post, ST_Distance(p.last_seen_location, v_origin) as dist
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
