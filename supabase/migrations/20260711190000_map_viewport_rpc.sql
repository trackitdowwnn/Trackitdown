-- =============================================================================
-- WHAT:  Map-search viewport RPC. Adds public.get_posts_in_viewport(), a
--        SECURITY DEFINER function that returns the active posts whose
--        last-seen location falls inside a lat/lng bounding box, plus a total
--        count for the map sheet handle ("N cars in this area").
-- WHY:   The search-map screen renders pins for the current map viewport and a
--        bottom sheet listing them. It needs ONE server call that (a) counts
--        all matching active posts and (b) returns a capped, newest-first page
--        with exact pin coordinates. Composed server-side so the client never
--        assembles a safety-sensitive query, mirroring get_home_feed.
-- LINKS: docs/DOMAIN.md (post lifecycle),
--        docs/SECURITY_AND_TRUST.md §2 (nothing public before verification),
--        §6 (RLS deny-by-default; SECURITY DEFINER hardening),
--        supabase/migrations/20260711130000_home_feed_location_and_rpcs.sql
--        (posts.last_seen_location, GiST index posts_last_seen_location_gix,
--        home_feed_post_json helper, and the RPC hardening pattern copied here).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. Fully additive — one new
--        function plus its grants. No drop/rename/truncate.
-- =============================================================================


-- =============================================================================
-- RPC: get_posts_in_viewport(min_lat, min_lng, max_lat, max_lng, limit) -> jsonb
-- =============================================================================
-- Returns { "total": <int>, "posts": [ <post + lat/lng>, ... ] }.
--   total = count of ALL active posts in the bbox (drives the sheet handle).
--   posts = newest last_seen_at first, capped at 100.
--
-- SAFETY (Tier 1 — read before editing the queries below):
--   This function is SECURITY DEFINER, so it BYPASSES RLS. The
--   posts_select_active_public policy DOES NOT protect these queries. Both the
--   count and the page therefore carry an EXPLICIT `status = 'active'`
--   predicate, and that predicate IS the enforcement. No draft /
--   pending_verification / recovery_claimed / cancelled / expired / rejected /
--   recovered post may EVER leave this function (anti-stalking,
--   SECURITY_AND_TRUST §2: nothing public before verification). Do not weaken
--   the predicate or rely on RLS to backstop it.
--   (supabase/tests/home_feed_verification.sql asserts this and gates CI.)
--
-- SAFETY (exact coordinates): unlike the recently_recovered home-feed section
--   (which snaps recovered locations to a ~1km grid), this RPC returns EXACT
--   lat/lng. That is deliberate and safe ONLY because the predicate is
--   active-only: an active post's location is already public under RLS
--   (posts_select_active_public). NEVER widen this function to any other status
--   without also coarsening the coordinates.
--
-- search_path fixed to public, extensions so the PostGIS operators resolve
-- whether PostGIS is installed into public (fresh local) or the extensions
-- schema (Supabase-hosted). STABLE: reads only.
create or replace function public.get_posts_in_viewport(
  p_min_lat double precision,
  p_min_lng double precision,
  p_max_lat double precision,
  p_max_lng double precision,
  p_limit   integer
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

  -- total: count of ALL matching active posts (not limited) for the sheet handle.
  select count(*)
    into v_total
  from public.posts p
  where p.status = 'active'                       -- SAFETY: active only
    and p.last_seen_location is not null
    and p.last_seen_location && v_bbox;

  -- posts: capped, newest first, each carrying exact lat/lng for its pin.
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
    where p.status = 'active'                      -- SAFETY: active only
      and p.last_seen_location is not null
      and p.last_seen_location && v_bbox
    order by p.last_seen_at desc nulls last
    limit v_limit
  ) t;

  return jsonb_build_object('total', v_total, 'posts', v_posts);
end;
$$;

comment on function public.get_posts_in_viewport(double precision, double precision, double precision, double precision, integer) is
  'Returns { total, posts } for active posts inside a lat/lng bbox (map viewport). SECURITY DEFINER (bypasses RLS); status = active predicate is the enforcement. posts capped at 100, newest first, with exact lat/lng (safe only because active locations are already public under RLS). Degenerate/inverted bbox -> empty.';


-- =============================================================================
-- GRANTS
-- =============================================================================
-- SAFETY: functions default to EXECUTE granted to PUBLIC. Lock that down and
-- grant deliberately, matching get_home_feed: anon (logged-out browse of active
-- posts is already permitted by posts_select_active_public) + authenticated +
-- service_role.
revoke execute on function public.get_posts_in_viewport(double precision, double precision, double precision, double precision, integer) from public;
grant  execute on function public.get_posts_in_viewport(double precision, double precision, double precision, double precision, integer)
  to anon, authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
