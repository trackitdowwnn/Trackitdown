-- =============================================================================
-- Search verification (NOT a migration — do not place in migrations/).
--
-- SELF-ASSERTING: every check is a DO block that RAISES EXCEPTION on failure,
-- so the whole file aborts non-zero the moment a property is violated. On
-- success each block emits a NOTICE.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset            # applies migrations + seed
--     psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/search_verification.sql
--
-- WHY THIS FILE EXISTS: search_posts and search_posts_count carry THREE copies
-- of one shared predicate, and until now NOTHING asserted they agree — a count
-- that promises N while the map draws N-1 is worse than either being wrong
-- alone. Every other major RPC had a suite; the coordinate-emitting search RPC
-- did not. 20260810100000 widened both functions (colours/body_types/year
-- ranges/origin+radius), which multiplied the ways those copies could drift.
--
-- Origin used below: central Manchester (53.4808, -2.2426), with a bbox wide
-- enough to cover Manchester + Salford + Stockport + Bury so a radius has
-- something to REMOVE rather than trivially passing.
--
-- LINKS: supabase/migrations/20260810100000_search_filters_colours_body_year_
--        distance.sql (the live definition); supabase/tests/
--        home_feed_verification.sql (the form this follows).
-- =============================================================================

-- The shared frame. A generous bbox: every seeded Greater Manchester post.
\set bbox_min_lat 53.30
\set bbox_min_lng -2.55
\set bbox_max_lat 53.70
\set bbox_max_lng -2.00


-- -----------------------------------------------------------------------------
-- CHECK 1 — TIER 1: no non-active post escapes, under ANY new criterion.
-- The seeded traps (MA99 DRF/PND/RCL/CAN/EXP/REJ) sit in Manchester on purpose,
-- so a radius search would otherwise reach them.
-- -----------------------------------------------------------------------------
do $$
declare
  v_leaks integer;
  v_criteria jsonb;
begin
  for v_criteria in
    select * from unnest(array[
      '{}'::jsonb,
      '{"colours":["Blue","Black","White","Silver","Grey","Red"]}'::jsonb,
      '{"body_types":["Hatchback","SUV","Saloon","Coupé"]}'::jsonb,
      '{"year_min":1900,"year_max":2100}'::jsonb,
      '{"colours":["Blue"],"body_types":["SUV"],"year_min":2000,"recency_days":3650}'::jsonb
    ])
  loop
    select count(*)
      into v_leaks
    from jsonb_array_elements(
           public.search_posts(53.30, -2.55, 53.70, -2.00, v_criteria, 100,
                               53.4808, -2.2426, 80467) -> 'posts') as post
    join public.posts p on p.id = (post ->> 'id')::uuid
    where p.status <> 'active';

    if v_leaks > 0 then
      raise exception 'CHECK 1 FAILED: % non-active post(s) returned for criteria %',
        v_leaks, v_criteria;
    end if;
  end loop;
  raise notice 'CHECK 1 passed: no non-active post escapes any criteria combination.';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 2 — count and results AGREE across a criteria matrix.
-- The single highest-value block here: three copies of one predicate, and this
-- is the only thing that proves they are still the same predicate.
-- -----------------------------------------------------------------------------
do $$
declare
  v_criteria jsonb;
  v_total    integer;
  v_count    integer;
  v_radius   integer;
begin
  foreach v_radius in array array[null, 80467, 8047]::integer[]
  loop
    for v_criteria in
      select * from unnest(array[
        '{}'::jsonb,
        '{"colours":["Blue"]}'::jsonb,
        '{"colours":["Blue","Black"]}'::jsonb,
        '{"body_types":["SUV"]}'::jsonb,
        '{"body_types":["Hatchback","Saloon"]}'::jsonb,
        '{"year_min":2020}'::jsonb,
        '{"year_max":2018}'::jsonb,
        '{"year_min":2018,"year_max":2021}'::jsonb,
        '{"text":"golf"}'::jsonb,
        '{"make":"BMW"}'::jsonb,
        '{"bounty_min":50000}'::jsonb,
        '{"recency_days":30}'::jsonb,
        '{"colours":["Blue"],"body_types":["SUV"],"year_min":2018,"bounty_min":50000}'::jsonb
      ])
    loop
      v_total := (public.search_posts(53.30, -2.55, 53.70, -2.00, v_criteria, 100,
                                      53.4808, -2.2426, v_radius) ->> 'total')::integer;
      v_count := public.search_posts_count(53.30, -2.55, 53.70, -2.00, v_criteria,
                                           53.4808, -2.2426, v_radius);
      if v_total is distinct from v_count then
        raise exception 'CHECK 2 FAILED: total=% but count=% for criteria % radius %',
          v_total, v_count, v_criteria, v_radius;
      end if;
    end loop;
  end loop;
  raise notice 'CHECK 2 passed: search_posts.total == search_posts_count everywhere.';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 3 — a multi-select colour is a UNION of its singles, and is
-- case-insensitive (the regression 20260807110000 fixed, extended to the new key).
-- -----------------------------------------------------------------------------
do $$
declare
  v_blue  integer;
  v_black integer;
  v_both  integer;
  v_lower integer;
begin
  v_blue  := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{"colours":["Blue"]}');
  v_black := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{"colours":["Black"]}');
  v_both  := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{"colours":["Blue","Black"]}');
  v_lower := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{"colours":["blue"]}');

  -- posts.colour is scalar, so the sets are disjoint and the union is the sum.
  if v_both <> v_blue + v_black then
    raise exception 'CHECK 3 FAILED: union % <> blue % + black %', v_both, v_blue, v_black;
  end if;
  if v_lower <> v_blue then
    raise exception 'CHECK 3 FAILED: "blue" returned % but "Blue" returned %', v_lower, v_blue;
  end if;
  if v_blue = 0 then
    raise exception 'CHECK 3 INCONCLUSIVE: no blue cars seeded — the check proves nothing.';
  end if;
  raise notice 'CHECK 3 passed: colour multi-select unions, and is case-insensitive.';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 4 — the LEGACY singular `colour` key still works (pre-2026-08-10
-- clients). The failure this guards is SILENT: an ignored colour filter returns
-- MORE cars, which nobody reports as a bug.
-- -----------------------------------------------------------------------------
do $$
declare
  v_legacy integer;
  v_modern integer;
begin
  v_legacy := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{"colour":"Blue"}');
  v_modern := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{"colours":["Blue"]}');
  if v_legacy <> v_modern then
    raise exception 'CHECK 4 FAILED: legacy colour gave %, colours gave %', v_legacy, v_modern;
  end if;
  raise notice 'CHECK 4 passed: the legacy singular colour key is honoured.';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 5 — an empty / blank / wrongly-typed facet means ANY, never NOTHING.
-- Getting this backwards would show an empty map the moment a user deselected
-- their last colour chip.
-- -----------------------------------------------------------------------------
do $$
declare
  v_any  integer;
  v_case jsonb;
  v_got  integer;
begin
  v_any := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{}'::jsonb);
  for v_case in
    select * from unnest(array[
      '{"colours":[]}'::jsonb,
      '{"colours":[""]}'::jsonb,
      '{"colours":"Blue"}'::jsonb,          -- wrong type entirely
      '{"body_types":[]}'::jsonb,
      '{"body_types":null}'::jsonb
    ])
  loop
    v_got := public.search_posts_count(53.30, -2.55, 53.70, -2.00, v_case);
    if v_got <> v_any then
      raise exception 'CHECK 5 FAILED: % returned % but "any" is %', v_case, v_got, v_any;
    end if;
  end loop;
  raise notice 'CHECK 5 passed: empty/degenerate facets mean ANY.';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 6 — year bounds, including the deliberate NULL-year exclusion.
-- -----------------------------------------------------------------------------
do $$
declare
  v_bad          integer;
  v_inverted     integer;
  v_null_year_id uuid := 'a1a1a1a1-0000-0000-0000-000000000015';
  v_unfiltered   boolean;
  v_bounded      boolean;
begin
  -- GUARD THE SUBJECT FIRST. The null-year assertions below are only meaningful
  -- while a null-year ACTIVE post actually exists; every other seeded post has
  -- a year, so if this one ever gains one the checks would pass vacuously and
  -- silently stop testing anything. Fail loudly instead.
  if not exists (
    select 1 from public.posts
    where id = v_null_year_id and year is null and status = 'active'
      and last_seen_location is not null
  ) then
    raise exception 'CHECK 6 FAILED: the null-year active seed post is missing or has '
                    'gained a year — the null-year checks below would prove nothing. '
                    'See the comment on this post in supabase/seed.sql.';
  end if;

  -- Every returned post genuinely satisfies the bound (and none has a null year).
  select count(*)
    into v_bad
  from jsonb_array_elements(
         public.search_posts(53.30, -2.55, 53.70, -2.00,
                             '{"year_min":2020}'::jsonb, 100) -> 'posts') as post
  join public.posts p on p.id = (post ->> 'id')::uuid
  where p.year is null or p.year < 2020;
  if v_bad > 0 then
    raise exception 'CHECK 6 FAILED: % post(s) returned below year_min or with a null year', v_bad;
  end if;

  -- The SAME post, both ways round: findable when no year bound is set, and
  -- dropped the moment one is. That asymmetry is the deliberate design choice
  -- (adding `or p.year is null` would make "2020–2024" return 1998 cars), so it
  -- is asserted rather than left to the comment in the migration.
  select exists (
    select 1 from jsonb_array_elements(
      public.search_posts(53.30, -2.55, 53.70, -2.00, '{}'::jsonb, 100) -> 'posts') as post
    where (post ->> 'id')::uuid = v_null_year_id)
  into v_unfiltered;

  select exists (
    select 1 from jsonb_array_elements(
      public.search_posts(53.30, -2.55, 53.70, -2.00,
                          '{"year_min":1900}'::jsonb, 100) -> 'posts') as post
    where (post ->> 'id')::uuid = v_null_year_id)
  into v_bounded;

  if not v_unfiltered then
    raise exception 'CHECK 6 FAILED: the null-year post is missing from an UNFILTERED search';
  end if;
  if v_bounded then
    raise exception 'CHECK 6 FAILED: the null-year post survived year_min 1900 — a post '
                    'that never said what year it is has not told us it is a 2020';
  end if;

  -- An inverted range returns nothing and does NOT error.
  v_inverted := public.search_posts_count(53.30, -2.55, 53.70, -2.00,
                                          '{"year_min":2022,"year_max":2018}'::jsonb);
  if v_inverted <> 0 then
    raise exception 'CHECK 6 FAILED: inverted year range returned %', v_inverted;
  end if;
  raise notice 'CHECK 6 passed: year bounds hold; a null year is findable unfiltered and '
               'excluded by any bound; inverted is empty.';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 7 — DISTANCE genuinely narrows within the bbox, and every returned
-- post is independently re-verified against ST_DWithin.
-- -----------------------------------------------------------------------------
do $$
declare
  v_bbox_only integer;
  v_tight     integer;
  v_outside   integer;
begin
  v_bbox_only := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{}'::jsonb);
  v_tight     := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{}'::jsonb,
                                            53.4808, -2.2426, 1609);   -- 1 mile

  if v_tight >= v_bbox_only then
    raise exception 'CHECK 7 FAILED: a 1-mile radius (%) did not narrow the bbox (%)',
      v_tight, v_bbox_only;
  end if;

  -- Independently confirm the circle, rather than trusting the same predicate.
  select count(*)
    into v_outside
  from jsonb_array_elements(
         public.search_posts(53.30, -2.55, 53.70, -2.00, '{}'::jsonb, 100,
                             53.4808, -2.2426, 1609) -> 'posts') as post
  join public.posts p on p.id = (post ->> 'id')::uuid
  where not ST_DWithin(
    p.last_seen_location,
    ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
    1609);
  if v_outside > 0 then
    raise exception 'CHECK 7 FAILED: % returned post(s) lie outside the radius', v_outside;
  end if;
  raise notice 'CHECK 7 passed: the radius narrows the bbox and every hit is inside it.';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 8 — the RADIUS CLAMP. Security-relevant: p_radius_m is caller-supplied
-- and anon-reachable, so an absurd value must not become a planet-scale scan
-- (and a 1-metre value must not silently mean "nothing").
-- -----------------------------------------------------------------------------
do $$
declare
  v_one_metre  integer;
  v_one_mile   integer;
  v_absurd     integer;
  v_max_radius integer;
begin
  v_one_metre := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{}'::jsonb,
                                            53.4808, -2.2426, 1);
  v_one_mile  := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{}'::jsonb,
                                            53.4808, -2.2426, 1609);
  if v_one_metre <> v_one_mile then
    raise exception 'CHECK 8 FAILED: 1 m gave % but the 1-mile floor gives %',
      v_one_metre, v_one_mile;
  end if;

  v_absurd     := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{}'::jsonb,
                                             53.4808, -2.2426, 100000000);
  v_max_radius := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{}'::jsonb,
                                             53.4808, -2.2426, 80467);
  if v_absurd <> v_max_radius then
    raise exception 'CHECK 8 FAILED: an absurd radius gave % but the 50-mile ceiling gives %',
      v_absurd, v_max_radius;
  end if;
  raise notice 'CHECK 8 passed: the radius clamps to 1-50 miles at both ends.';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 9 — half-specified geo degrades to bbox-only, never to an empty map.
-- That failure is one the user can neither see nor fix.
-- -----------------------------------------------------------------------------
do $$
declare
  v_bbox_only    integer;
  v_no_origin    integer;
  v_no_radius    integer;
  v_partial      integer;
begin
  v_bbox_only := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{}'::jsonb);
  v_no_origin := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{}'::jsonb,
                                            null, null, 1609);
  v_no_radius := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{}'::jsonb,
                                            53.4808, -2.2426, null);
  v_partial   := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{}'::jsonb,
                                            53.4808, null, 1609);
  if v_no_origin <> v_bbox_only or v_no_radius <> v_bbox_only or v_partial <> v_bbox_only then
    raise exception 'CHECK 9 FAILED: bbox=% no_origin=% no_radius=% partial=%',
      v_bbox_only, v_no_origin, v_no_radius, v_partial;
  end if;
  raise notice 'CHECK 9 passed: incomplete geo parameters fall back to bbox-only.';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 10 — A PLATE KEY DOES NOTHING.
--
-- The server-side twin of the client's RPC_CRITERIA_KEYS whitelist test, and
-- arguably the most valuable check in this file: the client whitelist only
-- constrains OUR client, while this constrains anyone holding the anon key.
-- SECURITY_AND_TRUST §1 (identity minimisation) — a plate filter would let an
-- anonymous caller confirm that a specific plate is listed.
-- -----------------------------------------------------------------------------
do $$
declare
  v_any   integer;
  v_plate integer;
  v_real  text;
begin
  select p.plate into v_real
  from public.posts p
  where p.status = 'active' and p.last_seen_location is not null
  limit 1;

  v_any   := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{}'::jsonb);
  v_plate := public.search_posts_count(53.30, -2.55, 53.70, -2.00,
                                        jsonb_build_object('plate', v_real));
  if v_plate <> v_any then
    raise exception 'CHECK 10 FAILED: a plate key CHANGED the result set (% vs %) — '
                    'plate is not a filter and must never become one', v_plate, v_any;
  end if;
  raise notice 'CHECK 10 passed: a plate key is ignored entirely.';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 11 — unknown keys are ignored, and a degenerate bbox is still empty
-- even with the new geo parameters supplied.
-- -----------------------------------------------------------------------------
do $$
declare
  v_any     integer;
  v_junk    integer;
  v_degen   integer;
begin
  v_any  := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{}'::jsonb);
  v_junk := public.search_posts_count(53.30, -2.55, 53.70, -2.00,
                                       '{"nonsense":1,"owner_id":"x","status":"draft"}'::jsonb);
  if v_junk <> v_any then
    raise exception 'CHECK 11 FAILED: unknown criteria keys changed the result (% vs %)',
      v_junk, v_any;
  end if;

  -- Inverted bbox, with a valid origin/radius that would otherwise match.
  v_degen := public.search_posts_count(53.70, -2.00, 53.30, -2.55, '{}'::jsonb,
                                        53.4808, -2.2426, 80467);
  if v_degen <> 0 then
    raise exception 'CHECK 11 FAILED: a degenerate bbox returned %', v_degen;
  end if;
  raise notice 'CHECK 11 passed: unknown keys ignored; degenerate bbox still empty.';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 12 — BACKWARDS COMPATIBILITY: calling with only the original arguments
-- behaves exactly like passing the geo parameters explicitly as null. This is
-- what makes the additive signature safe for a client built before the change.
-- -----------------------------------------------------------------------------
do $$
declare
  v_old integer;
  v_new integer;
begin
  v_old := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{"make":"BMW"}'::jsonb);
  v_new := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{"make":"BMW"}'::jsonb,
                                      null, null, null);
  if v_old <> v_new then
    raise exception 'CHECK 12 FAILED: 5-arg call gave % but explicit nulls gave %', v_old, v_new;
  end if;
  raise notice 'CHECK 12 passed: pre-migration callers are unaffected.';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 13 — a body-type filter matches the SEEDED value. Guards the
-- 'Coupe' / 'Coupé' mismatch fixed in seed.sql on 2026-08-10: an unaccented
-- stored value is unreachable from the accented option the UI offers, and the
-- symptom is simply "no results", which reads as "no such cars".
-- -----------------------------------------------------------------------------
do $$
declare
  v_coupe integer;
begin
  v_coupe := public.search_posts_count(53.30, -2.55, 53.70, -2.00,
                                        '{"body_types":["Coupé"]}'::jsonb);
  if v_coupe = 0 then
    raise exception 'CHECK 13 FAILED: no post matches body_type "Coupé" — the stored '
                    'value and the UI option have drifted apart again';
  end if;
  raise notice 'CHECK 13 passed: the accented body type reaches its seeded post.';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 14 — a caller never sees their OWN listing, under the new criteria.
-- -----------------------------------------------------------------------------
do $$
declare
  v_owner uuid;
  v_leaks integer;
begin
  select p.owner_id into v_owner
  from public.posts p
  where p.status = 'active' and p.last_seen_location is not null
  limit 1;

  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  select count(*)
    into v_leaks
  from jsonb_array_elements(
         public.search_posts(53.30, -2.55, 53.70, -2.00,
                             '{"year_min":1900}'::jsonb, 100,
                             53.4808, -2.2426, 80467) -> 'posts') as post
  where (post ->> 'id')::uuid in (select id from public.posts where owner_id = v_owner);

  perform set_config('request.jwt.claims', '', true);

  if v_leaks > 0 then
    raise exception 'CHECK 14 FAILED: % of the caller''s own post(s) were returned', v_leaks;
  end if;
  raise notice 'CHECK 14 passed: own posts stay excluded under the new criteria.';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 15 — the ABSOLUTE last-seen window (seen_from / seen_to).
--
-- The half-open assertion is the valuable one: with an inclusive `<=` upper
-- bound, a car last seen at 14:00 on the END date is silently dropped — the
-- filter excludes the very day the user asked for, and the only symptom is a
-- few missing rows. That failure is invisible unless something looks for it.
-- -----------------------------------------------------------------------------
do $$
declare
  v_id         uuid;
  v_seen       timestamptz;
  v_day_start  timestamptz;
  v_day_end    timestamptz;
  v_hit        boolean;
  v_narrowed   integer;
  v_all        integer;
begin
  -- A real active post with a known last_seen_at, inside the test bbox.
  select p.id, p.last_seen_at into v_id, v_seen
  from public.posts p
  where p.status = 'active'
    and p.last_seen_at is not null
    and p.last_seen_location && ST_MakeEnvelope(-2.55, 53.30, -2.00, 53.70, 4326)::geography
  limit 1;
  if v_id is null then
    raise exception 'CHECK 15 INCONCLUSIVE: no active post with a last_seen_at in the bbox.';
  end if;

  v_day_start := date_trunc('day', v_seen);
  v_day_end   := v_day_start + interval '1 day';

  -- HALF-OPEN: the window [start of that day, start of the next) must contain
  -- it, whatever time of day it was seen.
  select exists (
    select 1 from jsonb_array_elements(
      public.search_posts(53.30, -2.55, 53.70, -2.00,
        jsonb_build_object('seen_from', v_day_start, 'seen_to', v_day_end), 100) -> 'posts') as post
    where (post ->> 'id')::uuid = v_id)
  into v_hit;
  if not v_hit then
    raise exception 'CHECK 15 FAILED: a post last seen at % is missing from its OWN day window '
                    '[%, %) — the upper bound is not half-open', v_seen, v_day_start, v_day_end;
  end if;

  -- THE DISCRIMINATING CASE. seen_to set to the post's OWN instant: under `<`
  -- it must be excluded, under `<=` it would be included. Nothing else here
  -- separates the two operators — a bound at midnight excludes a 14:00 post
  -- either way, so a check built on that passes against the bug it is meant to
  -- catch. (Verified by flipping the operator and watching this fire.)
  select exists (
    select 1 from jsonb_array_elements(
      public.search_posts(53.30, -2.55, 53.70, -2.00,
        jsonb_build_object('seen_to', v_seen), 100) -> 'posts') as post
    where (post ->> 'id')::uuid = v_id)
  into v_hit;
  if v_hit then
    raise exception 'CHECK 15 FAILED: seen_to is INCLUSIVE — a post last seen at % matched an '
                    'upper bound of exactly %. The client sends the start of the day AFTER the '
                    'one picked, so an inclusive bound silently widens every window by a day.',
                    v_seen, v_seen;
  end if;

  -- The window genuinely narrows, and every returned post really is inside it.
  v_all := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{}'::jsonb);
  v_narrowed := public.search_posts_count(53.30, -2.55, 53.70, -2.00,
    jsonb_build_object('seen_from', v_day_start, 'seen_to', v_day_end));
  if v_narrowed >= v_all then
    raise exception 'CHECK 15 FAILED: a one-day window (%) did not narrow the full set (%)',
      v_narrowed, v_all;
  end if;
  if exists (
    select 1 from jsonb_array_elements(
      public.search_posts(53.30, -2.55, 53.70, -2.00,
        jsonb_build_object('seen_from', v_day_start, 'seen_to', v_day_end), 100) -> 'posts') as post
    join public.posts p on p.id = (post ->> 'id')::uuid
    where p.last_seen_at < v_day_start or p.last_seen_at >= v_day_end
  ) then
    raise exception 'CHECK 15 FAILED: a returned post lies outside the requested window';
  end if;

  raise notice 'CHECK 15 passed: the absolute window narrows, and its upper bound is half-open.';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 16 — the window degrades safely: NULL last_seen_at drops out, an
-- inverted range is empty rather than an error, and a MALFORMED date is ignored
-- like any other junk key rather than raising a 500 on an anon-reachable RPC.
-- -----------------------------------------------------------------------------
do $$
declare
  v_any       integer;
  v_inverted  integer;
  v_leaks     integer;
begin
  v_any := public.search_posts_count(53.30, -2.55, 53.70, -2.00, '{}'::jsonb);

  -- Malformed input must mean "no filter", the invariant every other key holds.
  if public.search_posts_count(53.30, -2.55, 53.70, -2.00,
       '{"seen_from":"not-a-date"}'::jsonb) <> v_any then
    raise exception 'CHECK 16 FAILED: a malformed seen_from changed the result set';
  end if;
  if public.search_posts_count(53.30, -2.55, 53.70, -2.00,
       '{"seen_to":"2026-13-45T99:99:99Z"}'::jsonb) <> v_any then
    raise exception 'CHECK 16 FAILED: an out-of-range seen_to changed the result set';
  end if;
  if public.search_posts_count(53.30, -2.55, 53.70, -2.00,
       '{"seen_from":{"nested":true}}'::jsonb) <> v_any then
    raise exception 'CHECK 16 FAILED: a non-string seen_from changed the result set';
  end if;

  -- Inverted: empty, and NOT an error.
  v_inverted := public.search_posts_count(53.30, -2.55, 53.70, -2.00,
    '{"seen_from":"2026-06-01T00:00:00Z","seen_to":"2026-05-01T00:00:00Z"}'::jsonb);
  if v_inverted <> 0 then
    raise exception 'CHECK 16 FAILED: an inverted window returned %', v_inverted;
  end if;

  -- A NULL last_seen_at drops out while the window is on. (Reuses the
  -- deliberately null-year seed post only if it also has a null last_seen_at;
  -- otherwise assert the general property.)
  select count(*)
    into v_leaks
  from jsonb_array_elements(
         public.search_posts(53.30, -2.55, 53.70, -2.00,
           '{"seen_from":"2000-01-01T00:00:00Z"}'::jsonb, 100) -> 'posts') as post
  join public.posts p on p.id = (post ->> 'id')::uuid
  where p.last_seen_at is null;
  if v_leaks > 0 then
    raise exception 'CHECK 16 FAILED: % post(s) with a NULL last_seen_at survived a window', v_leaks;
  end if;

  raise notice 'CHECK 16 passed: malformed/inverted windows degrade safely; NULL last_seen drops.';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 17 — count == total with the window set, alone and combined with
-- recency_days. The three copies of the shared predicate must all have gained
-- the same two lines.
-- -----------------------------------------------------------------------------
do $$
declare
  v_criteria jsonb;
  v_total    integer;
  v_count    integer;
begin
  for v_criteria in
    select * from unnest(array[
      '{"seen_from":"2026-01-01T00:00:00Z"}'::jsonb,
      '{"seen_to":"2027-01-01T00:00:00Z"}'::jsonb,
      '{"seen_from":"2026-01-01T00:00:00Z","seen_to":"2027-01-01T00:00:00Z"}'::jsonb,
      '{"seen_from":"2026-01-01T00:00:00Z","recency_days":3650}'::jsonb,
      '{"seen_from":"2026-01-01T00:00:00Z","colours":["Blue"],"year_min":2015}'::jsonb
    ])
  loop
    v_total := (public.search_posts(53.30, -2.55, 53.70, -2.00, v_criteria, 100) ->> 'total')::integer;
    v_count := public.search_posts_count(53.30, -2.55, 53.70, -2.00, v_criteria);
    if v_total is distinct from v_count then
      raise exception 'CHECK 17 FAILED: total=% but count=% for %', v_total, v_count, v_criteria;
    end if;
  end loop;
  raise notice 'CHECK 17 passed: the window agrees across search_posts and search_posts_count.';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 18 — SAFETY: a DRIVEWAY theft's pin is coarsened.
--
-- stolen_from = 'driveway' means the last-seen point IS the victim's home
-- address. get_home_feed and get_post_detail both snap it to a ~1km grid for
-- non-owners; search_posts did not, so the map handed any anonymous caller an
-- unsnapped home address — and the distance filter makes that a targeted
-- query rather than an incidental one.
--
-- Asserts BOTH directions, because a snap that also blunted every other pin
-- would break the map while still passing a one-sided check.
-- -----------------------------------------------------------------------------
do $$
declare
  v_driveway uuid := 'a1a1a1a1-0000-0000-0000-000000000006';
  v_exact    geometry;
  v_returned_lat numeric;
  v_returned_lng numeric;
  v_snapped  geometry;
  v_other_off integer;
begin
  -- Guard the subject: this proves nothing unless that post is active, in the
  -- bbox, and really flagged as a driveway theft.
  select p.last_seen_location::geometry into v_exact
  from public.posts p
  where p.id = v_driveway
    and p.status = 'active'
    and p.stolen_from = 'driveway'
    and p.last_seen_location && ST_MakeEnvelope(-2.55, 53.30, -2.00, 53.70, 4326)::geography;
  if v_exact is null then
    raise exception 'CHECK 18 FAILED: the seeded active driveway post % is missing, not active, '
                    'not flagged driveway, or outside the test bbox — the coarsening assertion '
                    'below would prove nothing.', v_driveway;
  end if;
  v_snapped := ST_SnapToGrid(v_exact, 0.01);

  select (post ->> 'lat')::numeric, (post ->> 'lng')::numeric
    into v_returned_lat, v_returned_lng
  from jsonb_array_elements(
         public.search_posts(53.30, -2.55, 53.70, -2.00, '{}'::jsonb, 100) -> 'posts') as post
  where (post ->> 'id')::uuid = v_driveway;

  if v_returned_lat is null then
    raise exception 'CHECK 18 FAILED: the driveway post is missing from an unfiltered search — '
                    'coarsening must not remove it, only blunt it.';
  end if;

  -- It must be the SNAPPED point, not the exact one.
  if v_returned_lat <> ST_Y(v_snapped)::numeric or v_returned_lng <> ST_X(v_snapped)::numeric then
    raise exception 'CHECK 18 FAILED: driveway pin returned (%, %) but the ~1km snap is (%, %) '
                    '— the exact point is (%, %). A victim''s home address is being emitted at '
                    'street precision.',
      v_returned_lat, v_returned_lng, ST_Y(v_snapped), ST_X(v_snapped),
      ST_Y(v_exact), ST_X(v_exact);
  end if;

  -- ...and NOTHING ELSE is blunted. Every non-driveway post must still come
  -- back at its exact point, or the fix has quietly degraded the whole map.
  select count(*)
    into v_other_off
  from jsonb_array_elements(
         public.search_posts(53.30, -2.55, 53.70, -2.00, '{}'::jsonb, 100) -> 'posts') as post
  join public.posts p on p.id = (post ->> 'id')::uuid
  where p.stolen_from is distinct from 'driveway'
    and ((post ->> 'lat')::numeric <> ST_Y(p.last_seen_location::geometry)::numeric
      or (post ->> 'lng')::numeric <> ST_X(p.last_seen_location::geometry)::numeric);
  if v_other_off > 0 then
    raise exception 'CHECK 18 FAILED: % non-driveway post(s) came back coarsened', v_other_off;
  end if;

  raise notice 'CHECK 18 passed: driveway pins are snapped to ~1km; every other pin stays exact.';
end $$;


do $$
begin
  raise notice 'ALL SEARCH CHECKS PASSED.';
end $$;
