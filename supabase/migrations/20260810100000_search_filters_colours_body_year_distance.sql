-- =============================================================================
-- WHAT: Widens map search — multi-select `colours` and `body_types`, a
--       `year_min`/`year_max` range, and a REAL distance filter (origin +
--       radius, applied on top of the bbox) — across search_posts and
--       search_posts_count.
--
-- WHY:  The sheet offered 6 of the app's 15 colours, no body type, no year, and
--       a "distance" that never reached the server at all: it only sized the
--       rectangle the client asked about, so "within 5 miles" was a camera
--       instruction rather than a promise about results. The alert wizard has
--       filtered on the full colour set and all body types since
--       20260802160000_alert_criteria_matching.sql; search was the poorer
--       cousin of a matching surface that already worked.
--
--       posts.year and posts.body_type already exist (20260713140000_post_
--       detail.sql) — this migration adds no columns, only predicates.
--
--       ⚠️ NEXT EDITOR: the live definition of these two functions is THIS file.
--       Diff against it, never against an older search_posts migration. That
--       warning is inherited from 20260807110000, which exists ONLY because an
--       editor diffed against the wrong ancestor and silently reverted
--       case-insensitive matching.
--
-- WHY THE DROPS BELOW ARE MANDATORY, NOT TIDINESS:
--       `create or replace function` with EXTRA parameters does not replace
--       anything — it creates a second OVERLOAD. PostgREST resolves overloads
--       by the supplied argument set, and a call carrying the original six
--       arguments would then match BOTH candidates, so every map search would
--       fail with PGRST203 ("Could not choose the best candidate function").
--       Keeping the old signature is the breaking change; dropping it is what
--       makes the additive parameters safe.
--
--       Dropping a function ALSO drops its grants, so the revoke/grant pair
--       from 20260725100000 is re-issued at the foot of this file. Without it
--       anon and authenticated lose execute and search dies for everyone.
--
-- BACKWARDS COMPATIBILITY: the three new parameters all DEFAULT NULL, so a
--       client built before this migration still calls a valid function and
--       gets byte-identical behaviour to today (no origin, no radius, bbox
--       only). The one shape that needs help is the singular `colour` key an
--       older bundle sends; it is aliased below, because that failure is
--       SILENT — an ignored colour filter returns MORE cars, which no one
--       reports as a bug.
-- =============================================================================

-- Old signatures must go before the new ones are created — see the header.
drop function if exists public.search_posts(
  double precision, double precision, double precision, double precision, jsonb, integer);
drop function if exists public.search_posts_count(
  double precision, double precision, double precision, double precision, jsonb);


-- -----------------------------------------------------------------------------
-- search_posts — the map's results + handle total.
-- The SHARED PREDICATE appears twice here and once in search_posts_count; all
-- three must stay identical.
--
-- SAFETY (status enforcement — TIER 1): this function is SECURITY DEFINER, so
--   it BYPASSES RLS. The `status = 'active'` predicate IS the enforcement, and
--   it is UNCONDITIONAL — no draft, pending_verification, recovery_claimed,
--   cancelled, expired, rejected or recovered post may EVER leave this
--   function. There is no parameter, criteria key or code path that relaxes it.
--   None of the filters added by this migration touch it.
--
-- SAFETY (exact coordinates): this RPC returns EXACT lat/lng. That is
--   deliberate and safe ONLY because the predicate is active-only: an active
--   post's location is already public under RLS (posts_select_active_public).
--   NEVER widen this function to any other status without also coarsening the
--   coordinates.
--
-- SAFETY (driveway home-address coarsening — KNOWN GAP, carried forward):
--   DOMAIN.md requires that a `stolen_from = 'driveway'` post's last-seen point
--   (which IS the owner's home) be snapped to a ~1km grid for non-owners on the
--   map/feed. This RPC currently returns EXACT lat/lng regardless of
--   stolen_from. PRE-EXISTING, and NO LONGER LATENT — do not read the older
--   wording of this note, which claimed no active driveway post could exist
--   yet. That is false on both halves now: a paid post goes straight to
--   'active' with no gate (SECURITY_AND_TRUST §2), and seed.sql already
--   carries active driveway posts (a1a1a1a1-…-0006, -0016). get_post_detail
--   coarsens them for non-owners; THIS function does not, so the map hands any
--   anonymous caller an unsnapped home address — and the distance filter added
--   here makes that a targeted query rather than an incidental one.
--   As the SINGLE coordinate-emitting search RPC this is where the snap
--   belongs: ST_SnapToGrid on the emitted point when stolen_from = 'driveway'
--   and the caller is not the owner. DOMAIN.md names this a blocker.
--
-- SAFETY (the caller-supplied origin — NEW): p_origin_lat/p_origin_lng are the
--   exact CENTRE OF THE BBOX sent in the same call, so it is arithmetically
--   REDUNDANT — the four corners already encode it and this function learns
--   nothing it was not already being told. That, not the origin provenance,
--   is why it is safe: on the feed path that centre IS the device fix.
--   It is transient: this function is `stable`, writes nothing, and mapApi logs
--   only `hasOrigin`/`radiusMiles`, never the coordinates (docs/LOGGING.md).
--   Contrast alert_zones.point, which IS stored and IS ST_SnapToGrid'd before
--   insert — that snap exists precisely because the value persists.
--   ⚠️ If the origin is ever DECOUPLED from the bbox — a point the caller is
--   not simultaneously querying a rectangle around — the redundancy argument
--   collapses and it needs a SECURITY_AND_TRUST entry.
--
-- SAFETY (radius clamp): p_radius_m is caller-supplied and anon-reachable, and
--   is clamped to the same 1–50 miles as get_home_feed and
--   alert_zones_radius_chk. Be precise about WHY, because the obvious reason is
--   wrong here: get_home_feed's header cites trilateration, but this RPC
--   already returns exact coordinates for active posts (deliberately — see
--   above), and search_posts_count is already a fully caller-controlled
--   rectangle oracle. So this clamp buys PERFORMANCE and RANGE CONSISTENCY, not
--   confidentiality — an unclamped 3,000-mile radius would force a
--   planet-scale scan on an anon-reachable function. Do not over-trust it.
--
-- CASE-INSENSITIVE MATCHING: make/model/colour/body_type compare
--   lower(btrim(...)) on BOTH sides. Non-sargable by design — the GiST bbox
--   predicate narrows first. See 20260807110000 for what happens when this is
--   dropped.
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
  where p.status = 'active'                                    -- SAFETY: active only
    and p.last_seen_location is not null
    and p.owner_id is distinct from v_viewer                   -- never your own listing
    and p.last_seen_location && v_bbox
    -- DISTANCE — applied ON TOP of the bbox, never instead of it. Both read the
    -- same GiST index (posts_last_seen_location_gix): PostGIS expands
    -- ST_DWithin on geography into an && bbox test plus an exact recheck, so
    -- this is a cheap second filter on an already-narrowed set, not a seq scan.
    -- use_spheroid stays at its default true, matching match_alert_zones —
    -- search and alerts must not measure distance differently.
    and (v_origin is null or ST_DWithin(p.last_seen_location, v_origin, v_radius))
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
      -- DISTANCE — see the count subquery above.
      and (v_origin is null or ST_DWithin(p.last_seen_location, v_origin, v_radius))
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
      -- recency: NULL last_seen_at is dropped here (>= against NULL is NULL). Intended.
      and (v_days   is null or p.last_seen_at >= now() - (v_days || ' days')::interval)
    order by p.last_seen_at desc nulls last
    limit v_limit
  ) t;

  return jsonb_build_object('total', v_total, 'posts', v_posts);
end;
$$;

comment on function public.search_posts(double precision, double precision, double precision, double precision, jsonb, integer, double precision, double precision, integer) is
  'Returns { total, posts } for active posts inside a lat/lng bbox matching an optional jsonb criteria bag (text=make/model ILIKE; make/model compared lower(btrim(...)) on BOTH sides; colours/body_types multi-select arrays compared the same way via = any(...); bounty_min/max; year_min/max; recency_days) AND, when p_origin_lat/p_origin_lng/p_radius_m are supplied, an ST_DWithin radius applied ON TOP of the bbox. The origin is the MAP CENTRE the client already derived the bbox from — never stored, never logged; the radius is clamped to 1-50 miles for performance and range consistency, not confidentiality. SECURITY DEFINER (bypasses RLS); the UNCONDITIONAL status = active predicate is the enforcement. EXCLUDES the caller''s own posts. posts capped at 100, newest first, exact lat/lng (safe only because active locations are already public under RLS). A NULL colour/body_type/year drops out while that filter is set. The singular legacy `colour` key is aliased to `colours` for pre-2026-08-10 clients. Plate is deliberately never a filter (privacy). Degenerate/inverted bbox -> empty.';


-- -----------------------------------------------------------------------------
-- search_posts_count — the live "Show N cars" count. Its predicate must stay
-- byte-for-byte in step with search_posts, or the button promises N and the
-- map delivers N-1.
--
-- SAFETY (status enforcement — TIER 1): SAME unconditional active-only
--   enforcement as search_posts. SECURITY DEFINER bypasses RLS, so the
--   `status = 'active'` predicate is the enforcement. This function returns
--   only a count, but a count is still a disclosure: widening the status set
--   here would tell any caller how many non-active posts sit in a bbox.
--
-- SAFETY (origin + radius clamp): identical to search_posts — same map-centre
--   origin, same 1609..80467 m clamp, same reasoning. Both functions must
--   accept and constrain the geo parameters the same way or the count and the
--   map disagree the moment a radius is set.
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
begin
  -- Degenerate / null / inverted bbox -> 0 (mirrors search_posts's empty result).
  if p_min_lat is null or p_min_lng is null
     or p_max_lat is null or p_max_lng is null
     or p_min_lat >= p_max_lat or p_min_lng >= p_max_lng then
    return 0;
  end if;

  v_bbox := ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)::geography;

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
  where p.status = 'active'                                    -- SAFETY: active only
    and p.last_seen_location is not null
    and p.owner_id is distinct from v_viewer                   -- never your own listing
    and p.last_seen_location && v_bbox
    and (v_origin is null or ST_DWithin(p.last_seen_location, v_origin, v_radius))
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
    -- recency: NULL last_seen_at is dropped here (>= against NULL is NULL). Intended.
    and (v_days   is null or p.last_seen_at >= now() - (v_days || ' days')::interval);

  return v_total;
end;
$$;

comment on function public.search_posts_count(double precision, double precision, double precision, double precision, jsonb, double precision, double precision, integer) is
  'Cheap live count of active posts matching bbox + criteria + optional origin/radius — drives the "Show N cars" button. SAME shared predicate as search_posts, including the caller''s-own-posts exclusion, the lower(btrim(...)) case-insensitive comparisons, the colours/body_types = any(...) multi-select, the year bounds and the ST_DWithin radius; they must stay identical or the button''s count disagrees with the map.';


-- -----------------------------------------------------------------------------
-- Grants. REQUIRED, not boilerplate: `drop function` above dropped the grants
-- issued by 20260725100000, so without re-issuing them here anon and
-- authenticated would lose execute and every search would fail with a
-- permission error. anon is included because logged-out browse of active posts
-- is already permitted by posts_select_active_public.
-- -----------------------------------------------------------------------------
revoke execute on function public.search_posts(double precision, double precision, double precision, double precision, jsonb, integer, double precision, double precision, integer) from public;
grant  execute on function public.search_posts(double precision, double precision, double precision, double precision, jsonb, integer, double precision, double precision, integer)
  to anon, authenticated, service_role;

revoke execute on function public.search_posts_count(double precision, double precision, double precision, double precision, jsonb, double precision, double precision, integer) from public;
grant  execute on function public.search_posts_count(double precision, double precision, double precision, double precision, jsonb, double precision, double precision, integer)
  to anon, authenticated, service_role;
