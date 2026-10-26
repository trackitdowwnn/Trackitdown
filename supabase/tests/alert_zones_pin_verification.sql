-- =============================================================================
-- WHAT:  Verification for 20261026170000_alert_zones_match_the_pin.sql. NOT a
--        migration.
-- WHY:   A driveway theft's point is the victim's home. A zone whose edge holds
--        the EXACT point but not the ~1km-snapped one must not be alerted —
--        otherwise whether a push arrives tells its owner where the home is.
--        A zone holding the snapped point still is, or coarsening deleted the
--        audience instead of blurring it.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        Seed: Alex (1111…) owns the active driveway post …0006; Beth (2222…)
--        gets one zone, moved between the two cases.
-- LINKS: supabase/migrations/20261026170000_alert_zones_match_the_pin.sql;
--        supabase/tests/audit_fixes_verification.sql CHECK 1 (the feed twin).
-- =============================================================================

begin;

do $$
declare
  v_post   constant uuid := 'a1a1a1a1-0000-0000-0000-000000000006';
  v_beth   constant text := '22222222-2222-2222-2222-222222222222';
  v_r      constant int  := 1609;   -- the smallest radius a zone may have
  v_exact  geography;
  v_snap   geography;
  v_centre geography;
  v_users  jsonb;
begin
  select p.last_seen_location into v_exact
    from public.posts p
   where p.id = v_post and p.status = 'active' and p.stolen_from = 'driveway';
  if v_exact is null then
    raise exception 'CHECK 1 FAILED: the seeded active driveway post is missing.';
  end if;
  v_snap := ST_SnapToGrid(v_exact::geometry, 0.01)::geography;

  -- A zone whose edge sits 50 m beyond the exact point, on the side away from
  -- the snapped one: it holds the home, but not the pin.
  v_centre := ST_Project(v_exact, v_r - 50, ST_Azimuth(v_snap, v_exact));
  if ST_Distance(v_centre, v_snap) <= v_r then
    raise exception 'CHECK 1 FAILED: fixture — the snapped point also lies inside this zone.';
  end if;

  insert into public.alert_zones (user_id, name, point, radius_m, enabled, approximate)
  values (v_beth::uuid, 'pin check', v_centre, v_r, true, false);

  v_users := public.match_alert_zones(v_post, 3) -> 'user_ids';
  if v_users ? v_beth then
    raise exception 'CHECK 1 FAILED: a zone holding a driveway victim''s exact home, but not '
                    'its snapped pin, was alerted — the push is a location oracle.';
  end if;
  raise notice 'CHECK 1 passed: a zone around the exact home alone is not alerted.';

  -- CHECK 2 — the same zone moved onto the snapped point IS alerted.
  update public.alert_zones set point = v_snap
   where user_id = v_beth::uuid and name = 'pin check';
  v_users := public.match_alert_zones(v_post, 3) -> 'user_ids';
  if not (v_users ? v_beth) then
    raise exception 'CHECK 2 FAILED: a zone holding the snapped pin was not alerted — '
                    'coarsening removed the audience instead of blurring the point.';
  end if;
  raise notice 'CHECK 2 passed: a zone holding the snapped pin is alerted.';
end $$;

rollback;
