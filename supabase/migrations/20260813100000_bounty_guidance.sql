-- =============================================================================
-- WHAT: get_bounty_guidance(lat, lng) -> jsonb. The two facts a bounty
--       recommendation may honestly be built from, in one round trip:
--         · `rungs`  — how many spotters each of 7 fixed bounty levels reaches
--                      at this point today (the get_alert_reach predicate, run
--                      once per rung);
--         · `local`  — the p25/median/p75 bounty other owners near here have
--                      actually set, or NULL when too few to say.
--
-- WHY:  Owners are asked to name a number with nothing to name it against, and
--       the slider seeds at £250 because a default had to be something. The
--       honest guidance we can give is NOT "cars like yours are recovered N% of
--       the time" — we hold no such data and inventing it under a money
--       recommendation would be the worst thing this feature could do. It is
--       the two things we can actually observe: what a bounty BUYS in
--       distribution (alert_zones.min_bounty_pence literally gates who is
--       shown the listing), and what the neighbourhood already pays.
--
--       Both are counts over our own tables. There is no model here, no
--       third-party call and no inference — the client turns these numbers into
--       a range with a pure, unit-tested function, and every sentence it shows
--       traces back to one field below.
--
-- SAFETY: `rungs` counts rows describing OTHER PEOPLE'S HOME-ISH POINTS
--   (alert_zones.point — SECURITY_AND_TRUST §3). It inherits get_alert_reach's
--   four containments verbatim, and adds nothing to the attack surface:
--
--   1. COUNTS ONLY. Integers in a fixed-shape payload. Never a user id, never a
--      row from alert_zones. If a caller ever needs to know WHO, that is a
--      different function with a different grant (match_alert_zones, which is
--      service-role only for exactly this reason).
--   2. AUTHENTICATED ONLY. Revoked from public and anon below.
--   3. THE INPUT IS SNAPPED to the same 0.01° (~1km) grid the zones are stored
--      on, before it touches either table.
--   4. A FLOOR OF 5, applied INDEPENDENTLY PER RUNG and to the local sample.
--      Below it the rung reads 0 and `local` is NULL, not the true small number.
--
--   ⚠️ THE KEY ARGUMENT: this discloses nothing get_alert_reach does not already
--   disclose. Seven rungs is arithmetically identical to seven calls to
--   get_alert_reach — same grid snap, same floor, same caller exclusion, same
--   predicate — which any authenticated client can make today. It exists to
--   spend ONE round trip instead of seven, and because the recommendation needs
--   the CURVE (where reach stops growing), not a single point on it.
--
--   The caller's own zone and the caller's own posts are excluded throughout, so
--   an owner never sees themselves in the number they are being asked to act on.
--
-- ⚠️ WHAT THIS IS NOT: a prediction, and not a delivery promise. It says what a
--   bounty reaches, never what it recovers. Client copy says "reaches", never
--   "notifies" and never "recovers" — push registration, the rolling daily cap
--   and the per-post dedupe in match_alert_zones all sit between these counts
--   and any notification, and nothing here measures outcomes at all.
--
-- LINKS: supabase/migrations/20260807120000_alert_reach_count.sql
--          (get_alert_reach — the predicate and every containment reused here);
--        supabase/migrations/20260811160000_area_insights_bucket_floor_owner.sql
--          (the padded-prefilter/snapped-authoritative spatial idiom);
--        src/features/vehicles/post/lib/bountyRecommendation.ts (the pure
--          function that turns this payload into a range);
--        docs/SECURITY_AND_TRUST.md §3 (location is personal data).
-- =============================================================================

create or replace function public.get_bounty_guidance(
  p_lat double precision,
  p_lng double precision
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $fn$
declare
  -- Same floor, same reasons, as get_alert_reach: small counts are the
  -- identifying ones, and "2 spotters are watching" is also the answer we would
  -- least want to hand a thief.
  c_min_reportable constant integer := 5;
  c_grid           constant double precision := 0.01;
  -- Pre-filter pad only. Exceeds the worst a 0.01° snap can move a point
  -- (~661m at UK latitudes), and is ANDed with a strictly narrower test, so it
  -- can only ever exclude, never admit.
  c_pad_m          constant integer := 1500;
  -- 20 miles — the get_home_feed / get_area_insights default radius. The local
  -- band answers "round here", and "round here" is already defined once.
  c_local_radius_m constant integer := 32187;

  -- MONEY: integer pence, GBP. Every rung is inside posts.bounty_amount_pence's
  -- CHECK (5000..500000) and lands on the MoneySlider's £25 snap grid, so every
  -- number derived from this array is one the owner can actually select.
  c_rungs constant integer[] := array[5000, 10000, 25000, 50000, 100000, 250000, 500000];

  v_point  geography;
  v_viewer uuid := auth.uid();
  v_rungs  jsonb;
  v_local  jsonb;
begin
  -- Degenerate input yields an empty payload rather than an error: this feeds a
  -- live wizard whose location step may not have resolved yet, and a throw here
  -- would surface as a failure on a screen that must never block posting.
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90
     or p_lng < -180 or p_lng > 180 then
    return jsonb_build_object('rungs', '[]'::jsonb, 'local', null);
  end if;

  -- SAFETY 3: snap BEFORE either table is touched, so this cannot resolve zone
  -- density or bounty distribution more finely than the zones are stored.
  v_point := ST_SnapToGrid(
               ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326),
               c_grid
             )::geography;

  -- ---------------------------------------------------------------------------
  -- rungs: the reach curve.
  --
  -- The predicate is get_alert_reach's, unchanged — including the deliberate
  -- omission of make/model/colour/recency. Folding vehicle matching in would
  -- make the DELTA between two rungs unreadable (a higher bounty could show a
  -- lower count because a different set of zones filters on a different make),
  -- and the delta is the entire point of a curve.
  -- ---------------------------------------------------------------------------
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'bounty_pence', r.rung,
               -- SAFETY 4, per rung and independently. Reach is monotonic in
               -- bounty, so a floored rung simply reads 0 and the curve starts
               -- where it clears.
               'reach', case when r.n >= c_min_reportable then r.n else 0 end
             )
             order by r.rung
           ),
           '[]'::jsonb
         )
    into v_rungs
  from (
    select
      rung,
      (
        select count(distinct z.user_id)
        from public.alert_zones z
        where z.enabled                                  -- paused zones reach nobody
          and z.user_id is distinct from v_viewer        -- never count the caller
          -- geography => ST_DWithin is TRUE METRES; GiST-assisted.
          and ST_DWithin(z.point, v_point, z.radius_m)
          -- MONEY: integer pence both sides. The only criterion applied.
          and (z.min_bounty_pence is null or rung >= z.min_bounty_pence)
      )::integer as n
    from unnest(c_rungs) as rung
  ) r;

  -- ---------------------------------------------------------------------------
  -- local: what owners round here actually set.
  --
  -- Status set matches get_area_insights: drafts, pending_verification and
  -- rejected are NEVER counted — a draft's bounty is a number someone is still
  -- typing, and counting it would let one indecisive user move the band.
  -- ---------------------------------------------------------------------------
  with scan as (
    select p.bounty_amount_pence as pence
    from public.posts p
    where p.status in (
            'active', 'recovery_claimed', 'recovered',
            'recovered_no_spotter', 'cancelled', 'expired'
          )
      -- The caller's own posts are excluded outright, not merely excluded from
      -- the floor. What you already chose must not be evidence for what you
      -- should choose.
      and p.owner_id is distinct from v_viewer
      and p.last_seen_location is not null
      -- Index pre-filter, then the authoritative snapped predicate.
      and ST_DWithin(p.last_seen_location, v_point, c_local_radius_m + c_pad_m)
      and ST_DWithin(
            ST_SnapToGrid(p.last_seen_location::geometry, c_grid)::geography,
            v_point, c_local_radius_m)
  )
  select
    case
      when count(*) >= c_min_reportable then
        jsonb_build_object(
          'p25_pence',
            round(percentile_cont(0.25) within group (order by pence::double precision))::integer,
          'median_pence',
            round(percentile_cont(0.50) within group (order by pence::double precision))::integer,
          'p75_pence',
            round(percentile_cont(0.75) within group (order by pence::double precision))::integer,
          'sample', count(*)::integer
        )
      -- SAFETY 4 again. Below the floor we say nothing, rather than say a
      -- number two listings could move.
      else null
    end
    into v_local
  from scan;

  return jsonb_build_object('rungs', v_rungs, 'local', v_local);
end;
$fn$;

comment on function public.get_bounty_guidance(double precision, double precision) is
  'The two observable inputs to a bounty recommendation, in one round trip: `rungs` (spotter reach at 7 fixed bounty levels — the get_alert_reach predicate run once per rung, so the client can see WHERE more money stops buying more eyes) and `local` (p25/median/p75 of bounty_amount_pence on nearby posts, or NULL below 5 samples). Discloses nothing get_alert_reach does not already: identical grid snap (0.01°), identical floor of 5 applied independently per rung, identical caller exclusion, identical predicate — seven rungs is seven calls any authenticated client could already make, spent as one. SECURITY DEFINER and revoked from anon because it counts rows describing other people''s home-ish points. Says what a bounty REACHES, never what it recovers: nothing here measures outcomes, and no client copy built on it may imply otherwise. Degenerate input returns an empty payload rather than raising, because it feeds a live wizard that must never block posting.';

-- Authenticated only. The project ships ALTER DEFAULT PRIVILEGES granting
-- EXECUTE to anon AND authenticated at create time (20260802170000), so the
-- revoke is what makes the grant meaningful rather than decorative.
revoke execute on function public.get_bounty_guidance(double precision, double precision)
  from public, anon;

grant execute on function public.get_bounty_guidance(double precision, double precision)
  to authenticated, service_role;
