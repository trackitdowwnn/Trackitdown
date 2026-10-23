-- =============================================================================
-- WHAT:  Verification for 20261023110000_security_followups.sql. NOT a
--        migration.
-- WHY:   Two Security Advisor follow-ups (2026-10-23): signed-in users can no
--        longer ask plate_available whether a plate is listed (it also saw
--        listings not yet public); and the two public logging RPCs stop at a
--        daily cap per table, so a loop can't fill them for free.
--
-- CHECKS: 1 ⚠️ authenticated can't execute plate_available (anon already
-- couldn't — anon_role_verification CHECK 8) · 2 telemetry under the cap
-- records as before · 3 ⚠️ near the cap a batch writes only the room left,
-- then nothing, quietly (returns 0, no error) · 4 onboarding under the cap
-- records · 5 ⚠️ at its cap onboarding records nothing, quietly · 6 both
-- logging RPCs are still open to the public key.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        The caps are reached by seeding today's rows as postgres.
-- LINKS: supabase/migrations/20261023110000_security_followups.sql.
-- =============================================================================

begin;

-- 1 — plate_available: signed-in users refused (42501), the body never runs.
set local role authenticated;
do $$
begin
  begin
    perform public.plate_available('MA19 XKL');
    raise exception 'CHECK 1 FAILED: authenticated could still call plate_available';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;
reset role;

-- 2 — telemetry under the cap records as before.
set local role anon;
do $$
declare
  v_written integer;
begin
  v_written := public.record_telemetry_events(
    gen_random_uuid(),
    '[{"event": "test_event", "feature": "test", "level": "info"}]'::jsonb
  );
  if v_written <> 1 then
    raise exception 'CHECK 2 FAILED: one event under the cap wrote %', v_written;
  end if;
end $$;
reset role;

-- 3 — fill today to 19,998: a batch of five writes the 2 left, then nothing.
do $$
declare
  v_today integer := (select count(*) from public.telemetry_events where at >= date_trunc('day', now()));
begin
  insert into public.telemetry_events (session_id, event, feature, level)
  select gen_random_uuid(), 'seed_event', 'test', 'info'
    from generate_series(1, 19998 - v_today);
end $$;
set local role anon;
do $$
declare
  v_batch jsonb := (
    select jsonb_agg(jsonb_build_object('event', 'test_event', 'feature', 'test'))
      from generate_series(1, 5)
  );
  v_written integer;
begin
  v_written := public.record_telemetry_events(gen_random_uuid(), v_batch);
  if v_written <> 2 then
    raise exception 'CHECK 3 FAILED: with room for 2, a batch of 5 wrote %', v_written;
  end if;
  v_written := public.record_telemetry_events(gen_random_uuid(), v_batch);
  if v_written <> 0 then
    raise exception 'CHECK 3 FAILED: at the cap a batch still wrote %', v_written;
  end if;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.telemetry_events where at >= date_trunc('day', now())) <> 20000 then
    raise exception 'CHECK 3 FAILED: today holds % telemetry rows, not the 20,000 cap',
      (select count(*) from public.telemetry_events where at >= date_trunc('day', now()));
  end if;
end $$;

-- 4 — onboarding under the cap records. Called as anon; read back as postgres
-- (anon can't read the table — rightly), so a fixed run id joins the two.
set local role anon;
select public.record_onboarding_step('5ecf0000-0000-0000-0000-000000000004', 'completed');
reset role;
do $$
begin
  if not exists (select 1 from public.onboarding_events
                  where run_id = '5ecf0000-0000-0000-0000-000000000004') then
    raise exception 'CHECK 4 FAILED: an onboarding step under the cap was not recorded';
  end if;
end $$;

-- 5 — fill onboarding to its cap: the next step is quietly not recorded.
do $$
declare
  v_today integer := (select count(*) from public.onboarding_events where at >= date_trunc('day', now()));
begin
  insert into public.onboarding_events (run_id, step)
  select gen_random_uuid(), 'completed' from generate_series(1, 5000 - v_today);
end $$;
set local role anon;
select public.record_onboarding_step('5ecf0000-0000-0000-0000-000000000005', 'completed'); -- no error
reset role;
do $$
begin
  if exists (select 1 from public.onboarding_events
              where run_id = '5ecf0000-0000-0000-0000-000000000005') then
    raise exception 'CHECK 5 FAILED: an onboarding step was recorded past the daily cap';
  end if;
end $$;

-- 6 — both stay open to the public key (pre-sign-in onboarding, app telemetry).
do $$
begin
  if not has_function_privilege('anon', 'public.record_telemetry_events(uuid, jsonb)', 'execute')
     or not has_function_privilege('anon', 'public.record_onboarding_step(uuid, text, smallint, text)', 'execute') then
    raise exception 'CHECK 6 FAILED: a logging RPC is no longer callable by the public key';
  end if;
end $$;

rollback;
