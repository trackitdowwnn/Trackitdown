-- =============================================================================
-- WHAT: get_alert_reach(lat, lng, bounty_pence) -> integer. How many spotters
--       an alert at this point and this bounty would reach today. A COUNT and
--       nothing else, ever.
--
-- WHY:  Owners choose bounties at the low end because the strongest reason to
--       choose a higher one is invisible. Spotters set min_bounty_pence on
--       their alert zone and match_alert_zones only pushes when a post clears
--       THEIR threshold — so the bounty literally decides how many phones light
--       up, and nothing in the posting wizard says so. This lets the bounty
--       slider answer "why would I pay more" with a fact instead of a nudge.
--
--       Deliberately NOT a persuasion feature: the platform retains 5% of every
--       bounty and the caller is someone whose car was stolen this week. A real
--       number is defensible; manufactured urgency in the same slot would not
--       be.
--
-- SAFETY: this counts rows describing OTHER PEOPLE'S HOME-ISH POINTS
--   (alert_zones.point — SECURITY_AND_TRUST §3). Four containments, all
--   load-bearing:
--
--   1. COUNT ONLY. It returns an integer. match_alert_zones is service-role
--      only precisely because it returns user ids — "a location oracle over
--      strangers", in its own comment. This function must NEVER grow a row
--      shape, a jsonb payload or an out parameter. If a caller ever needs to
--      know WHO, that is a different function with a different grant.
--   2. AUTHENTICATED ONLY. Revoked from public and anon below. Zone density is
--      not public data.
--   3. THE INPUT IS SNAPPED to the same 0.01° (~1km) grid the zones themselves
--      are stored on (upsert_my_alert_zone's ST_SnapToGrid idiom, reused
--      verbatim). Probing at street precision then buys nothing over probing at
--      kilometre precision — the answer is identical inside a cell.
--   4. A FLOOR. Below MIN_REPORTABLE the function returns 0 rather than the
--      true small number. Small counts are the ones that could narrow down an
--      individual, and "2 spotters are watching" is also the answer we would
--      least want to hand a thief.
--
--   The caller's OWN zone is excluded, so an owner never counts themselves.
--
-- ⚠️ WHAT THIS IS NOT: a delivery promise. It counts zones that match TODAY.
--   Push registration, the rolling daily cap and the per-post dedupe in
--   match_alert_zones all sit between this number and a notification anyone
--   receives. Client copy says "reaches", never "notifies".
--
-- LINKS: supabase/migrations/20260802160000_alert_criteria_matching.sql
--          (match_alert_zones — the predicate this mirrors);
--        supabase/migrations/20260802120000_alert_zones.sql (the table, the
--          grid-snap idiom, and why clients hold no direct grants);
--        docs/SECURITY_AND_TRUST.md §3 (location is personal data).
-- =============================================================================

create or replace function public.get_alert_reach(
  p_lat          double precision,
  p_lng          double precision,
  p_bounty_pence integer
)
returns integer
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  -- Below this, report 0. Both the privacy floor and a product decision: an
  -- owner hours from a theft should not be told "2 spotters are watching".
  c_min_reportable constant integer := 5;
  v_point geography;
  v_count integer;
begin
  -- Degenerate input yields 0 rather than an error: this feeds a live slider,
  -- and a wizard whose location step has not resolved yet must not throw.
  if p_lat is null or p_lng is null or p_bounty_pence is null then
    return 0;
  end if;
  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    return 0;
  end if;

  -- SAFETY 3: snap to the 0.01° grid BEFORE it touches the table, so the
  -- function cannot be used to resolve zone density more finely than the zones
  -- are themselves stored.
  v_point := ST_SnapToGrid(
               ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326),
               0.01
             )::geography;

  select count(distinct z.user_id)
    into v_count
  from public.alert_zones z
  where z.enabled                                        -- paused zones reach nobody
    -- Never count the caller. An owner posting their own car would otherwise
    -- see themselves in the number they are being asked to act on.
    and z.user_id is distinct from auth.uid()
    -- geography => ST_DWithin is TRUE METRES; GiST-assisted, narrows first.
    and ST_DWithin(z.point, v_point, z.radius_m)
    -- MONEY: integer pence both sides, GBP implied. The same comparison
    -- match_alert_zones makes, and the ONLY criterion applied here.
    --
    -- Make/model/colour/body_type/recency are deliberately NOT applied. The
    -- question this answers is "how many more people does more money reach",
    -- and folding vehicle matching in would make the delta between two bounties
    -- unreadable — a £100 rise could lower the count because a different set of
    -- zones happens to filter on a different make. The client copy is about
    -- the bounty, so the count must be about the bounty.
    and (z.min_bounty_pence is null or p_bounty_pence >= z.min_bounty_pence);

  -- SAFETY 4.
  if coalesce(v_count, 0) < c_min_reportable then
    return 0;
  end if;
  return v_count;
end;
$$;

comment on function public.get_alert_reach(double precision, double precision, integer) is
  'How many OTHER spotters an alert at this point and bounty would reach today: enabled alert zones whose radius covers the point and whose min_bounty_pence the bounty clears. Drives the bounty slider''s "reaches N spotters" line so an owner can see what a higher bounty buys. SECURITY DEFINER and revoked from anon: it counts rows describing other people''s home-ish points. Returns an INTEGER and must never grow a row shape — match_alert_zones is service-role only because it returns user ids, and this is the same data one aggregation away. The input point is ST_SnapToGrid''d to 0.01° (~1km) before use, matching how the zones are stored, so finer probing buys nothing; counts below 5 return 0 (small counts are the identifying ones, and it is also the answer we would least want to give a thief); the caller''s own zone is excluded. Applies the BOUNTY criterion only — make/model/colour/recency are deliberately ignored so the delta between two bounties stays readable. NOT a delivery promise: push registration, the rolling daily cap and the per-post dedupe all sit between this count and a notification.';

-- Authenticated only. The project ships ALTER DEFAULT PRIVILEGES granting
-- EXECUTE to anon AND authenticated at create time (20260802170000), so the
-- revoke is what makes the grant meaningful rather than decorative.
revoke execute on function public.get_alert_reach(double precision, double precision, integer)
  from public, anon;
grant execute on function public.get_alert_reach(double precision, double precision, integer)
  to authenticated, service_role;
