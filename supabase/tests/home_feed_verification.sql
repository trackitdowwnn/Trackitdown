-- =============================================================================
-- Home-feed verification (NOT a migration — do not place in migrations/).
--
-- SELF-ASSERTING: every check is a DO block that RAISES EXCEPTION on failure,
-- so the whole file aborts non-zero the moment a safety property is violated.
-- "Non-active / out-of-window posts never publicly returned" is a Tier 1
-- property (docs/TESTING.md) — this file is meant to GATE CI, not to be
-- eyeballed. On success each block emits a NOTICE.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset            # applies migrations + seed
--     psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/home_feed_verification.sql
--
-- (ON_ERROR_STOP=1 makes psql exit non-zero on the first RAISE.) Origin used
-- below: central Manchester (53.4808, -2.2426). Checks 10–16 cover the faceted
-- search RPCs search_posts / search_posts_count
-- (20260725100000_search_posts_rpc.sql), which supersede the retired
-- get_posts_in_viewport (search_posts with '{}'::jsonb is a strict superset).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — get_home_feed never emits a non-active / out-of-window post.
-- -----------------------------------------------------------------------------
do $$
declare
  v_leaks integer;
begin
  with feed as (
    select public.get_home_feed(53.4808, -2.2426, 15000) as doc
  ),
  returned as (
    select (post ->> 'id')::uuid as id
    from feed,
         lateral jsonb_array_elements(doc -> 'sections') as section,
         lateral jsonb_array_elements(section -> 'posts') as post
  )
  select count(*)
    into v_leaks
  from returned r
  join public.posts p on p.id = r.id
  where p.status not in ('active', 'recovered', 'recovered_no_spotter')
     or (p.status in ('recovered', 'recovered_no_spotter')
         and (p.recovered_at is null or p.recovered_at < now() - interval '30 days'));

  if v_leaks > 0 then
    raise exception 'CHECK 1 FAILED: % post(s) with a forbidden status/window leaked from get_home_feed', v_leaks;
  end if;
  raise notice 'CHECK 1 passed: get_home_feed emitted no non-active/out-of-window posts';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 2 — recovered posts appear ONLY in recently_recovered, and the
-- out-of-window one (MA99 OLD, recovered 45 days ago) appears nowhere.
-- -----------------------------------------------------------------------------
do $$
declare
  v_misplaced    integer;
  v_old_returned integer;
begin
  with feed as (
    select public.get_home_feed(53.4808, -2.2426, 15000) as doc
  ),
  returned as (
    select section ->> 'id' as section_id, (post ->> 'id')::uuid as id
    from feed,
         lateral jsonb_array_elements(doc -> 'sections') as section,
         lateral jsonb_array_elements(section -> 'posts') as post
  )
  select
    count(*) filter (where p.status in ('recovered', 'recovered_no_spotter')
                       and r.section_id <> 'recently_recovered'),
    count(*) filter (where p.plate = 'MA99 OLD')
    into v_misplaced, v_old_returned
  from returned r
  join public.posts p on p.id = r.id;

  if v_misplaced > 0 then
    raise exception 'CHECK 2 FAILED: % recovered post(s) surfaced outside the recently_recovered section', v_misplaced;
  end if;
  if v_old_returned > 0 then
    raise exception 'CHECK 2 FAILED: the out-of-window recovered post (MA99 OLD) was returned';
  end if;
  raise notice 'CHECK 2 passed: recovered posts appear only in recently_recovered; out-of-window one excluded';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 3 — get_nearby_posts returns active only, within the 25 cap, non-empty.
-- -----------------------------------------------------------------------------
do $$
declare
  v_nonactive integer;
  v_n         integer;
begin
  with page as (
    select public.get_nearby_posts(53.4808, -2.2426, 15000, 0, 25) as arr
  ),
  returned as (
    select (post ->> 'id')::uuid as id
    from page, lateral jsonb_array_elements(arr) as post
  )
  select count(*) filter (where p.status <> 'active'), count(*)
    into v_nonactive, v_n
  from returned r
  join public.posts p on p.id = r.id;

  if v_nonactive > 0 then
    raise exception 'CHECK 3 FAILED: % non-active post(s) returned by get_nearby_posts', v_nonactive;
  end if;
  if v_n > 25 then
    raise exception 'CHECK 3 FAILED: get_nearby_posts returned % rows (> 25 cap)', v_n;
  end if;
  if v_n < 1 then
    raise exception 'CHECK 3 FAILED: get_nearby_posts returned no posts near Manchester (seed missing?)';
  end if;
  raise notice 'CHECK 3 passed: get_nearby_posts active-only, % row(s)', v_n;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 4 — page-limit cap: ask for 1000, must be capped to <= 25.
-- -----------------------------------------------------------------------------
do $$
declare
  v_len integer;
begin
  v_len := jsonb_array_length(public.get_nearby_posts(53.4808, -2.2426, 15000, 0, 1000));
  if v_len > 25 then
    raise exception 'CHECK 4 FAILED: page length % exceeds the 25 cap', v_len;
  end if;
  raise notice 'CHECK 4 passed: p_limit 1000 capped to % (<= 25)', v_len;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 5 — national / fallback mode: null location -> exactly one recent_uk.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc  jsonb;
  v_n    integer;
  v_sole text;
begin
  v_doc  := public.get_home_feed(null, null, 15000);
  v_n    := jsonb_array_length(v_doc -> 'sections');
  v_sole := v_doc -> 'sections' -> 0 ->> 'id';
  if v_n <> 1 or v_sole is distinct from 'recent_uk' then
    raise exception 'CHECK 5 FAILED: national mode returned % section(s), first id %; expected exactly 1 recent_uk', v_n, v_sole;
  end if;
  raise notice 'CHECK 5 passed: national mode returns only recent_uk';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 6 — the radius query is served by an INDEX, never a full-table scan.
-- Captures the EXPLAIN (FORMAT JSON) plan and asserts an index scan appears and
-- a Seq Scan does not. SET LOCAL forces an index plan on the tiny seeded table
-- (the whole table fits in one page, so the planner would otherwise prefer a
-- Seq Scan) and auto-resets when the DO block's implicit transaction ends.
--
-- Deliberately does NOT name an index. It asserted 'posts_last_seen_location_gix'
-- until 2026-07-28, when this suite ran for the first time (nothing had ever
-- executed it) and failed: the planner had chosen posts_active_area_idx — still
-- an Index Scan, so the property this check exists to protect was intact. The
-- old assertion tested WHICH index the planner picked, which is the planner's
-- business and changes as indexes are added; what actually matters is that a
-- geo lookup never degrades into reading every post. Adding a better index for
-- this predicate must not turn a passing gate red.
-- -----------------------------------------------------------------------------
do $$
declare
  v_plan json;
  v_text text;
begin
  set local enable_seqscan = off;
  execute $q$
    explain (format json)
    select id
    from public.posts
    where status = 'active'
      and last_seen_location is not null
      and ST_DWithin(
            last_seen_location,
            ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
            15000)
  $q$ into v_plan;
  v_text := v_plan::text;

  -- The regression that matters: every post read on every radius query.
  if position('Seq Scan' in v_text) > 0 then
    raise exception 'CHECK 6 FAILED: ST_DWithin fell back to a Seq Scan. Plan: %', v_text;
  end if;
  -- Substring also covers "Bitmap Index Scan" and "Index Only Scan".
  if position('Index Scan' in v_text) = 0 then
    raise exception 'CHECK 6 FAILED: ST_DWithin plan used no index at all. Plan: %', v_text;
  end if;
  raise notice 'CHECK 6 passed: ST_DWithin is served by an index scan, not a Seq Scan';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 7 (belt-and-braces) — direct status-leak scan across BOTH home-feed
-- RPCs at four origins. Zero forbidden-status posts may appear.
-- -----------------------------------------------------------------------------
do $$
declare
  v_leaks integer;
begin
  with origins(lat, lng) as (
    values (53.4808, -2.2426),   -- Manchester
           (53.4875, -2.2901),   -- Salford
           (53.4106, -2.1575),   -- Stockport
           (53.5933, -2.2966)    -- Bury
  ),
  home as (
    select (post ->> 'id')::uuid as id
    from origins o,
         lateral jsonb_array_elements(public.get_home_feed(o.lat, o.lng, 20000) -> 'sections') as section,
         lateral jsonb_array_elements(section -> 'posts') as post
  ),
  nearby as (
    select (post ->> 'id')::uuid as id
    from origins o,
         lateral jsonb_array_elements(public.get_nearby_posts(o.lat, o.lng, 20000, 0, 25)) as post
  ),
  all_ids as (
    select id from home union select id from nearby
  )
  select count(*)
    into v_leaks
  from all_ids a
  join public.posts p on p.id = a.id
  where p.status not in ('active', 'recovered', 'recovered_no_spotter');

  if v_leaks > 0 then
    raise exception 'CHECK 7 FAILED: % forbidden-status post(s) leaked across the multi-origin scan', v_leaks;
  end if;
  raise notice 'CHECK 7 passed: no forbidden-status posts across four origins';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 8 — server-side radius clamp (1–50 miles). An out-of-range radius must
-- behave identically to the boundary, and the 1-mile floor still finds posts.
-- -----------------------------------------------------------------------------
do $$
declare
  v_nearby_ceiling boolean;
  v_home_ceiling   boolean;
  v_nearby_floor   boolean;
  v_n_at_radius_1  integer;
begin
  v_nearby_ceiling := public.get_nearby_posts(53.4808, -2.2426, 999999999, 0, 25)
                      = public.get_nearby_posts(53.4808, -2.2426, 80467, 0, 25);
  v_home_ceiling   := public.get_home_feed(53.4808, -2.2426, 999999999)
                      = public.get_home_feed(53.4808, -2.2426, 80467);
  v_nearby_floor   := public.get_nearby_posts(53.4808, -2.2426, 1, 0, 25)
                      = public.get_nearby_posts(53.4808, -2.2426, 1609, 0, 25);
  v_n_at_radius_1  := jsonb_array_length(public.get_nearby_posts(53.4808, -2.2426, 1, 0, 25));

  if not v_nearby_ceiling then
    raise exception 'CHECK 8 FAILED: get_nearby_posts ceiling not clamped to 50 miles';
  end if;
  if not v_home_ceiling then
    raise exception 'CHECK 8 FAILED: get_home_feed ceiling not clamped to 50 miles';
  end if;
  if not v_nearby_floor then
    raise exception 'CHECK 8 FAILED: get_nearby_posts floor not clamped to 1 mile';
  end if;
  if v_n_at_radius_1 < 1 then
    raise exception 'CHECK 8 FAILED: 1-mile floor returned no posts near Manchester (got %)', v_n_at_radius_1;
  end if;
  raise notice 'CHECK 8 passed: radius clamped to 1-50 miles (floor returned % post(s))', v_n_at_radius_1;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 9 — anti-trilateration: recently_recovered distances are WHOLE miles
-- (snapped-point measure), never null, and at least one recovered post is
-- present to assert on. (Contrast: active posts carry 1-decimal distances.)
-- -----------------------------------------------------------------------------
do $$
declare
  v_total integer;
  v_null  integer;
  v_bad   integer;
begin
  with feed as (
    select public.get_home_feed(53.4808, -2.2426, 80467) as doc  -- 50 miles: all recovered in range
  ),
  rec as (
    select (post ->> 'distance_miles') as dm
    from feed,
         lateral jsonb_array_elements(doc -> 'sections') as section,
         lateral jsonb_array_elements(section -> 'posts') as post
    where section ->> 'id' = 'recently_recovered'
  )
  select
    count(*),
    count(*) filter (where dm is null),
    count(*) filter (where dm is not null and (dm::numeric) <> round(dm::numeric, 0))
    into v_total, v_null, v_bad
  from rec;

  if v_total < 1 then
    raise exception 'CHECK 9 FAILED: no recovered posts returned to assert on (seed missing?)';
  end if;
  if v_null > 0 then
    raise exception 'CHECK 9 FAILED: % recovered post(s) had null distance_miles', v_null;
  end if;
  if v_bad > 0 then
    raise exception 'CHECK 9 FAILED: % recovered post(s) had non-whole-mile distance_miles', v_bad;
  end if;
  raise notice 'CHECK 9 passed: % recovered post(s), all whole-mile distances', v_total;
end $$;


-- =============================================================================
-- Faceted search RPC checks (search_posts / search_posts_count).
-- These replace the old get_posts_in_viewport checks: search_posts(...,'{}',N)
-- is a strict superset, so CHECKs 10–13 pass '{}'::jsonb (no criteria) to assert
-- the SAME properties, and 14–16 exercise the new criteria.
-- Manchester-only bbox: lat 53.47..53.49, lng -2.26..-2.23. It contains every
-- Manchester seed row (7 active + the recovered + all trap posts) but none of
-- Salford/Stockport/Bury — so it exercises the active-only predicate directly.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 10 — search_posts (no criteria) never returns a non-active post, even
-- though the Manchester bbox physically contains the trap + recovered rows.
-- -----------------------------------------------------------------------------
do $$
declare
  v_nonactive integer;
begin
  with vp as (
    select public.search_posts(53.47, -2.26, 53.49, -2.23, '{}'::jsonb, 100) as doc
  ),
  returned as (
    select (post ->> 'id')::uuid as id
    from vp, lateral jsonb_array_elements(doc -> 'posts') as post
  )
  select count(*) filter (where p.status <> 'active')
    into v_nonactive
  from returned r
  join public.posts p on p.id = r.id;

  if v_nonactive > 0 then
    raise exception 'CHECK 10 FAILED: % non-active post(s) returned by search_posts', v_nonactive;
  end if;
  raise notice 'CHECK 10 passed: search_posts returned active posts only';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 11 — total counts ALL active posts in the bbox while posts respects the
-- cap. Call with p_limit 2: total must exceed 2, and the array length is 2.
-- Also assert search_posts_count agrees with search_posts's total (same
-- predicate, computed by the cheap count RPC).
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc   jsonb;
  v_total integer;
  v_len   integer;
  v_count integer;
begin
  v_doc   := public.search_posts(53.47, -2.26, 53.49, -2.23, '{}'::jsonb, 2);
  v_total := (v_doc ->> 'total')::integer;
  v_len   := jsonb_array_length(v_doc -> 'posts');
  v_count := public.search_posts_count(53.47, -2.26, 53.49, -2.23, '{}'::jsonb);

  if v_total <= 2 then
    raise exception 'CHECK 11 FAILED: expected total > 2 active posts in the Manchester bbox, got %', v_total;
  end if;
  if v_len <> 2 then
    raise exception 'CHECK 11 FAILED: p_limit 2 should return exactly 2 posts, got %', v_len;
  end if;
  if v_count <> v_total then
    raise exception 'CHECK 11 FAILED: search_posts_count % disagrees with search_posts total %', v_count, v_total;
  end if;
  raise notice 'CHECK 11 passed: total % counts all actives, posts capped to % by p_limit, count RPC agrees', v_total, v_len;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 12 — degenerate bbox (min_lat > max_lat) returns an empty result from
-- search_posts AND 0 from search_posts_count.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc   jsonb;
  v_total integer;
  v_len   integer;
  v_count integer;
begin
  v_doc   := public.search_posts(53.49, -2.26, 53.47, -2.23, '{}'::jsonb, 100);  -- lat inverted
  v_total := (v_doc ->> 'total')::integer;
  v_len   := jsonb_array_length(v_doc -> 'posts');
  v_count := public.search_posts_count(53.49, -2.26, 53.47, -2.23, '{}'::jsonb); -- lat inverted

  if v_total <> 0 or v_len <> 0 then
    raise exception 'CHECK 12 FAILED: degenerate bbox returned total %, % post(s); expected 0/0', v_total, v_len;
  end if;
  if v_count <> 0 then
    raise exception 'CHECK 12 FAILED: degenerate bbox search_posts_count returned %; expected 0', v_count;
  end if;
  raise notice 'CHECK 12 passed: inverted bbox returns an empty result / 0 count';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 13 — the bbox (&&) query uses the GiST index posts_last_seen_location_gix.
-- Same forced-index-plan technique as CHECK 6. (This is the same physical
-- predicate search_posts / search_posts_count run inside their bbox filter.)
-- -----------------------------------------------------------------------------
do $$
declare
  v_plan json;
begin
  set local enable_seqscan = off;
  execute $q$
    explain (format json)
    select id
    from public.posts
    where status = 'active'
      and last_seen_location is not null
      and last_seen_location && ST_MakeEnvelope(-2.26, 53.47, -2.23, 53.49, 4326)::geography
  $q$ into v_plan;

  if position('posts_last_seen_location_gix' in v_plan::text) = 0 then
    raise exception 'CHECK 13 FAILED: bbox && plan did not use posts_last_seen_location_gix. Plan: %', v_plan::text;
  end if;
  raise notice 'CHECK 13 passed: search bbox query uses the GiST index posts_last_seen_location_gix';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 14 — text criterion ILIKEs make OR model ONLY (not plate/colour/area).
-- Seeds one active Manchester post with a distinctive make/model, then asserts a
-- partial-make term and a partial-model term both find it, while a non-matching
-- term does not. Seeded in a transaction that is ROLLED BACK so the DB is left
-- untouched (the seed row never persists).
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (
  id, owner_id, status, bounty_amount_pence, plate, make, model, colour,
  last_seen_at, last_seen_area, last_seen_location, expires_at
) values (
  'bbbbbbbb-0000-0000-0000-000000000014',
  '11111111-1111-1111-1111-111111111111', 'active', 25000,
  'KG73 TXT', 'Koenigsegg', 'Regera', 'Orange',
  now() - interval '1 days', 'Manchester',
  ST_SetSRID(ST_MakePoint(-2.2450, 53.4800), 4326)::geography,
  now() + interval '88 days'
);

do $$
declare
  v_make_hit  integer;
  v_model_hit integer;
  v_miss      integer;
begin
  select count(*) into v_make_hit
  from jsonb_array_elements(
         public.search_posts(53.47, -2.26, 53.49, -2.23, '{"text":"koenig"}'::jsonb, 100) -> 'posts'
       ) as post
  where (post ->> 'id')::uuid = 'bbbbbbbb-0000-0000-0000-000000000014';

  select count(*) into v_model_hit
  from jsonb_array_elements(
         public.search_posts(53.47, -2.26, 53.49, -2.23, '{"text":"rege"}'::jsonb, 100) -> 'posts'
       ) as post
  where (post ->> 'id')::uuid = 'bbbbbbbb-0000-0000-0000-000000000014';

  select count(*) into v_miss
  from jsonb_array_elements(
         public.search_posts(53.47, -2.26, 53.49, -2.23, '{"text":"zznotathing"}'::jsonb, 100) -> 'posts'
       ) as post
  where (post ->> 'id')::uuid = 'bbbbbbbb-0000-0000-0000-000000000014';

  if v_make_hit <> 1 then
    raise exception 'CHECK 14 FAILED: text "koenig" did not ILIKE-match the seeded make';
  end if;
  if v_model_hit <> 1 then
    raise exception 'CHECK 14 FAILED: text "rege" did not ILIKE-match the seeded model';
  end if;
  if v_miss <> 0 then
    raise exception 'CHECK 14 FAILED: a non-matching text term returned the seeded post';
  end if;
  raise notice 'CHECK 14 passed: text criterion ILIKEs make/model and excludes non-matches';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 15 — recency_days window. Seeds three active Manchester posts sharing a
-- distinctive make (to isolate them via a make filter): one seen 1 day ago
-- (recent), one seen 30 days ago (old), one with a NULL last_seen_at (unknown).
-- {"recency_days":7} must return ONLY the recent one — the old one is outside
-- the window and the NULL one is dropped (an unknown last-seen date can't satisfy
-- a "seen in the last N days" window). Rolled back so nothing persists.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (
  id, owner_id, status, bounty_amount_pence, plate, make, model, colour,
  last_seen_at, last_seen_area, last_seen_location, expires_at
) values
  ('bbbbbbbb-0000-0000-0000-000000000015',   -- recent: 1 day ago
   '11111111-1111-1111-1111-111111111111', 'active', 25000,
   'RC73 NEW', 'Lancia', 'Delta', 'Red',
   now() - interval '1 days', 'Manchester',
   ST_SetSRID(ST_MakePoint(-2.2451, 53.4801), 4326)::geography,
   now() + interval '88 days'),
  ('bbbbbbbb-0000-0000-0000-000000000016',   -- old: 30 days ago (outside 7-day window)
   '11111111-1111-1111-1111-111111111111', 'active', 25000,
   'OL73 OLD', 'Lancia', 'Delta', 'Red',
   now() - interval '30 days', 'Manchester',
   ST_SetSRID(ST_MakePoint(-2.2452, 53.4802), 4326)::geography,
   now() + interval '60 days'),
  ('bbbbbbbb-0000-0000-0000-000000000017',   -- unknown: NULL last_seen_at
   '11111111-1111-1111-1111-111111111111', 'active', 25000,
   'NL73 NUL', 'Lancia', 'Delta', 'Red',
   null, 'Manchester',
   ST_SetSRID(ST_MakePoint(-2.2453, 53.4803), 4326)::geography,
   now() + interval '88 days');

do $$
declare
  v_doc        jsonb;
  v_total      integer;
  v_recent_hit integer;
begin
  -- Filter by the shared distinctive make so only the three seeded rows are in play.
  v_doc   := public.search_posts(53.47, -2.26, 53.49, -2.23,
                                 '{"make":"Lancia","recency_days":7}'::jsonb, 100);
  v_total := (v_doc ->> 'total')::integer;

  select count(*) into v_recent_hit
  from jsonb_array_elements(v_doc -> 'posts') as post
  where (post ->> 'id')::uuid = 'bbbbbbbb-0000-0000-0000-000000000015';

  if v_total <> 1 then
    raise exception 'CHECK 15 FAILED: recency_days 7 returned % Lancia post(s); expected exactly 1 (the recent one)', v_total;
  end if;
  if v_recent_hit <> 1 then
    raise exception 'CHECK 15 FAILED: the recent (1-day-old) seeded post was not returned within recency_days 7';
  end if;
  raise notice 'CHECK 15 passed: recency_days keeps the recent post, drops the old and the NULL-last_seen posts';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 16 — plate guardrail + criteria-are-wired. A bogus {"plate":"AB12CDE"}
-- key is IGNORED by construction (search_posts never reads a plate criterion —
-- privacy: no plate enumeration), so it must yield the SAME result as '{}'. And
-- a real criterion (make) must NARROW the count, proving criteria are wired.
-- Uses existing seed only (no seeding needed).
-- -----------------------------------------------------------------------------
do $$
declare
  v_plain      jsonb;
  v_with_plate jsonb;
  v_count_all  integer;
  v_count_make integer;
begin
  v_plain      := public.search_posts(53.47, -2.26, 53.49, -2.23, '{}'::jsonb, 100);
  v_with_plate := public.search_posts(53.47, -2.26, 53.49, -2.23, '{"plate":"AB12CDE"}'::jsonb, 100);

  if v_plain is distinct from v_with_plate then
    raise exception 'CHECK 16 FAILED: a bogus plate criterion changed the result — plate must never be a filter';
  end if;

  v_count_all  := public.search_posts_count(53.47, -2.26, 53.49, -2.23, '{}'::jsonb);
  v_count_make := public.search_posts_count(53.47, -2.26, 53.49, -2.23, '{"make":"Ford"}'::jsonb);

  if v_count_make >= v_count_all then
    raise exception 'CHECK 16 FAILED: make=Ford (% ) did not narrow below the unfiltered count (%) — criteria not wired', v_count_make, v_count_all;
  end if;
  if v_count_make < 1 then
    raise exception 'CHECK 16 FAILED: make=Ford returned no active Manchester posts (seed missing?)';
  end if;
  raise notice 'CHECK 16 passed: plate criterion ignored (== no criteria); make criterion narrows % -> %', v_count_all, v_count_make;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 17 — every post the feed emits carries a 'photos' ARRAY.
-- ROADMAP critical path #1: the feed shipped with no photo column at all, and
-- the client papered over it with __DEV__ sample images — so production cards
-- were blank while ours looked perfect. The key must exist, be a jsonb array,
-- and never be null, because the client schema requires an array (a null key
-- would fail parsing and take the whole feed down rather than one card).
-- -----------------------------------------------------------------------------
do $$
declare
  v_total   integer;
  v_bad     integer;
begin
  with feed as (
    select public.get_home_feed(53.4808, -2.2426, 15000) as doc
  ),
  returned as (
    select post
    from feed,
         lateral jsonb_array_elements(doc -> 'sections') as section,
         lateral jsonb_array_elements(section -> 'posts') as post
  )
  select count(*),
         count(*) filter (where jsonb_typeof(post -> 'photos') is distinct from 'array')
    into v_total, v_bad
  from returned;

  if v_total = 0 then
    raise exception 'CHECK 17 FAILED: get_home_feed returned no posts near Manchester (seed missing?)';
  end if;
  if v_bad > 0 then
    raise exception 'CHECK 17 FAILED: % of % feed post(s) had a missing/non-array photos key', v_bad, v_total;
  end if;
  raise notice 'CHECK 17 passed: all % feed post(s) carry a photos array', v_total;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 18 — the photo is the post's REAL first photo, not just any photo.
-- The seed gives every post three (positions 0..2) from a rotating pool, so a
-- helper that dropped the ORDER BY would still pass CHECK 17 while showing a
-- different car's angle as the cover. Asserted against get_nearby_posts, which
-- returns a flat array and shares the helper with every other feed RPC.
-- -----------------------------------------------------------------------------
do $$
declare
  v_checked integer;
  v_wrong   integer;
begin
  with page as (
    select public.get_nearby_posts(53.4808, -2.2426, 15000, 0, 25) as doc
  ),
  returned as (
    select (post ->> 'id')::uuid                as id,
           post -> 'photos' -> 0 ->> 'url'      as cover
    from page, lateral jsonb_array_elements(doc) as post
  ),
  expected as (
    select r.id,
           r.cover,
           (select pp.url
              from public.post_photos pp
             where pp.post_id = r.id
             order by pp.position
             limit 1) as first_url
    from returned r
  )
  select count(*), count(*) filter (where cover is distinct from first_url)
    into v_checked, v_wrong
  from expected;

  if v_checked = 0 then
    raise exception 'CHECK 18 FAILED: get_nearby_posts returned nothing to check (seed missing?)';
  end if;
  if v_wrong > 0 then
    raise exception 'CHECK 18 FAILED: % of % card(s) showed a photo that is not the lowest-position one', v_wrong, v_checked;
  end if;
  raise notice 'CHECK 18 passed: all % card(s) show the post''s first photo by position', v_checked;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 19 — a post with NO photos yields [], not null and not an error.
-- The production case the seed never produces: a paid post whose uploads
-- failed. It must render a placeholder card, not break the feed's parse.
-- Seeds its own post, asserts, and rolls the row back out again.
-- -----------------------------------------------------------------------------
do $$
declare
  v_owner  uuid;
  v_post   uuid;
  v_photos jsonb;
begin
  select owner_id into v_owner from public.posts where status = 'active' limit 1;
  if v_owner is null then
    raise exception 'CHECK 19 FAILED: no active seed post to borrow an owner from';
  end if;

  insert into public.posts (owner_id, make, model, colour, bounty_amount_pence,
                            status, last_seen_at, last_seen_area, last_seen_location)
  values (v_owner, 'Photoless', 'Testcar', 'Grey', 10000,
          'active', now(), 'Manchester',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography)
  returning id into v_post;

  select post -> 'photos'
    into v_photos
  from lateral jsonb_array_elements(
         public.get_nearby_posts(53.4808, -2.2426, 15000, 0, 25)
       ) as post
  where (post ->> 'id')::uuid = v_post;

  if v_photos is null then
    raise exception 'CHECK 19 FAILED: the photoless post did not come back from get_nearby_posts at all';
  end if;
  if v_photos <> '[]'::jsonb then
    raise exception 'CHECK 19 FAILED: a photoless post emitted % instead of []', v_photos;
  end if;

  delete from public.posts where id = v_post;
  raise notice 'CHECK 19 passed: a post with no photos emits [] and still renders';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 20 — get_home_feed EXCLUDES the caller's own posts, and an ANON caller
-- still sees everything. The second half is the one that bites: auth.uid() is
-- NULL for anon, so a naive `owner_id <> auth.uid()` yields NULL for every row
-- and hands anonymous browsers a completely empty feed. This asserts the
-- `is distinct from` form survives.
-- (20260806160000_home_feed_excludes_own_posts.sql. The exclusion was extended
-- to get_nearby_posts / search_posts / search_posts_count by 20260806170000 —
-- CHECK 21 covers those.)
-- -----------------------------------------------------------------------------
do $$
declare
  v_owner   uuid;
  v_post    uuid;
  v_ids     jsonb;
  v_anon    jsonb;
begin
  select owner_id into v_owner from public.posts where status = 'active' limit 1;
  if v_owner is null then
    raise exception 'CHECK 20 FAILED: no active seed post to borrow an owner from';
  end if;

  insert into public.posts (owner_id, make, model, colour, bounty_amount_pence,
                            status, last_seen_at, last_seen_area, last_seen_location)
  values (v_owner, 'Ownfeed', 'Testcar', 'Red', 10000,
          'active', now(), 'Manchester',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography)
  returning id into v_post;

  -- As the OWNER: their own post must not appear in any section.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_owner)::text, true);

  select coalesce(jsonb_agg(p ->> 'id'), '[]'::jsonb)
    into v_ids
  from jsonb_array_elements(public.get_home_feed(53.4808, -2.2426, 32187) -> 'sections') s,
       lateral jsonb_array_elements(s -> 'posts') p;

  if v_ids ? v_post::text then
    raise exception 'CHECK 20 FAILED: the owner was shown their own post in the feed';
  end if;

  -- ...but the rest of the feed must SURVIVE. Without this, a predicate that
  -- emptied the feed for every authenticated caller would pass every other
  -- assertion in this file: "[] does not contain my post" is trivially true.
  -- Absence is only correct when it is selective.
  if jsonb_array_length(v_ids) = 0 then
    raise exception 'CHECK 20 FAILED: the owner sees an EMPTY feed, not merely one without their own post';
  end if;

  -- As ANON: the same post MUST come back. A dropped feed here means the
  -- predicate regressed to `<>` and NULL-eliminated every row.
  perform set_config('request.jwt.claims', '', true);

  select coalesce(jsonb_agg(p ->> 'id'), '[]'::jsonb)
    into v_anon
  from jsonb_array_elements(public.get_home_feed(53.4808, -2.2426, 32187) -> 'sections') s,
       lateral jsonb_array_elements(s -> 'posts') p;

  if not (v_anon ? v_post::text) then
    raise exception 'CHECK 20 FAILED: an anonymous caller lost the post — owner_id <> auth.uid() NULL-eliminated it';
  end if;

  delete from public.posts where id = v_post;
  raise notice 'CHECK 20 passed: owners never see their own post in the feed, anon still sees everything';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 21 — the owner exclusion holds across PAGINATION and the MAP, not just
-- the feed's first page. get_nearby_posts pages the near_you rail: if it and
-- get_home_feed disagree, a post absent from page 1 reappears on page 2, which
-- reads as a glitch rather than a rule. search_posts / search_posts_count must
-- agree with each other too, or the "Show N cars" button promises a number the
-- map cannot deliver. Anon is re-checked on every one: `<>` instead of
-- `is distinct from` would empty all of them for logged-out browsers.
-- (20260806170000_own_posts_excluded_from_pagination_and_map.sql)
-- -----------------------------------------------------------------------------
do $$
declare
  v_owner    uuid;
  v_post     uuid;
  v_ids      jsonb;
  v_count    integer;
  v_anon_ids jsonb;
  -- A bbox comfortably around central Manchester.
  v_min_lat  double precision := 53.40;
  v_min_lng  double precision := -2.32;
  v_max_lat  double precision := 53.56;
  v_max_lng  double precision := -2.16;
begin
  select owner_id into v_owner from public.posts where status = 'active' limit 1;
  if v_owner is null then
    raise exception 'CHECK 21 FAILED: no active seed post to borrow an owner from';
  end if;

  insert into public.posts (owner_id, make, model, colour, bounty_amount_pence,
                            status, last_seen_at, last_seen_area, last_seen_location)
  values (v_owner, 'Ownmap', 'Testcar', 'Green', 10000,
          'active', now(), 'Manchester',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography)
  returning id into v_post;

  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_owner)::text, true);

  -- (a) PAGINATION: the rail's own pages must agree with get_home_feed.
  select coalesce(jsonb_agg(p ->> 'id'), '[]'::jsonb)
    into v_ids
  from jsonb_array_elements(
         public.get_nearby_posts(53.4808, -2.2426, 32187, 0, 25)) p;

  if v_ids ? v_post::text then
    raise exception 'CHECK 21 FAILED: get_nearby_posts returned the owner their own post — the near_you rail contradicts its first page';
  end if;

  -- NON-EMPTY, same guard as CHECK 20. Without it a total authenticated
  -- blackout passes: `not (v_ids ? v_post)` is trivially true of an empty
  -- array, so an added `and v_viewer is null`, or a NULL-eliminating owner
  -- predicate, would leave the owner with an empty rail past page 1 while (d)
  -- kept anon green and CI stayed silent.
  if jsonb_array_length(v_ids) = 0 then
    raise exception 'CHECK 21 FAILED: get_nearby_posts returned NOTHING to the owner — they must lose only their OWN post, not the whole rail';
  end if;

  -- (b) MAP results.
  select coalesce(jsonb_agg(p ->> 'id'), '[]'::jsonb)
    into v_ids
  from jsonb_array_elements(
         public.search_posts(v_min_lat, v_min_lng, v_max_lat, v_max_lng,
                             '{}'::jsonb, 100) -> 'posts') p;

  if v_ids ? v_post::text then
    raise exception 'CHECK 21 FAILED: search_posts returned the owner their own post';
  end if;

  if jsonb_array_length(v_ids) = 0 then
    raise exception 'CHECK 21 FAILED: search_posts returned NOTHING to the owner — they must lose only their OWN post, not the whole map';
  end if;

  -- (c) The COUNT must agree with the results it describes. `>=`, not `=`:
  -- search_posts_count is UNCAPPED while search_posts caps its page at 100, so
  -- an exact match would start failing spuriously the day the seed exceeds 100
  -- active posts in this bbox. What must never happen is the count being
  -- SMALLER than the page — that would mean the button under-promises what the
  -- map is already showing, i.e. the two predicates have drifted apart.
  select public.search_posts_count(v_min_lat, v_min_lng, v_max_lat, v_max_lng,
                                   '{}'::jsonb)
    into v_count;

  if v_count < jsonb_array_length(v_ids) then
    raise exception 'CHECK 21 FAILED: search_posts_count said % but search_posts returned % — the predicates have drifted apart',
      v_count, jsonb_array_length(v_ids);
  end if;

  -- (c2) The count's OWN exclusion, isolated. (c) above only proves the count
  -- is not SMALLER than the page — and an unexcluded count is LARGER, so (c)
  -- passes whether or not search_posts_count carries the owner predicate at
  -- all. Filtering down to the seeded post makes the assertion exact: the
  -- owner must be told zero. Without this the button would over-promise by one
  -- and nothing in the suite would notice.
  select public.search_posts_count(v_min_lat, v_min_lng, v_max_lat, v_max_lng,
                                   '{"make":"Ownmap"}'::jsonb)
    into v_count;

  if v_count <> 0 then
    raise exception 'CHECK 21 FAILED: search_posts_count counted % of the owner''s own posts — it must count 0', v_count;
  end if;

  -- (d) ANON must still see the post through every one of them.
  perform set_config('request.jwt.claims', '', true);

  select public.search_posts_count(v_min_lat, v_min_lng, v_max_lat, v_max_lng,
                                   '{"make":"Ownmap"}'::jsonb)
    into v_count;
  if v_count <> 1 then
    raise exception 'CHECK 21 FAILED: anon counted % matching posts, expected 1 — the exclusion is firing on the wrong caller', v_count;
  end if;

  select coalesce(jsonb_agg(p ->> 'id'), '[]'::jsonb)
    into v_anon_ids
  from jsonb_array_elements(
         public.get_nearby_posts(53.4808, -2.2426, 32187, 0, 25)) p;
  if not (v_anon_ids ? v_post::text) then
    raise exception 'CHECK 21 FAILED: anon lost the post from get_nearby_posts — owner_id <> auth.uid() NULL-eliminated it';
  end if;

  select coalesce(jsonb_agg(p ->> 'id'), '[]'::jsonb)
    into v_anon_ids
  from jsonb_array_elements(
         public.search_posts(v_min_lat, v_min_lng, v_max_lat, v_max_lng,
                             '{}'::jsonb, 100) -> 'posts') p;
  if not (v_anon_ids ? v_post::text) then
    raise exception 'CHECK 21 FAILED: anon lost the post from search_posts — owner_id <> auth.uid() NULL-eliminated it';
  end if;

  delete from public.posts where id = v_post;
  raise notice 'CHECK 21 passed: pagination + map exclude the owner, count agrees, anon unaffected';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 22 — search_posts / search_posts_count match make/model/colour
-- CASE-INSENSITIVELY.
--
-- REGRESSION GUARD. 20260806170000 rebuilt both functions from the wrong
-- source file and silently reverted `lower(btrim(...))` back to an exact `=`
-- on all three copies of the shared predicate; it shipped to the live database
-- and nothing failed. Repaired by 20260807110000.
--
-- Why it matters: posts.make/model/colour have NO check constraint and no
-- normalisation — create_post stores exactly what the owner typed, and
-- MakeField allows free-typed entry — while the client sends the CANONICAL
-- picker string. So an owner who typed "bmw" has their stolen car vanish from a
-- spotter's "BMW" search AND from the "Show N cars" count above it. It also
-- splits search from alerts: match_alert_zones compares lower(btrim(...)) and
-- its comment asserts the two can never disagree.
--
-- The existing CHECK 15/16 cannot catch this: they seed and query with
-- IDENTICAL case, so they pass either way. This one deliberately seeds lower
-- and queries upper.
-- (20260807110000_restore_case_insensitive_search_matching.sql)
-- -----------------------------------------------------------------------------
do $$
declare
  v_owner   uuid;
  v_post    uuid;
  v_ids     jsonb;
  v_count   integer;
  v_min_lat double precision := 53.40;
  v_min_lng double precision := -2.32;
  v_max_lat double precision := 53.56;
  v_max_lng double precision := -2.16;
begin
  select owner_id into v_owner from public.posts where status = 'active' limit 1;
  if v_owner is null then
    raise exception 'CHECK 22 FAILED: no active seed post to borrow an owner from';
  end if;

  -- Seeded the way a careless owner types it: lower case, and padded.
  insert into public.posts (owner_id, make, model, colour, bounty_amount_pence,
                            status, last_seen_at, last_seen_area, last_seen_location)
  values (v_owner, ' casemake ', 'casemodel', 'casecolour', 10000,
          'active', now(), 'Manchester',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography)
  returning id into v_post;

  -- Queried the way the picker sends it: canonical case, no padding. ANON, so
  -- the owner exclusion cannot be what hides it.
  perform set_config('request.jwt.claims', '', true);

  select coalesce(jsonb_agg(p ->> 'id'), '[]'::jsonb)
    into v_ids
  from jsonb_array_elements(
         public.search_posts(v_min_lat, v_min_lng, v_max_lat, v_max_lng,
                             '{"make":"CaseMake","model":"CaseModel","colour":"CaseColour"}'::jsonb,
                             100) -> 'posts') p;

  if not (v_ids ? v_post::text) then
    raise exception 'CHECK 22 FAILED: search_posts lost a post whose make/model/colour differ only in CASE — an owner who typed "bmw" is invisible to a spotter searching "BMW"';
  end if;

  -- The count must agree, or the button and the map disagree about the same car.
  select public.search_posts_count(v_min_lat, v_min_lng, v_max_lat, v_max_lng,
                                   '{"make":"CaseMake","model":"CaseModel","colour":"CaseColour"}'::jsonb)
    into v_count;

  if v_count <> 1 then
    raise exception 'CHECK 22 FAILED: search_posts_count said % for a case-differing match, expected 1 — it has drifted from search_posts', v_count;
  end if;

  delete from public.posts where id = v_post;
  raise notice 'CHECK 22 passed: make/model/colour match case-insensitively in both search functions';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK — a DRIVEWAY theft's distance is measured from the coarsened point.
--
-- Neither feed RPC emits coordinates, so distance_miles was the last way in: it
-- is rounded to 0.1 mile (~160m), and varying the origin across calls
-- trilaterates a post to roughly street precision — well inside the ~1km grid a
-- driveway theft is meant to be blurred to. (The radius clamp does NOT defend
-- this: it bounds the radius, not the precision reported for a post inside it.)
-- -----------------------------------------------------------------------------
do $$
declare
  v_driveway uuid := 'a1a1a1a1-0000-0000-0000-000000000006';
  v_origin geography := ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography;
  v_exact   numeric;
  v_snapped numeric;
  v_reported numeric;
begin
  select round((ST_Distance(p.last_seen_location, v_origin) / 1609.344)::numeric, 1),
         round((ST_Distance(public.post_pin_geog(p.last_seen_location, p.stolen_from),
                            v_origin) / 1609.344)::numeric, 1)
    into v_exact, v_snapped
  from public.posts p
  where p.id = v_driveway and p.status = 'active' and p.stolen_from = 'driveway';

  if v_exact is null then
    raise exception 'CHECK FAILED: the seeded active driveway post is missing.';
  end if;
  if v_exact = v_snapped then
    raise exception 'CHECK INCONCLUSIVE: this origin gives the same rounded distance for the '
                    'exact and snapped points, so it cannot tell them apart. Move the origin.';
  end if;

  with s as (select jsonb_array_elements(public.get_home_feed(53.4808, -2.2426, 80467) -> 'sections') sec),
       p as (select jsonb_array_elements(sec -> 'posts') post from s)
  select (post ->> 'distance_miles')::numeric into v_reported
  from p where (post ->> 'id')::uuid = v_driveway limit 1;

  if v_reported is null then
    raise exception 'CHECK FAILED: the driveway post is absent from the feed — coarsening must '
                    'blur its distance, not remove it.';
  end if;
  if v_reported <> v_snapped then
    raise exception 'CHECK FAILED: feed reported % miles for a driveway post; the coarsened '
                    'distance is % and the EXACT one is %. Distance is still being measured '
                    'from the victim''s home.', v_reported, v_snapped, v_exact;
  end if;

  raise notice 'CHECK passed: a driveway theft''s feed distance comes from the ~1km grid, not '
               'its exact point.';
end $$;
