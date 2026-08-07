-- =============================================================================
-- WHAT: Repairs a REGRESSION shipped by 20260806170000_own_posts_excluded_from_
--       pagination_and_map.sql — restores case-insensitive make/model/colour
--       matching to search_posts and search_posts_count, and restores the
--       Tier-1 SAFETY blocks that migration dropped.
--
-- WHY:  20260806170000 said its blocks were "carried forward VERBATIM from
--       20260725100000_search_posts_rpc.sql". That was the wrong source. The
--       LIVE definition at the time was 20260802160000_alert_criteria_matching
--       .sql, which had already replaced the exact `=` with
--
--         and (v_make is null or lower(btrim(p.make)) = lower(btrim(v_make)))
--
--       in all three copies of the shared predicate. Copying the OLDER file
--       silently reverted it, and 20260806170000 sorts last, so both a fresh
--       `supabase db reset` and the live database ended up case-sensitive.
--
--       The harm is not cosmetic. posts.make/model/colour have NO check
--       constraint and no normalisation — create_post stores exactly what the
--       owner typed, and MakeField allows free-typed entry — while the search
--       side sends the CANONICAL picker string verbatim
--       (src/features/search-map/lib/searchCriteria.ts). So an owner who typed
--       "bmw" had their stolen car disappear from a spotter's "BMW" search AND
--       from the "Show N cars" count above it. It also split search from alerts:
--       match_alert_zones compares lower(btrim(...)) and its own comment asserts
--       that "search_posts/search_posts_count use the identical comparison so
--       the two can never disagree". They disagreed.
--
--       ⚠️ NEXT EDITOR: the live definition of these two functions is THIS file.
--       Diff against it, never against an older search_posts migration.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- search_posts — the map's results + handle total.
-- The SHARED PREDICATE appears twice here and once in search_posts_count; all
-- three must stay identical.
--
-- SAFETY (status enforcement — TIER 1, restored here): this function is
--   SECURITY DEFINER, so it BYPASSES RLS. The `status = 'active'` predicate IS
--   the enforcement, and it is UNCONDITIONAL — no draft, pending_verification,
--   recovery_claimed, cancelled, expired, rejected or recovered post may EVER
--   leave this function. There is no parameter, criteria key or code path that
--   relaxes it. This block was dropped by 20260806170000; it is restored
--   because it is the warning that stops the next editor widening the status
--   set on the single coordinate-emitting search RPC.
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
-- CASE-INSENSITIVE MATCHING: make/model/colour compare lower(btrim(...)) on BOTH
--   sides. Non-sargable by design — the GiST bbox predicate narrows first. See
--   the file header for what happens when this is dropped.
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
    -- lower(btrim(...)) on BOTH sides: posts.make/model/colour have no CHECK
    -- and no normalisation, so an exact `=` drops the owner who typed "bmw".
    -- Identical to match_alert_zones — search and alerts must never disagree.
    and (v_make   is null or lower(btrim(p.make))   = lower(btrim(v_make)))
    and (v_model  is null or lower(btrim(p.model))  = lower(btrim(v_model)))
    and (v_colour is null or lower(btrim(p.colour)) = lower(btrim(v_colour)))
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
      -- lower(btrim(...)) on BOTH sides — see the count subquery above.
      and (v_make   is null or lower(btrim(p.make))   = lower(btrim(v_make)))
      and (v_model  is null or lower(btrim(p.model))  = lower(btrim(v_model)))
      and (v_colour is null or lower(btrim(p.colour)) = lower(btrim(v_colour)))
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
  'Returns { total, posts } for active posts inside a lat/lng bbox matching an optional jsonb criteria bag (text=make/model ILIKE, make/model/colour compared lower(btrim(...)) on BOTH sides, bounty_min/max, recency_days). SECURITY DEFINER (bypasses RLS); the UNCONDITIONAL status = active predicate is the enforcement. EXCLUDES the caller''s own posts. posts capped at 100, newest first, exact lat/lng (safe only because active locations are already public under RLS). The case-insensitive comparison exists because posts.make/model/colour have no CHECK and no normalisation (create_post stores what the owner typed), so an exact = silently hides the car of an owner who typed "bmw" from a spotter searching "BMW"; match_alert_zones uses the identical comparison so search and alerts can never disagree. Plate is deliberately never a filter (privacy). Degenerate/inverted bbox -> empty.';


-- -----------------------------------------------------------------------------
-- search_posts_count — the live "Show N cars" count. Its predicate must stay
-- byte-for-byte in step with search_posts, or the button promises N and the
-- map delivers N-1.
--
-- SAFETY (status enforcement — TIER 1, restored here): SAME unconditional
--   active-only enforcement as search_posts. SECURITY DEFINER bypasses RLS, so
--   the `status = 'active'` predicate is the enforcement. This function returns
--   only a count, but a count is still a disclosure: widening the status set
--   here would tell any caller how many non-active posts sit in a bbox.
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
    -- lower(btrim(...)) on BOTH sides: posts.make/model/colour have no CHECK
    -- and no normalisation, so an exact `=` drops the owner who typed "bmw".
    -- Identical to match_alert_zones — search and alerts must never disagree.
    and (v_make   is null or lower(btrim(p.make))   = lower(btrim(v_make)))
    and (v_model  is null or lower(btrim(p.model))  = lower(btrim(v_model)))
    and (v_colour is null or lower(btrim(p.colour)) = lower(btrim(v_colour)))
    and (v_bmin   is null or p.bounty_amount_pence >= v_bmin)
    and (v_bmax   is null or p.bounty_amount_pence <= v_bmax)
    -- recency: NULL last_seen_at is dropped here (>= against NULL is NULL). Intended.
    and (v_days   is null or p.last_seen_at >= now() - (v_days || ' days')::interval);

  return v_total;
end;
$$;

comment on function public.search_posts_count(double precision, double precision, double precision, double precision, jsonb) is
  'Cheap live count of active posts matching bbox + criteria — drives the "Show N cars" button. SAME shared predicate as search_posts, including the caller''s-own-posts exclusion AND the lower(btrim(...)) case-insensitive make/model/colour comparison; they must stay identical or the button''s count disagrees with the map.';
