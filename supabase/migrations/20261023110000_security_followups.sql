-- =============================================================================
-- WHAT:  Two follow-ups from the Supabase Security Advisor triage (2026-10-23):
--        1. plate_available(text) — no longer callable by signed-in users.
--        2. record_telemetry_events / record_onboarding_step — a DAILY cap on
--           rows per table, on top of the existing per-call caps.
-- WHY:   1. plate_available told any signed-in user whether a plate is on a
--           listing — including ones NOT public yet (pending_verification) or
--           with a recovery claimed. For a stolen-car app that is exactly what
--           someone holding the car would like to check. The app hasn't called
--           it since the post-a-car redesign (65c612e); create_post enforces
--           "one live listing per plate" itself at submit. So access goes
--           entirely rather than being narrowed. anon lost it in
--           20260713193000; the function stays (nothing to drop, no caller).
--        2. Both are open to the PUBLIC key by design (pre-sign-in onboarding
--           and app telemetry) and capped only per call, so a loop could fill
--           the tables for free. A per-session cap is useless — the caller
--           picks the session id — so the cap is per TABLE per (UTC) day,
--           counted on the existing `at` index:
--             telemetry  20,000/day (real peak 533, average ~160)
--             onboarding  5,000/day (real ~7)
--           Over the cap a call quietly records nothing (telemetry returns 0):
--           the app must never break, or retry, because logging is full.
--           Bodies otherwise unchanged from 20260830120000 / 20260824190000
--           (checked against the live definitions first).
-- LINKS: supabase/tests/security_followups_verification.sql;
--        supabase/migrations/20260713193000_plate_available.sql;
--        supabase/migrations/20260830120000_telemetry_sink.sql;
--        supabase/migrations/20260824190000_onboarding_funnel.sql;
--        supabase/migrations/20261023100000_spatial_ref_sys_read_only.sql.
-- =============================================================================

-- 1 — the plate oracle goes. create_post still enforces uniqueness at submit.
revoke execute on function public.plate_available(text) from public, anon, authenticated;

-- 2a — telemetry: a daily cap on the table, then the existing body.
create or replace function public.record_telemetry_events(p_session_id uuid, p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event   jsonb;
  v_written integer := 0;
  v_seen    integer := 0;
  v_room    integer;
begin
  if p_session_id is null then
    raise exception 'INVALID_INPUT';
  end if;

  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'INVALID_INPUT';
  end if;

  -- ⚠️ THE DAILY CAP (2026-10-23). The per-call cap below bounds one call,
  -- not a loop of them; this bounds the day. Quietly: the client must never
  -- fail, or retry, because logging is full.
  v_room := 20000 - (
    select count(*) from public.telemetry_events
     where at >= date_trunc('day', now())
  );
  if v_room <= 0 then
    return 0;
  end if;

  for v_event in select * from jsonb_array_elements(p_events) loop
    v_seen := v_seen + 1;

    -- ⚠️ THE BATCH CAP. Stop rather than raise: the events before the cap are
    -- valid and worth keeping, and a client that overfills a batch is our
    -- bug, not an attack. The day's room is a second stop.
    exit when v_seen > 50 or v_written >= v_room;

    begin
      insert into public.telemetry_events (session_id, event, feature, level, props, platform, app_version)
      values (
        p_session_id,
        v_event ->> 'event',
        v_event ->> 'feature',
        coalesce(v_event ->> 'level', 'info'),
        coalesce(v_event -> 'props', '{}'::jsonb),
        v_event ->> 'platform',
        v_event ->> 'app_version'
      );
      v_written := v_written + 1;
    exception
      when others then
        -- One bad event is dropped; the batch continues. Nothing is logged
        -- here on purpose: a per-event RAISE NOTICE on a spammable endpoint is
        -- its own volume problem.
        null;
    end;
  end loop;

  return v_written;
end $$;

-- 2b — onboarding: the same daily cap, then the existing body.
create or replace function public.record_onboarding_step(
  p_run_id uuid,
  p_step text,
  p_slide smallint default null,
  p_platform text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Refused rather than clamped. There is no user here to lose anything, so
  -- the usual "never discard someone's work over a field they did not choose"
  -- reasoning does not apply — a malformed call is a bug in our own client and
  -- should be loud in development rather than quietly recorded as a fact.
  if p_step is null or p_step not in ('slide_viewed', 'completed', 'skipped') then
    raise exception 'INVALID_INPUT';
  end if;

  if p_run_id is null then
    raise exception 'INVALID_INPUT';
  end if;

  -- ⚠️ THE DAILY CAP (2026-10-23), as telemetry's: quietly full.
  if (select count(*) from public.onboarding_events
       where at >= date_trunc('day', now())) >= 5000 then
    return;
  end if;

  insert into public.onboarding_events (run_id, step, slide, platform)
  values (
    p_run_id,
    p_step,
    case when p_step = 'slide_viewed' then p_slide else null end,
    nullif(btrim(coalesce(p_platform, '')), '')
  )
  on conflict (run_id, step, slide) do nothing;
end;
$$;

-- CREATE OR REPLACE keeps the grants; restated so the file says who may call.
grant execute on function public.record_telemetry_events(uuid, jsonb) to anon, authenticated;
grant execute on function public.record_onboarding_step(uuid, text, smallint, text) to anon, authenticated;
