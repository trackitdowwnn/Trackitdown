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
-- CHECK 6 — ST_DWithin uses the GiST index posts_last_seen_location_gix.
-- Captures the EXPLAIN (FORMAT JSON) plan and asserts the index name appears.
-- SET LOCAL forces an index plan on the tiny seeded table (whole table fits in
-- one page, so the planner would otherwise prefer a Seq Scan) and auto-resets
-- when the DO block's implicit transaction ends.
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
      and ST_DWithin(
            last_seen_location,
            ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
            15000)
  $q$ into v_plan;

  if position('posts_last_seen_location_gix' in v_plan::text) = 0 then
    raise exception 'CHECK 6 FAILED: ST_DWithin plan did not use posts_last_seen_location_gix. Plan: %', v_plan::text;
  end if;
  raise notice 'CHECK 6 passed: ST_DWithin uses the GiST index posts_last_seen_location_gix';
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
