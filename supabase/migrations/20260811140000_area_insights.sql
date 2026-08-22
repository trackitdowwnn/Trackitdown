-- =============================================================================
-- WHAT: get_area_insights(lat, lng, radius_m) -> jsonb. How many cars have been
--       reported stolen in an AREA, over four time windows plus a 12-month
--       series, with breakdowns by make, by model, by how the car was taken,
--       and a recovery rate. Counts only — never rows, never ids, never a
--       coordinate.
--
-- WHY:  The feed shows an owner what is happening near them one card at a time.
--       Nothing told them the shape of it: whether this month is normal for
--       here, which cars get taken, whether they come back. All of that already
--       exists in `posts` and had never been assembled.
--
--       It replaces a withdrawn per-listing page that asked data.police.uk the
--       same question. That page depended on a third party which rate-limits us
--       and publishes nothing at all for some forces. This reads our own table,
--       so it is one query, always available, and every figure is something we
--       can stand behind.
--
-- SAFETY: ⚠️ MEMBERSHIP READS THE COARSENED PIN, which is STRICTER than
--   get_home_feed — that function matches on the exact point and coarsens only
--   the distance it reports. The difference is that this returns a COUNT, and a
--   count is a far finer oracle than a card: a caller can hold the centre still
--   and walk the radius, watching for the boundary at which the total ticks up,
--   and so recover one post's distance to arbitrary precision. Repeat from
--   three centres and you have trilaterated a home. That is exactly the
--   `distance_miles` leak closed in 20260811100000, arriving by a different
--   door. Matching on post_pin_geog means the only boundary that can be found
--   is the boundary of a ~1km grid cell.
--
--   The padded ST_DWithin on the RAW column is an INDEX PRE-FILTER, not the
--   test: posts_last_seen_location_gix cannot serve a predicate wrapped in
--   post_pin_geog, so the raw column narrows the scan and the coarsened point
--   decides. Same two-step as search_posts (20260810200000). The pad must
--   exceed the furthest a snap can move a point — half a 0.01 degree cell
--   diagonally, ~650m at UK latitudes — or a post near the edge would be
--   excluded by the pre-filter before the real test ever saw it. 1500m is that
--   with room to spare.
--
--   ⚠️ THE AREA TOTAL IS FLOORED at the house c_min_reportable = 5, and below
--   it NO breakdown is returned at all. A handful of listings inside a small
--   radius is precisely where a bucket stops being a statistic and starts being
--   a description of one car. Above the floor the buckets are unfloored: "one
--   Ferrari among fifty" in a radius of at least a mile identifies nobody, and
--   an active listing is already public.
--
--   DRAFTS ARE NEVER COUNTED. A draft is an unpaid, unpublished, private
--   intention. pending_verification and rejected are excluded for the same
--   reason — nothing that never went live is a reported theft.
--
--   ⚠️ NO OWNER EXCLUSION, and this is a DEVIATION worth seeing. DOMAIN.md
--   keeps an owner's own post off "the discovery surfaces … the surfaces are
--   for finding OTHER people's cars". An area statistic is not a surface for
--   finding a car: it names none, links to none, and returns no ids. A theft
--   that happened belongs in "cars taken near here" whoever reported it, and
--   excluding the caller's own would make one person's view of their own
--   neighbourhood quietly disagree with everybody else's.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. One new function. No table,
--   column, enum, policy, index or existing function is created, altered or
--   dropped, and no row is written or deleted.
--
-- LINKS: supabase/migrations/20260811100000_feed_distance_coarsens_driveway.sql
--          (post_pin_geog, the radius clamp, and the leak this guards against);
--        supabase/migrations/20260810200000_search_matches_on_coarsened_point.sql
--          (the padded-index-then-coarsened-test shape);
--        supabase/migrations/20260807120000_alert_reach_count.sql (the
--          counts-only, revoked-from-anon, floored-at-5 posture this copies);
--        supabase/tests/area_insights_verification.sql;
--        docs/DOMAIN.md (post lifecycle; case-insensitive matching).
-- =============================================================================


create or replace function public.get_area_insights(
  p_lat      double precision,
  p_lng      double precision,
  p_radius_m integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $fn$
declare
  -- Identical to get_alert_reach's and get_post_stats' floor, on purpose.
  c_min_reportable constant integer := 5;
  -- Covers the furthest ST_SnapToGrid(0.01) can move a point (~650m at UK
  -- latitudes). Pre-filter only — see the header.
  c_pad_m          constant integer := 1500;
  v_origin  geography;
  v_radius  integer;
  v_total   integer;
  v_result  jsonb;
begin
  if p_lat is null or p_lng is null then
    return null;
  end if;

  -- 1–50 miles, default 20. Same clamp as get_home_feed, so an area you can ask
  -- the feed about is an area you can ask this about.
  v_radius := least(greatest(coalesce(p_radius_m, 32187), 1609), 80467);
  v_origin := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;

  -- ONE scan in ONE statement, as a CTE — every figure below reads it. A
  -- temporary table would have been the obvious way to reuse the scan and is
  -- WRONG here: creating and filling one is a write, and this function is
  -- `stable`. A CTE is visible to every subquery in the same statement, which
  -- is all the reuse this needs, and keeps the function genuinely read-only.
  --
  -- `went live` is the status set: a listing that reached the public, whatever
  -- became of it afterwards.
  with scan as (
    select
      -- last_seen_at is WHEN THE CAR WAS TAKEN and is the honest axis, but it
      -- is nullable; created_at (when it was reported) is the only non-null
      -- one. Dropping the nulls would understate every window silently.
      coalesce(p.last_seen_at, p.created_at) as taken_at,
      nullif(lower(btrim(coalesce(p.make, ''))), '')  as make,
      nullif(lower(btrim(coalesce(p.model, ''))), '') as model,
      p.status,
      p.stolen_from,
      p.keys_taken
    from public.posts p
    where p.status in (
            'active', 'recovery_claimed', 'recovered',
            'recovered_no_spotter', 'cancelled', 'expired'
          )
      and p.last_seen_location is not null
      -- INDEX PRE-FILTER on the raw column, padded. Not the test.
      and ST_DWithin(p.last_seen_location, v_origin, v_radius + c_pad_m)
      -- THE TEST, on the coarsened pin. See the header.
      and ST_DWithin(public.post_pin_geog(p.last_seen_location, p.stolen_from),
                     v_origin, v_radius)
  )
  select jsonb_build_object(
    'enough_data', true,
    'radius_m',    v_radius,
    'total',       (select count(*) from scan),

    -- --- The windows --------------------------------------------------------
    'total_7d',   (select count(*) from scan where taken_at >= now() - interval '7 days'),
    'total_30d',  (select count(*) from scan where taken_at >= now() - interval '30 days'),
    'total_90d',  (select count(*) from scan where taken_at >= now() - interval '90 days'),
    'total_365d', (select count(*) from scan where taken_at >= now() - interval '365 days'),

    -- --- The trend ----------------------------------------------------------
    -- A DENSE 12-month series: every month present, zeros included. Unlike the
    -- sightings series on get_post_stats, this is not sparse — reading our own
    -- table we always know, so a month with no thefts is a real 0 and the
    -- client must not have to guess which months were omitted.
    -- ⚠️ EVERY BOUNDARY IS UTC, and the `at time zone 'UTC'` casts are
    -- load-bearing rather than decoration. date_trunc on a timestamptz buckets
    -- by the SESSION timezone, and comparing a bare `timestamp` against
    -- `taken_at` (timestamptz) casts it using that same session zone — so under
    -- any non-UTC session a theft at 23:30 on the last of the month would fall
    -- into the next bucket, or out of the series entirely. Same trap
    -- get_post_stats documents for its day buckets. Building the series as
    -- timestamptz-in-UTC and formatting the label back in UTC makes the month a
    -- month wherever the connection happens to be.
    'monthly', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'month', to_char(m.month at time zone 'UTC', 'YYYY-MM'),
               'count', (select count(*) from scan s
                         where s.taken_at >= m.month
                           and s.taken_at <  m.month + interval '1 month')
             ) order by m.month), '[]'::jsonb)
      from generate_series(
             (date_trunc('month', (now() at time zone 'UTC')) - interval '11 months')
               at time zone 'UTC',
             (date_trunc('month', (now() at time zone 'UTC')))
               at time zone 'UTC',
             interval '1 month'
           ) as m(month)
    ),

    -- --- What gets taken ----------------------------------------------------
    -- Folded with lower(btrim(...)) exactly as search_posts folds, because
    -- posts.make/model have no CHECK and no write-time normalisation. Known
    -- limit, recorded in DOMAIN.md: this does NOT equate VW with Volkswagen.
    -- `display` is the folded value; the client title-cases for render rather
    -- than this picking one arbitrary spelling as canonical.
    'top_makes', (
      select coalesce(jsonb_agg(jsonb_build_object('make', t.make, 'count', t.n)
                                order by t.n desc, t.make), '[]'::jsonb)
      from (select make, count(*) as n from scan
            where make is not null group by make
            order by n desc, make limit 5) t
    ),
    'top_models', (
      select coalesce(jsonb_agg(jsonb_build_object(
                        'make', t.make, 'model', t.model, 'count', t.n)
                      order by t.n desc, t.make, t.model), '[]'::jsonb)
      from (select make, model, count(*) as n from scan
            where make is not null and model is not null
            group by make, model
            order by n desc, make, model limit 5) t
    ),

    -- --- Do they come back? -------------------------------------------------
    -- Denominator is CLOSED listings only. An active listing has not failed to
    -- be recovered; it is still out being looked for, and counting it as a miss
    -- would drag the rate down by however many cars are currently in flight.
    'recovered',    (select count(*) from scan
                     where status in ('recovered', 'recovered_no_spotter')),
    'closed_total', (select count(*) from scan
                     where status in ('recovered', 'recovered_no_spotter',
                                      'cancelled', 'expired')),

    -- --- How they were taken ------------------------------------------------
    -- ⚠️ EACH CARRIES ITS OWN DENOMINATOR, because these two columns are the
    -- thinnest data on the screen: both are CHECK-constrained, but NEITHER is
    -- collected by the posting wizard — they are post-hoc edits only, so most
    -- listings carry NULL. A bare "3 driveway" over a silent denominator would
    -- read as "3 of the thefts here", when the truth is "3 of the 6 people who
    -- happened to fill this in". The client states the denominator or draws
    -- nothing.
    'taken_from', jsonb_build_object(
      'driveway', (select count(*) from scan where stolen_from = 'driveway'),
      'street',   (select count(*) from scan where stolen_from = 'street'),
      'car_park', (select count(*) from scan where stolen_from = 'car_park'),
      'other',    (select count(*) from scan where stolen_from = 'other'),
      'recorded', (select count(*) from scan where stolen_from is not null)
    ),
    'keys_taken', jsonb_build_object(
      'yes',      (select count(*) from scan where keys_taken = 'yes'),
      'no',       (select count(*) from scan where keys_taken = 'no'),
      'unknown',  (select count(*) from scan where keys_taken = 'unknown'),
      'recorded', (select count(*) from scan where keys_taken is not null)
    )
  ) into v_result;

  -- THE FLOOR, applied after the scan rather than before it: the whole payload
  -- is built from one pass, and a second pass just to learn the total would
  -- double the work to save building an object we then discard.
  --
  -- Below it, the total is reported as 0 and NO breakdown is returned — not
  -- even a withheld-looking zero for each bucket, which would still tell a
  -- prober which buckets exist. `enough_data: false` is the whole answer.
  v_total := coalesce((v_result ->> 'total')::integer, 0);
  if v_total < c_min_reportable then
    return jsonb_build_object(
      'enough_data', false,
      'radius_m',    v_radius,
      'total',       0
    );
  end if;

  return v_result;
end;
$fn$;

comment on function public.get_area_insights(double precision, double precision, integer) is
  'How many cars have been reported stolen in an AREA (a point + a radius, clamped 1-50 miles, default 20), as counts only: four time windows, a DENSE 12-month series (zeros are real, not omitted), top makes and models, a recovery rate over CLOSED listings only, and how-taken / keys-taken each with their own `recorded` denominator. Counts every listing that WENT LIVE (active, recovery_claimed, recovered, recovered_no_spotter, cancelled, expired) - drafts, pending_verification and rejected are never counted. Time axis is coalesce(last_seen_at, created_at): last_seen_at is when the car was taken, but it is nullable. MEMBERSHIP IS TESTED ON THE COARSENED PIN (post_pin_geog), deliberately stricter than get_home_feed, because a COUNT lets a caller walk the radius to find the boundary where the total changes and so recover one post''s distance - the trilateration route closed in 20260811100000, arriving by another door; the padded ST_DWithin on the raw column is only an index pre-filter. The area total is FLOORED at 5 and below that NO breakdown is returned. Deliberately does NOT exclude the caller''s own posts: DOMAIN.md''s owner-exclusion rule is scoped to discovery surfaces, and this names no car and returns no ids. Make/model are folded with lower(btrim(...)) as search_posts folds; that does not equate VW with Volkswagen. SECURITY DEFINER and revoked from anon: it counts cancelled and expired listings, which no client may read.';

-- Authenticated only. The project ships ALTER DEFAULT PRIVILEGES granting
-- EXECUTE to anon and authenticated at create time (20260802170000), so the
-- revoke is what makes the grant meaningful rather than decorative. Unlike the
-- feed RPCs this is NOT anon-callable: the feed counts only what anon can
-- already read, and this counts cancelled and expired listings too.
revoke execute on function public.get_area_insights(double precision, double precision, integer) from public, anon;

grant execute on function public.get_area_insights(double precision, double precision, integer) to authenticated, service_role;
