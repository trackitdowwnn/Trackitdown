-- =============================================================================
-- WHAT: Replaces get_area_insights with a version whose anti-trilateration
--       guard actually works: the membership test snaps EVERY row (not just
--       driveway thefts), the caller's origin and radius are quantised before
--       they touch the table, the reportable floor is computed over listings
--       the caller does not own, and no individual bucket below the floor is
--       ever emitted.
--
-- WHY:  20260811140000 shipped four hours earlier with a guard that did not
--       guard. Its header argued — correctly — that a COUNT is a finer oracle
--       than a card, because a caller can hold the centre and walk the radius
--       until the total ticks, recovering one listing's true distance and then
--       trilaterating a home. It then implemented that guard with
--       `post_pin_geog`, which snaps ONLY when `stolen_from = 'driveway'`.
--
--       ⚠️ AND `stolen_from` IS ALMOST ALWAYS NULL. It is CHECK-constrained but
--       the posting wizard never collects it — it is a post-hoc edit — a fact
--       recorded in DOMAIN.md and in that very migration's own comments about
--       the how-taken breakdown being mostly empty. So the snap applied to a
--       small minority of rows and the exact point decided membership for
--       everything else, including real driveway thefts nobody had labelled.
--       Both facts were written down; the connection between them was not made.
--
--       This is the same control get_home_feed marks SAFETY (anti-trilateration)
--       for its recovered carousel, arriving by a new door.
--
-- SAFETY: FOUR CHANGES, each closing a distinct route.
--
--   1. UNCONDITIONAL SNAP FOR MEMBERSHIP. `ST_SnapToGrid(location, 0.01)` is
--      applied to every row rather than delegating to post_pin_geog. This
--      function emits no coordinate and needs no exact geometry for anything,
--      so there is nothing to trade off: the finest boundary discoverable by
--      walking the radius is now the edge of a ~1km cell. post_pin_geog stays
--      as it is — its driveway-only rule is right for the surfaces that DO
--      emit a point for a post the viewer can see.
--
--   2. THE QUERY SPACE IS QUANTISED. get_alert_reach — cited as the precedent
--      this copies — snaps the caller's input point "before it touches the
--      table, so the function cannot be used to resolve zone density more
--      finely than the zones are themselves stored". That control was dropped.
--      Without it the caller picks an arbitrary centre and a 1-METRE radius
--      step, so two calls at r and r+1 that both clear the floor differ by
--      exactly one listing — and the difference of the two payloads describes
--      that listing's make, model, month and outcome. The origin is now
--      snapped to the same 0.01 grid and the radius rounded to whole miles.
--      This costs the product nothing: RadiusSlider only ever emits whole
--      miles, and the screen already round-trips through Math.round.
--
--   3. THE FLOOR IS COMPUTED OVER LISTINGS THE CALLER DOES NOT OWN. The
--      emitted counts still include the caller's own — that carve-out is
--      deliberate and documented in DOMAIN.md, because an area statistic names
--      no car and a theft that happened belongs in it whoever reported it. But
--      counting them toward the FLOOR let an attacker manufacture their way
--      past it: post four or five listings at a chosen point, read the
--      breakdowns, subtract their own known rows, then cancel for a refund.
--      Nobody's figures change in the normal case; the injection route closes.
--
--   4. NO CATEGORY BUCKET BELOW THE FLOOR IS EMITTED. A total of 50 was letting
--      `closed_total: 1` through, which discloses that exactly one nearby
--      listing was cancelled or expired — an outcome otherwise readable only
--      by its owner, and withheld even from a watcher's tombstone. The make,
--      model, how-taken, keys and closure buckets are now floored
--      individually, and the how-taken blocks report the number of listings
--      actually represented rather than a denominator that included suppressed
--      rows.
--
--      ⚠️ BE PRECISE ABOUT WHAT THIS DOES NOT COVER. The TIME WINDOWS
--      (total_7d/30d/90d/365d) and the MONTHLY SERIES are deliberately NOT
--      floored, so `monthly: 1` for the current month is reachable. That is a
--      weaker disclosure than a category bucket — it says one listing exists
--      in this area in this month, not which car or what happened to it — and
--      flooring them would empty the chart for every ordinary area and make
--      the headline count unusable, which is the entire feature. It is not
--      nothing, though: combined with the search_posts enumeration in the
--      residual below, a month whose only listing is a cancelled one is
--      identifiable as such. Recorded here rather than papered over; an
--      earlier draft of this header claimed "nothing under five is ever
--      emitted", which was simply untrue of these two.
--
-- ⚠️ KNOWN RESIDUAL, not closed here. Every ACTIVE listing in a circle is
--   independently enumerable through search_posts (anon-callable, with make,
--   model and coordinates), so subtracting that known set from these totals
--   leaves a residue describing only listings the caller may not read. The
--   mitigations above bound it hard — the smallest addressable area is a ~1km
--   cell at whole-mile radii, and nothing under five is ever emitted — but
--   they do not eliminate it. Closing it fully means either counting only
--   publicly-enumerable listings (which would make a 12-month view understate
--   reality and shrink as listings age out) or requiring the non-public subset
--   to clear the floor on its own. That is a product decision, recorded here
--   rather than silently taken.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. One CREATE OR REPLACE of a
--   read-only function, keeping the identical signature so no grant, no
--   dependency and no client call changes. No table, column, policy, index or
--   row is touched.
--
-- LINKS: supabase/migrations/20260811140000_area_insights.sql (the version
--          this corrects — read its header for the shape of the payload);
--        supabase/migrations/20260807120000_alert_reach_count.sql (the input
--          snapping this restores);
--        supabase/migrations/20260811100000_feed_distance_coarsens_driveway.sql
--          (post_pin_geog, and why its driveway-only rule is right THERE);
--        supabase/tests/area_insights_verification.sql (CHECK 2 now asserts
--          the snap decides for a NON-driveway row, which is the case that
--          matters);
--        docs/SECURITY_AND_TRUST.md §2.
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
  -- ~1km, the grid every coarsened point in this system uses.
  c_grid           constant double precision := 0.01;
  -- Covers the furthest a 0.01 snap can move a point. Measured, not assumed:
  -- 648.8m worst case swept across UK latitudes (max at the southern edge),
  -- so this carries better than 2x margin. Pre-filter only.
  c_pad_m          constant integer := 1500;
  c_metres_mile    constant double precision := 1609.344;
  v_origin  geography;
  v_radius  integer;
  v_viewer  uuid := auth.uid();
  v_total   integer;
  v_others  integer;
  v_result  jsonb;
begin
  -- Degenerate input returns null rather than raising out of the geography
  -- cast, mirroring get_alert_reach's guard.
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90
     or p_lng < -180 or p_lng > 180 then
    return null;
  end if;

  -- QUANTISE BEFORE ANYTHING TOUCHES THE TABLE (SAFETY 2). Radius to whole
  -- miles within the 1-50 clamp; origin to the 0.01 grid.
  v_radius := least(greatest(coalesce(p_radius_m, 32187), 1609), 80467);
  v_radius := greatest(round(v_radius / c_metres_mile)::integer, 1)
              * c_metres_mile::integer;
  v_origin := ST_SnapToGrid(
                ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326),
                c_grid
              )::geography;

  with scan as (
    select
      coalesce(p.last_seen_at, p.created_at) as taken_at,
      nullif(lower(btrim(coalesce(p.make, ''))), '')  as make,
      nullif(lower(btrim(coalesce(p.model, ''))), '') as model,
      p.status,
      p.stolen_from,
      p.keys_taken,
      p.owner_id
    from public.posts p
    where p.status in (
            'active', 'recovery_claimed', 'recovered',
            'recovered_no_spotter', 'cancelled', 'expired'
          )
      and p.last_seen_location is not null
      -- INDEX PRE-FILTER on the raw column, padded. Not the test. It can only
      -- ever EXCLUDE, never admit, because it is ANDed with a strictly
      -- narrower predicate.
      and ST_DWithin(p.last_seen_location, v_origin, v_radius + c_pad_m)
      -- THE TEST (SAFETY 1). EVERY row is snapped — not post_pin_geog, which
      -- snaps driveway thefts only and would leave the guard inert for the
      -- vast majority of rows, whose stolen_from is null.
      and ST_DWithin(
            ST_SnapToGrid(p.last_seen_location::geometry, c_grid)::geography,
            v_origin, v_radius)
  )
  select
    count(*),
    count(*) filter (where owner_id is distinct from v_viewer)
    into v_total, v_others
  from scan;

  -- THE FLOOR, over listings the caller does NOT own (SAFETY 3).
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
      p.keys_taken
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
  -- Buckets are floored HERE (SAFETY 4), once, so every consumer below reads
  -- an already-suppressed set rather than each remembering to.
  taken as (
    select stolen_from as k, count(*) as n from scan
    where stolen_from is not null group by stolen_from
    having count(*) >= c_min_reportable
  ),
  keys as (
    select keys_taken as k, count(*) as n from scan
    where keys_taken is not null group by keys_taken
    having count(*) >= c_min_reportable
  ),
  closed as (
    select
      count(*) filter (where status in ('recovered', 'recovered_no_spotter')) as recovered,
      count(*) filter (where status in ('recovered', 'recovered_no_spotter',
                                        'cancelled', 'expired'))              as total
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

    -- Dense 12 months, zeros real.
    --
    -- ⚠️ THE SERIES STEPS A NAIVE `timestamp`, AND CONVERTS PER ELEMENT. An
    -- earlier version generated timestamptz values and claimed that made the
    -- months UTC-correct under any connection. It did not: `generate_series`
    -- adding `interval '1 month'` to a TIMESTAMPTZ does that arithmetic in the
    -- SESSION zone, so across a DST boundary the steps drift by an hour and
    -- month starts land on the wrong side of midnight. Measured under
    -- America/New_York: the old form produced 2025-10 TWICE, dropped 2025-11
    -- and 2026-02 entirely, and lost the current month off the end. Latent on
    -- Supabase only because its sessions run UTC — exactly the kind of "works
    -- here" the get_post_stats day-bucket comment warns about.
    --
    -- Stepping a naive timestamp keeps the month arithmetic calendrical and
    -- zone-free; each boundary is then pinned to UTC once, where it is compared
    -- against `taken_at`.
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

    -- Folded as search_posts folds. A bucket under the floor is not listed at
    -- all rather than shown as zero: a zeroed row still says the bucket exists.
    'top_makes', (
      select coalesce(jsonb_agg(jsonb_build_object('make', t.make, 'count', t.n)
                                order by t.n desc, t.make), '[]'::jsonb)
      from (select make, count(*) as n from scan
            where make is not null group by make
            having count(*) >= c_min_reportable
            order by n desc, make limit 5) t
    ),
    'top_models', (
      select coalesce(jsonb_agg(jsonb_build_object(
                        'make', t.make, 'model', t.model, 'count', t.n)
                      order by t.n desc, t.make, t.model), '[]'::jsonb)
      from (select make, model, count(*) as n from scan
            where make is not null and model is not null
            group by make, model
            having count(*) >= c_min_reportable
            order by n desc, make, model limit 5) t
    ),

    -- Recovery over CLOSED listings only — an active listing has not failed to
    -- be recovered, it is still being looked for. Suppressed entirely below the
    -- floor: `closed_total: 1` discloses one nearby cancellation.
    'recovered',    (select case when total >= c_min_reportable then recovered else 0 end
                     from closed),
    'closed_total', (select case when total >= c_min_reportable then total else 0 end
                     from closed),

    -- `recorded` is the number of listings ACTUALLY REPRESENTED below, i.e. the
    -- sum of the surviving buckets — not the raw count of listings that filled
    -- the field in. Anything else would let the suppressed remainder be
    -- recovered by subtraction, which is the whole point of suppressing it.
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
  'How many cars have been reported stolen in an AREA, as counts only: four time windows, a DENSE 12-month series (zeros are real), top makes and models, a recovery rate over CLOSED listings, and how-taken / keys-taken. Counts every listing that WENT LIVE (active, recovery_claimed, recovered, recovered_no_spotter, cancelled, expired); drafts, pending_verification and rejected never. Time axis is coalesce(last_seen_at, created_at). ANTI-TRILATERATION (corrected 2026-08-11, superseding 20260811140000): membership is tested on ST_SnapToGrid(location, 0.01) for EVERY row - NOT post_pin_geog, which snaps driveway thefts only and left the guard inert because stolen_from is almost always null; and the caller''s ORIGIN is snapped to the same grid with the RADIUS rounded to whole miles, restoring the input quantisation get_alert_reach uses, without which two calls one metre apart differ by exactly one listing and the payload difference describes it. The floor of 5 is computed over listings the caller does NOT own, so an attacker cannot post their way past it; individual buckets below the floor are omitted, and `recorded` reports the listings actually represented rather than a denominator that would let the remainder be subtracted out. KNOWN RESIDUAL: active listings in the same circle are independently enumerable via search_posts, so a residue describing non-public listings remains; bounded by the ~1km cell and whole-mile radii, not eliminated. SECURITY DEFINER, revoked from anon.';
