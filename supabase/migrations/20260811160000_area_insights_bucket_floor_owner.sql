-- =============================================================================
-- WHAT: Makes the PER-BUCKET floor in get_area_insights count only listings the
--       caller does not own — the same correction 20260811150000 applied to the
--       area total, carried through to the buckets it introduced.
--
-- WHY:  150000 closed one manufacturing route and opened another. It made the
--       AREA floor `count(*) filter (where owner_id is distinct from auth.uid())`
--       so nobody could post their way past the suppression — and in the same
--       change added per-bucket floors (`having count(*) >= 5`) computed over
--       the INCLUSIVE count, because the CTE they read had dropped owner_id.
--
--       ⚠️ THE ATTACK IS THE ONE 150000 WAS WRITTEN TO STOP, one level down.
--       Once five non-owned listings exist in a cell, an attacker posts four of
--       a chosen make, model, stolen_from and keys_taken at that point. The
--       bucket now reads 5 and is emitted; subtracting their own four says
--       exactly one non-owned listing has that combination. Cancelling those
--       four then lifts closed_total over the floor and discloses the single
--       nearby cancellation SAFETY 4 exists to hide — and refunds the cost of
--       the attack, minus card fees.
--
--       The emitted counts still INCLUDE the caller's own listings; only the
--       floor is measured without them. That keeps the deliberate carve-out in
--       DOMAIN.md (an area statistic counts a theft whoever reported it) while
--       making the suppression decision immune to the caller's own writes.
--
-- SAFETY: everything else in 150000 stands — the unconditional snap for
--   membership, the quantised origin and whole-mile radius, the lat/lng guard,
--   `recorded` as the sum of surviving buckets. The known residual there
--   (active listings are independently enumerable via search_posts, so
--   subtraction leaves a residue about non-public ones) is unchanged and is
--   still documented in docs/SECURITY_AND_TRUST.md §2.
--
--   ⚠️ AND THE TIME WINDOWS AND MONTHLY SERIES REMAIN UNFLOORED, deliberately:
--   flooring them would empty the chart for every ordinary area and make the
--   headline unusable. 150000's header retracted the claim that "nothing under
--   five is ever emitted" in one paragraph and then repeated it in another;
--   this file states it once and correctly. What is floored: make, model,
--   how-taken, keys, and the recovered/closed pair.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. One CREATE OR REPLACE of a
--   read-only function at the identical signature — no grant, dependency or
--   client call changes. No table, column, policy, index or row is touched.
--
-- LINKS: supabase/migrations/20260811150000_area_insights_quantised.sql (the
--          version this corrects — read its header for the snap and the
--          quantisation, which are unchanged);
--        supabase/tests/area_insights_verification.sql (CHECK 7b covers the
--          area floor; CHECK 7c the bucket floor);
--        docs/SECURITY_AND_TRUST.md §2; docs/DOMAIN.md (Area insights).
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
  c_min_reportable constant integer := 5;
  c_grid           constant double precision := 0.01;
  -- Exceeds the worst a 0.01 snap can move a point (~661m at UK latitudes).
  -- Pre-filter only: ANDed with a strictly narrower test, so it can only ever
  -- exclude, never admit.
  c_pad_m          constant integer := 1500;
  c_metres_mile    constant double precision := 1609.344;
  v_origin  geography;
  v_radius  integer;
  v_viewer  uuid := auth.uid();
  v_others  integer;
  v_result  jsonb;
begin
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90
     or p_lng < -180 or p_lng > 180 then
    return null;
  end if;

  -- Quantise before anything touches the table: whole miles, and an origin on
  -- the same 0.01 grid the rows are snapped to. Without this, two calls a metre
  -- apart differ by one listing and the payload difference describes it.
  v_radius := least(greatest(coalesce(p_radius_m, 32187), 1609), 80467);
  v_radius := round(greatest(round(v_radius / c_metres_mile), 1) * c_metres_mile)::integer;
  v_origin := ST_SnapToGrid(
                ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326),
                c_grid
              )::geography;

  with scan as (
    select p.owner_id
    from public.posts p
    where p.status in (
            'active', 'recovery_claimed', 'recovered',
            'recovered_no_spotter', 'cancelled', 'expired'
          )
      and p.last_seen_location is not null
      and ST_DWithin(p.last_seen_location, v_origin, v_radius + c_pad_m)
      and ST_DWithin(
            ST_SnapToGrid(p.last_seen_location::geometry, c_grid)::geography,
            v_origin, v_radius)
  )
  select count(*) filter (where owner_id is distinct from v_viewer)
    into v_others
  from scan;

  if coalesce(v_others, 0) < c_min_reportable then
    return jsonb_build_object(
      'enough_data', false,
      'radius_m',    v_radius,
      'total',       0
    );
  end if;

  with scan as (
    select
      coalesce(p.last_seen_at, p.created_at) as taken_at,
      nullif(lower(btrim(coalesce(p.make, ''))), '')  as make,
      nullif(lower(btrim(coalesce(p.model, ''))), '') as model,
      p.status,
      p.stolen_from,
      p.keys_taken,
      -- ⚠️ KEPT, unlike 150000. Every `having` below floors on the count of
      -- rows the caller does NOT own; dropping this column is what let the
      -- caller's own writes decide what gets suppressed.
      p.owner_id
    from public.posts p
    where p.status in (
            'active', 'recovery_claimed', 'recovered',
            'recovered_no_spotter', 'cancelled', 'expired'
          )
      and p.last_seen_location is not null
      and ST_DWithin(p.last_seen_location, v_origin, v_radius + c_pad_m)
      and ST_DWithin(
            ST_SnapToGrid(p.last_seen_location::geometry, c_grid)::geography,
            v_origin, v_radius)
  ),
  -- Buckets are floored HERE, once. The EMITTED number is the inclusive
  -- count(*); the FLOOR is over non-owned rows only.
  taken as (
    select stolen_from as k, count(*) as n from scan
    where stolen_from is not null group by stolen_from
    having count(*) filter (where owner_id is distinct from v_viewer) >= c_min_reportable
  ),
  keys as (
    select keys_taken as k, count(*) as n from scan
    where keys_taken is not null group by keys_taken
    having count(*) filter (where owner_id is distinct from v_viewer) >= c_min_reportable
  ),
  closed as (
    select
      count(*) filter (where status in ('recovered', 'recovered_no_spotter')) as recovered,
      count(*) filter (where status in ('recovered', 'recovered_no_spotter',
                                        'cancelled', 'expired'))              as total,
      count(*) filter (where status in ('recovered', 'recovered_no_spotter',
                                        'cancelled', 'expired')
                         and owner_id is distinct from v_viewer)              as others
    from scan
  )
  select jsonb_build_object(
    'enough_data', true,
    'radius_m',    v_radius,
    'total',       (select count(*) from scan),

    'total_7d',   (select count(*) from scan where taken_at >= now() - interval '7 days'),
    'total_30d',  (select count(*) from scan where taken_at >= now() - interval '30 days'),
    'total_90d',  (select count(*) from scan where taken_at >= now() - interval '90 days'),
    'total_365d', (select count(*) from scan where taken_at >= now() - interval '365 days'),

    -- Dense 12 months, zeros real. The series steps a NAIVE timestamp and each
    -- boundary is pinned to UTC once: generate_series adding a month to a
    -- TIMESTAMPTZ does that arithmetic in the session zone, which under
    -- America/New_York produced duplicate months and dropped others.
    'monthly', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'month', to_char(m.month, 'YYYY-MM'),
               'count', (select count(*) from scan s
                         where s.taken_at >= (m.month at time zone 'UTC')
                           and s.taken_at <  ((m.month + interval '1 month') at time zone 'UTC'))
             ) order by m.month), '[]'::jsonb)
      from generate_series(
             date_trunc('month', (now() at time zone 'UTC')) - interval '11 months',
             date_trunc('month', (now() at time zone 'UTC')),
             interval '1 month'
           ) as m(month)
    ),

    'top_makes', (
      select coalesce(jsonb_agg(jsonb_build_object('make', t.make, 'count', t.n)
                                order by t.n desc, t.make), '[]'::jsonb)
      from (select make, count(*) as n from scan
            where make is not null group by make
            having count(*) filter (where owner_id is distinct from v_viewer) >= c_min_reportable
            order by n desc, make limit 5) t
    ),
    'top_models', (
      select coalesce(jsonb_agg(jsonb_build_object(
                        'make', t.make, 'model', t.model, 'count', t.n)
                      order by t.n desc, t.make, t.model), '[]'::jsonb)
      from (select make, model, count(*) as n from scan
            where make is not null and model is not null
            group by make, model
            having count(*) filter (where owner_id is distinct from v_viewer) >= c_min_reportable
            order by n desc, make, model limit 5) t
    ),

    -- Suppressed as a PAIR on the non-owned count: `closed_total: 1` discloses
    -- one nearby cancellation, an outcome otherwise readable only by its owner.
    'recovered',    (select case when others >= c_min_reportable then recovered else 0 end
                     from closed),
    'closed_total', (select case when others >= c_min_reportable then total else 0 end
                     from closed),

    'taken_from', jsonb_build_object(
      'driveway', coalesce((select n from taken where k = 'driveway'), 0),
      'street',   coalesce((select n from taken where k = 'street'), 0),
      'car_park', coalesce((select n from taken where k = 'car_park'), 0),
      'other',    coalesce((select n from taken where k = 'other'), 0),
      'recorded', coalesce((select sum(n)::integer from taken), 0)
    ),
    'keys_taken', jsonb_build_object(
      'yes',      coalesce((select n from keys where k = 'yes'), 0),
      'no',       coalesce((select n from keys where k = 'no'), 0),
      'unknown',  coalesce((select n from keys where k = 'unknown'), 0),
      'recorded', coalesce((select sum(n)::integer from keys), 0)
    )
  ) into v_result;

  return v_result;
end;
$fn$;

comment on function public.get_area_insights(double precision, double precision, integer) is
  'How many cars have been reported stolen in an AREA, as counts only: four time windows, a DENSE 12-month series, top makes and models, a recovery rate over CLOSED listings, and how-taken / keys-taken. Counts every listing that WENT LIVE; drafts, pending_verification and rejected never. Time axis coalesce(last_seen_at, created_at). ANTI-TRILATERATION: membership is tested on ST_SnapToGrid(location, 0.01) for EVERY row, and the caller''s origin is snapped to the same grid with the radius rounded to whole miles, so the finest addressable question is a ~1km cell at a whole-mile radius. SUPPRESSION: the area floor of 5, and every bucket floor (make, model, how-taken, keys, and the recovered/closed pair), are measured over listings the caller does NOT own — the emitted counts still include them, but no one can post their way past the suppression. `recorded` is the sum of surviving buckets so the remainder cannot be subtracted out. The TIME WINDOWS and MONTHLY SERIES are deliberately NOT floored: flooring them would empty the chart for every ordinary area. KNOWN RESIDUAL: active listings in the same circle are independently enumerable via search_posts, so a residue describing non-public listings remains, bounded by the cell and the whole-mile radius rather than eliminated. SECURITY DEFINER, revoked from anon.';
