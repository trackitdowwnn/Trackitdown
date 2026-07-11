-- =============================================================================
-- WHAT:  Home-feed (Explore tab) database layer. Enables PostGIS; adds the
--        last-seen LOCATION (geography point), last-seen AREA label, and
--        recovered_at columns to public.posts; indexes them; extends the
--        client column grants to cover the two new client-editable draft
--        fields (location + area) while keeping recovered_at server-only; and
--        creates the SECURITY DEFINER RPCs get_home_feed() and
--        get_nearby_posts() that compose the Explore feed server-side in a
--        single round-trip.
-- WHY:   The Explore tab needs a location-aware, radius-matched feed grouped
--        into sections (near you / by locality / highest bounties / recently
--        recovered / national fallback). Radius matching requires PostGIS
--        (deliberately deferred by 20260707110712 to keep that migration
--        extension-free). The feed is assembled in ONE RPC so the client makes
--        one call and never composes safety-sensitive queries itself.
--        Product rule (approved 2026-07-11, being added to docs/DOMAIN.md):
--        a recovered post stays PUBLICLY visible for 30 days after recovery as
--        social proof, then drops out of the feed.
-- LINKS: docs/DOMAIN.md (post lifecycle; recovered-visibility window),
--        docs/SECURITY_AND_TRUST.md §1 (report-don't-approach; identity
--        minimisation), §2 (nothing public before verification), §6 (RLS deny
--        by default; status transitions server-only),
--        supabase/migrations/20260707110712_payments_foundation.sql (posts,
--        post_status enum, column-grant + RLS house patterns),
--        supabase/migrations/20260710120000_profile_fields_and_avatars.sql
--        (extend-column-grants pattern),
--        src/shared/types/posts.ts (PostSummary shape the client maps to).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. Fully additive — CREATE
--        EXTENSION IF NOT EXISTS, ALTER TABLE ... ADD COLUMN, new indexes, new
--        grants, and new functions. No drop/rename/truncate of any existing
--        object.
-- =============================================================================


-- =============================================================================
-- 0. EXTENSION: PostGIS
-- =============================================================================
-- The payments-foundation migration deliberately shipped extension-free and
-- left last-seen LOCATION as a commented TODO. The home feed needs geography
-- points + ST_DWithin radius matching, so enable PostGIS now. IF NOT EXISTS is
-- safe on Supabase-hosted projects where PostGIS is pre-installed (usually in
-- the `extensions` schema); this becomes a no-op there.
create extension if not exists postgis;


-- =============================================================================
-- 1. POSTS: new columns
-- =============================================================================

alter table public.posts
  -- Last-seen point for radius matching (ST_DWithin). PostGIS geography so
  -- distances are true metres on the spheroid, not planar degrees. SRID 4326
  -- (WGS84 lat/lng) to match device GPS and the LocationPicker output.
  -- Nullable: the posting flow that captures it is not built yet, and existing
  -- draft rows predate it.
  add column last_seen_location geography(Point, 4326),

  -- Human locality label ("Manchester", "Salford") captured from the
  -- LocationPicker addressLabel (src/shared/types/location.ts) at posting time.
  -- Drives the "Recently stolen in <Area>" carousels. Nullable: addressLabel
  -- may be '' even when the point is settled (geocode failed/skipped), so a
  -- post can have a location with no area label.
  -- SAFETY: client-writable text that is concatenated into the PUBLIC section
  -- titles ('Recently stolen in <Area>'), so bound its length — otherwise a
  -- client could pad a huge string into every viewer's feed payload.
  add column last_seen_area text
    constraint posts_last_seen_area_len check (char_length(last_seen_area) <= 80),

  -- When the post entered a recovered state. SAFETY: written ONLY by the
  -- recovery / release-payout Edge Function as part of the server-side status
  -- transition (SECURITY_AND_TRUST §6); excluded from every client grant
  -- below. Drives the 30-day public "recently recovered" window (DOMAIN.md) —
  -- a client-writable value here would let someone keep a closed post visible
  -- (or forge social proof) indefinitely.
  add column recovered_at timestamptz;

comment on column public.posts.last_seen_location is
  'PostGIS geography(Point,4326) last-seen location. GiST-indexed; used by ST_DWithin radius matching in get_home_feed/get_nearby_posts. Nullable (posting flow not built yet). Client-writable on own drafts only.';
comment on column public.posts.last_seen_area is
  'Locality label from the LocationPicker addressLabel at posting time. Groups the "Recently stolen in <Area>" carousels. Nullable, <= 80 chars. Client-writable on own drafts only.';
comment on column public.posts.recovered_at is
  'Set ONLY by the recovery/release-payout Edge Function when status moves to recovered/recovered_no_spotter. Excluded from all client grants. Drives the 30-day public recently-recovered window (DOMAIN.md).';


-- =============================================================================
-- 2. POSTS: indexes
-- =============================================================================

-- Spatial index for ST_DWithin radius matching (every feed section that is
-- location-scoped scans through this).
create index posts_last_seen_location_gix
  on public.posts using gist (last_seen_location);

-- Partial btree on the area label, only for live posts — the area carousels
-- group active in-radius posts by last_seen_area. Partial keeps it small and
-- aligned to the only status that is ever grouped this way.
create index posts_active_area_idx
  on public.posts (last_seen_area)
  where status = 'active';

-- Partial btree on recovered_at for the recently-recovered window scan
-- (recovered states, ordered by recovered_at desc within 30 days).
create index posts_recovered_recent_idx
  on public.posts (recovered_at)
  where status in ('recovered', 'recovered_no_spotter');


-- =============================================================================
-- 3. POSTS: extend client column grants
-- =============================================================================
-- SAFETY: 20260707110712 revoked table-wide INSERT/UPDATE from anon/
-- authenticated and granted only an explicit column list. We re-issue the full
-- lists here, ADDING last_seen_location and last_seen_area (client-editable on
-- an owner's own draft, exactly like plate/make/model/colour). recovered_at is
-- deliberately ABSENT from both grants: it is a lifecycle/money-adjacent field
-- owned by the recovery Edge Function. status/owner_id/id/expires_at remain
-- excluded as before. The draft-only RLS policies from 20260707110712 still
-- govern which ROWS these grants can touch. service_role already holds
-- table-level DML (granted in 20260707110712), so it covers the new columns.
grant insert (owner_id, plate, make, model, colour, bounty_amount_pence,
              last_seen_at, last_seen_location, last_seen_area)
  on public.posts to authenticated;
grant update (plate, make, model, colour, bounty_amount_pence,
              last_seen_at, last_seen_location, last_seen_area)
  on public.posts to authenticated;


-- =============================================================================
-- 4. HELPER: slugify(text)
-- =============================================================================
-- Builds a URL/id-safe slug for the area-carousel section id ('area_<slug>').
-- Pure text transform; not client-callable (execute revoked from public below).
create or replace function public.slugify(p_text text)
returns text
language sql
immutable
-- Empty search_path (Supabase hardening); only pg_catalog built-ins are used.
set search_path = ''
as $$
  select trim(both '-' from
           regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'));
$$;

comment on function public.slugify(text) is
  'Lowercases and hyphenates a label into an id-safe slug. Used for home-feed area section ids. Pure; not granted to clients.';


-- =============================================================================
-- 5. HELPER: home_feed_post_json(posts, numeric)
-- =============================================================================
-- Serialises one post row into the PostSummary-shaped JSON the client maps
-- (src/shared/types/posts.ts). Kept in one place so every feed section emits an
-- identical shape. Photos are intentionally omitted (no photo schema yet); the
-- client's PostSummary mapping tolerates their absence. Not client-callable.
-- NOTE: this helper does no filtering — callers MUST apply the status
-- predicates; see the SAFETY note on get_home_feed. The caller also decides the
-- distance PRECISION it passes in (precise for active posts; coarsened to whole
-- miles for recovered posts — see the recently_recovered CTE).
-- STABLE, not IMMUTABLE: the timestamptz -> jsonb (text) serialisation of
-- last_seen_at/created_at depends on the session TimeZone GUC, so the output is
-- not input-only. STABLE is the correct volatility for a within-statement read.
create or replace function public.home_feed_post_json(
  p_post           public.posts,
  p_distance_miles numeric
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id',                  p_post.id,
    'plate',               p_post.plate,
    'make',                p_post.make,
    'model',               p_post.model,
    'colour',              p_post.colour,
    'bounty_amount_pence', p_post.bounty_amount_pence,
    'status',              p_post.status,
    'last_seen_at',        p_post.last_seen_at,
    'last_seen_area',      p_post.last_seen_area,
    'distance_miles',      p_distance_miles,   -- null in national mode
    'created_at',          p_post.created_at
  );
$$;

comment on function public.home_feed_post_json(public.posts, numeric) is
  'Serialises a post into the client PostSummary shape (photos omitted — no photo schema yet). Does NO status filtering; callers own the safety predicates. STABLE (timestamptz->json depends on the TimeZone GUC), not IMMUTABLE.';


-- =============================================================================
-- 6. RPC: get_home_feed(lat, lng, radius_m) -> jsonb
-- =============================================================================
-- Composes the whole Explore feed in ONE call and returns { "sections": [...] }.
-- Sections (in this fixed order, empty ones OMITTED): near_you, up to 3 area
-- carousels, highest_bounties, recently_recovered, and recent_uk (national
-- mode, or fallback when nothing is active nearby).
--
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
    select p as post, ST_Distance(p.last_seen_location, v_origin) as dist
    from public.posts p
    where p.status = 'active'                    -- SAFETY: active only
      and p.last_seen_location is not null
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
  'Composes the Explore home feed server-side in one call: { sections: [...] }. SECURITY DEFINER (bypasses RLS) so every query carries an explicit status predicate — active only, except recently_recovered (recovered states within 30 days, location snapped to a ~1km grid). Radius clamped to 1–50 miles. See DOMAIN.md / SECURITY_AND_TRUST §2.';


-- =============================================================================
-- 7. RPC: get_nearby_posts(lat, lng, radius_m, offset, limit) -> jsonb
-- =============================================================================
-- Pagination for the near_you / map hero list: a flat JSON array of the same
-- PostSummary shape, active only, nearest first. p_limit is capped at 25 so a
-- client cannot request an unbounded page. Same SECURITY DEFINER caveat as
-- get_home_feed: RLS is bypassed, so the status = 'active' predicate is load-
-- bearing and must stay. p_radius_m is clamped server-side to 1–50 miles for
-- the same anti-trilateration / unbounded-sort reasons as get_home_feed.
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
      and ST_DWithin(p.last_seen_location, v_origin, v_radius)
    order by dist
    offset v_offset
    limit v_limit
  ) t;

  return v_result;
end;
$$;

comment on function public.get_nearby_posts(double precision, double precision, integer, integer, integer) is
  'Paginates active in-radius posts (nearest first) as a JSON array of PostSummary objects. p_limit capped at 25; p_radius_m clamped to 1–50 miles. SECURITY DEFINER; status = active predicate is load-bearing (RLS is bypassed).';


-- =============================================================================
-- 8. FUNCTION GRANTS
-- =============================================================================
-- SAFETY: functions default to EXECUTE granted to PUBLIC. Lock that down and
-- grant deliberately.
--
-- The two RPCs are granted to anon AND authenticated: posts_select_active_public
-- (20260707110712) already exposes active posts to anon (logged-out public
-- browse), so the feed of active posts is consistent with that. service_role
-- (Edge Functions) also gets execute for server-side use.
revoke execute on function public.get_home_feed(double precision, double precision, integer) from public;
grant  execute on function public.get_home_feed(double precision, double precision, integer)
  to anon, authenticated, service_role;

revoke execute on function public.get_nearby_posts(double precision, double precision, integer, integer, integer) from public;
grant  execute on function public.get_nearby_posts(double precision, double precision, integer, integer, integer)
  to anon, authenticated, service_role;

-- Internal helpers: NOT client-callable. The SECURITY DEFINER RPCs call them as
-- the function owner, so anon/authenticated never need execute. Revoke the
-- default PUBLIC grant to keep the surface minimal.
revoke execute on function public.slugify(text) from public;
revoke execute on function public.home_feed_post_json(public.posts, numeric) from public;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
