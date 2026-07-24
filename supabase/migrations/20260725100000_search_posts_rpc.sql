-- =============================================================================
-- WHAT:  Faceted map-search RPCs. Adds public.search_posts() and
--        public.search_posts_count(), two SECURITY DEFINER functions that return
--        the active posts whose last-seen location falls inside a lat/lng
--        bounding box AND match an optional criteria set (free-text make/model,
--        exact make/model/colour, bounty range, recency window). search_posts
--        returns { total, posts } (posts carry exact pin lat/lng);
--        search_posts_count returns just the live count for the "Show N cars"
--        button. Drops the now-superseded public.get_posts_in_viewport().
-- WHY:   The search-map screen is gaining filters (make/model text, colour,
--        bounty range, "seen in the last N days"). Rather than let the client
--        assemble a safety-sensitive query, we compose it server-side exactly
--        like get_posts_in_viewport did — but generalised to take a jsonb
--        criteria bag. With p_criteria = '{}'::jsonb search_posts is a STRICT
--        SUPERSET of get_posts_in_viewport (identical results), so we retire the
--        older function and keep exactly ONE coordinate-emitting search RPC to
--        audit for the active-only invariant.
-- LINKS: docs/DOMAIN.md (post lifecycle),
--        docs/SECURITY_AND_TRUST.md §2 (nothing public before verification),
--        §6 (RLS deny-by-default; SECURITY DEFINER hardening),
--        supabase/migrations/20260711130000_home_feed_location_and_rpcs.sql
--        (posts.last_seen_location, GiST index posts_last_seen_location_gix,
--        home_feed_post_json helper, RPC hardening pattern copied here),
--        supabase/migrations/20260711190000_map_viewport_rpc.sql
--        (get_posts_in_viewport — the RPC this generalises and replaces).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: ONE drop-function at the end —
--        `drop function public.get_posts_in_viewport(...)`. This is NON-DATA-
--        DESTRUCTIVE (drops a function, not a table/column/row). It is safe
--        because search_posts is a strict superset: callers migrate
--        get_posts_in_viewport(a,b,c,d,limit) -> search_posts(a,b,c,d,'{}',limit)
--        with identical output. Removing it leaves search_posts as the single
--        coordinate-emitting function that must keep the active-only predicate,
--        shrinking the safety surface. No other drop/rename/truncate.
-- =============================================================================


-- =============================================================================
-- RPC: search_posts(min_lat, min_lng, max_lat, max_lng, criteria, limit) -> jsonb
-- =============================================================================
-- Returns { "total": <int>, "posts": [ <post + lat/lng>, ... ] }.
--   total = count of ALL active posts matching bbox + criteria (drives the
--           "Show N cars" button and the sheet handle).
--   posts = newest last_seen_at first, capped at 100, each with exact lat/lng.
--
-- CRITERIA (p_criteria jsonb — every key OPTIONAL; an absent/blank key applies
-- NO filter on that field, so '{}'::jsonb reproduces get_posts_in_viewport):
--   * text          -> free-text; matches make OR model via ILIKE (see escaping
--                      note below). Does NOT match plate/colour/area.
--   * make          -> exact equality.
--   * model         -> exact equality.
--   * colour        -> exact equality.
--   * bounty_min    -> bounty_amount_pence >= bounty_min (integer pence).
--   * bounty_max    -> bounty_amount_pence <= bounty_max (integer pence).
--   * recency_days  -> last_seen_at >= now() - N days. NOTE: this DROPS rows with
--                      a NULL last_seen_at (intended — an unknown last-seen date
--                      cannot satisfy a "seen in the last N days" window; the
--                      >= comparison against NULL is NULL, i.e. excluded).
--   PLATE IS DELIBERATELY NOT A FILTER. There is no 'plate' criterion by
--   construction — unknown keys are simply never read. This is a privacy choice
--   (SECURITY_AND_TRUST §1: identity minimisation): a plate filter would let an
--   anonymous caller enumerate/confirm specific plates against the live map.
--
-- SAFETY (Tier 1 — read before editing the queries below):
--   This function is SECURITY DEFINER, so it BYPASSES RLS. The
--   posts_select_active_public policy DOES NOT protect these queries. The count,
--   the page, AND search_posts_count all carry an EXPLICIT `status = 'active'`
--   predicate, and that predicate IS the enforcement — it is UNCONDITIONAL,
--   never gated on a criterion. No draft / pending_verification /
--   recovery_claimed / cancelled / expired / rejected / recovered post may EVER
--   leave this function (anti-stalking, SECURITY_AND_TRUST §2: nothing public
--   before verification). Do not weaken the predicate or rely on RLS to backstop
--   it. (supabase/tests/home_feed_verification.sql asserts this and gates CI.)
--
-- SAFETY (shared predicate): the WHERE block below is REPEATED verbatim in the
--   count subquery, the page subquery, AND in search_posts_count. All three MUST
--   stay byte-for-byte identical so total, page, and the live count never
--   disagree (and so the active-only predicate can never drift apart between
--   them). If you touch one, touch all three.
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
--
-- No dynamic SQL: each criterion is extracted once into a declared variable and
-- the predicates use `(v_x is null OR <cond>)` guards so an absent criterion
-- adds nothing and the plan stays a single static statement.
--
-- search_path fixed to public, extensions so the PostGIS operators resolve
-- whether PostGIS is installed into public (fresh local) or the extensions
-- schema (Supabase-hosted). STABLE: reads only.
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
  'Returns { total, posts } for active posts inside a lat/lng bbox matching an optional jsonb criteria bag (text=make/model ILIKE, exact make/model/colour, bounty_min/max, recency_days). SECURITY DEFINER (bypasses RLS); the UNCONDITIONAL status = active predicate is the enforcement. With ''{}''::jsonb it is a strict superset of the retired get_posts_in_viewport. posts capped at 100, newest first, exact lat/lng (safe only because active locations are already public under RLS). Plate is deliberately never a filter (privacy). Degenerate/inverted bbox -> empty.';


-- =============================================================================
-- RPC: search_posts_count(min_lat, min_lng, max_lat, max_lng, criteria) -> integer
-- =============================================================================
-- Cheap live count of active posts matching bbox + criteria — drives the
-- "Show N cars" button while the user drags filter sliders, WITHOUT paying for
-- jsonb_agg / home_feed_post_json. Returns just count(*).
--
-- SAFETY: SAME shared predicate as search_posts (keep byte-for-byte identical),
-- SAME unconditional active-only enforcement, SAME degenerate-bbox guard (-> 0).
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
  'Returns the live count(*) of active posts inside a lat/lng bbox matching the SAME jsonb criteria as search_posts. SECURITY DEFINER (bypasses RLS); unconditional status = active predicate is the enforcement. Cheap count for the "Show N cars" button (no jsonb_agg). Degenerate/inverted bbox -> 0.';


-- =============================================================================
-- INDEXES
-- =============================================================================
-- Deliberately NONE added here. Within a bbox the GiST index
-- posts_last_seen_location_gix (20260711130000) is the selective driver: it
-- reduces the table to the small set of posts physically inside the viewport,
-- and the attribute criteria (make/model/colour/bounty/recency) are then cheap
-- RESIDUAL filters on that already-tiny candidate set. A pg_trgm GIN index on
-- make/model (to accelerate the ILIKE free-text match) is a MEASURED follow-up
-- — it needs `create extension pg_trgm` and should only be added once EXPLAIN on
-- production-scale data shows the residual ILIKE is actually the bottleneck. We
-- do not add it speculatively.


-- =============================================================================
-- GRANTS
-- =============================================================================
-- SAFETY: functions default to EXECUTE granted to PUBLIC. Lock that down and
-- grant deliberately, matching get_home_feed / get_posts_in_viewport: anon
-- (logged-out browse of active posts is already permitted by
-- posts_select_active_public) + authenticated + service_role.
revoke execute on function public.search_posts(double precision, double precision, double precision, double precision, jsonb, integer) from public;
grant  execute on function public.search_posts(double precision, double precision, double precision, double precision, jsonb, integer)
  to anon, authenticated, service_role;

revoke execute on function public.search_posts_count(double precision, double precision, double precision, double precision, jsonb) from public;
grant  execute on function public.search_posts_count(double precision, double precision, double precision, double precision, jsonb)
  to anon, authenticated, service_role;


-- =============================================================================
-- DROP: retire the superseded get_posts_in_viewport
-- =============================================================================
-- DESTRUCTIVE (non-data): removes a function. search_posts(a,b,c,d,'{}',limit)
-- reproduces get_posts_in_viewport(a,b,c,d,limit) exactly, so there is no reason
-- to keep two coordinate-emitting search functions alive — one is easier to
-- audit for the active-only invariant. Clients/tests must be migrated to
-- search_posts before this ships (supabase/tests/home_feed_verification.sql is
-- updated in the same change). IF EXISTS so a re-run is idempotent.
drop function if exists public.get_posts_in_viewport(double precision, double precision, double precision, double precision, integer);


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
