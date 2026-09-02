-- =============================================================================
-- WHAT:  public.sweep_runs — one row per completed run of the hourly sweep,
--        with what it did — plus record_sweep_run() to write it and
--        sweep_health() to answer "is it still running?" in one call.
-- WHY:   ⚠️ THE SWEEP HAS QUIETLY BECOME LOAD-BEARING FOR THINGS THAT ARE NOT
--        MONEY, AND NOTHING WATCHES IT. `release-held-refunds` began as the
--        refund/payout sweep. As of 2026-09-01 it also runs:
--
--          * purge_old_notifications           (retention)
--          * purge_sighting_location_history   (a PUBLISHED privacy promise —
--            "location history is deleted after 90 days", now on the website)
--          * claim/forget_orphaned_photos      (UK GDPR ERASURE — the JPEGs a
--            deleted car leaves behind)
--
--        If it stops firing, all three stop SILENTLY. Nothing raises, nothing
--        is logged where anybody looks, and the first symptom is a subject
--        access request we cannot honour or a retention claim we cannot
--        support. The whole-app review called out "no monitoring, alerting,
--        tested backups or incident procedure"; this closes the narrowest and
--        most urgent part of it — knowing whether the one scheduled process in
--        the system ran.
--
--        ⚠️ THIS DOES NOT ALERT ANYBODY. It makes an invisible failure a
--        VISIBLE one: `sweep_health()` answers the question in a single call,
--        and OPERATIONS.md §7 shows how to ask. Turning that into a page or an
--        email is an ops decision that needs somewhere to send it, and a
--        dashboard nobody has built yet is not a better place for this data
--        than a table you can query today.
--
-- ⚠️ WRITTEN AT THE END OF THE RUN, ON PURPOSE. A row here means the sweep got
--        all the way through, which is the property worth knowing. A row
--        written at the start would prove only that it was invoked — and an
--        invocation that dies half way is precisely the failure that would
--        leave retention half-done while looking healthy.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. One new table, three functions.
--        No existing object is touched. The table is bounded by its own
--        retention below rather than growing forever.
--
-- LINKS: supabase/functions/release-held-refunds/index.ts (the only writer);
--        supabase/migrations/20260901140000_purge_sighting_location_history.sql
--          and 20260901160000_orphaned_photo_queue.sql (two of the jobs whose
--          silence this makes audible);
--        docs/OPERATIONS.md §7; supabase/tests/sweep_runs_verification.sql.
-- =============================================================================


-- =============================================================================
-- 1. TABLE: sweep_runs
-- =============================================================================
create table public.sweep_runs (
  id         bigserial primary key,
  ran_at     timestamptz not null default now(),
  -- The sweep's own summary object, stored as it was returned rather than
  -- unpacked into columns. These counters change as jobs are added to the
  -- sweep — three arrived in one day — and a column per counter would mean a
  -- migration every time, which is how a monitoring table stops being updated.
  summary    jsonb not null default '{}'::jsonb
    constraint sweep_runs_summary_object_chk check (jsonb_typeof(summary) = 'object')
);

comment on table public.sweep_runs is
  'One row per COMPLETED run of release-held-refunds, with the counters it returned. Written last, so a row proves the run finished rather than merely started. Read by sweep_health() and by OPERATIONS.md §7; no client has any grant.';

-- The only query anyone runs against this: the most recent row.
create index sweep_runs_ran_at_idx on public.sweep_runs (ran_at desc);

alter table public.sweep_runs enable row level security;

-- RLS ENABLED WITH NO CLIENT POLICIES. Operational data about the platform's
-- own machinery is nobody's business but ours.
--
-- SAFETY: ALTER DEFAULT PRIVILEGES has already handed anon and authenticated
-- privileges including TRUNCATE at CREATE TABLE (20260901130000), so the revoke
-- must be explicit and first. anon_role_verification CHECK 13 enforces it.
revoke all on public.sweep_runs from anon, authenticated;

grant select, insert, update, delete on public.sweep_runs to service_role;


-- =============================================================================
-- 2. record_sweep_run — called last, by the sweep
-- =============================================================================
create or replace function public.record_sweep_run(p_summary jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.sweep_runs (summary)
  values (case when jsonb_typeof(p_summary) = 'object' then p_summary else '{}'::jsonb end);

  -- ⚠️ TRIMMED HERE RATHER THAN BY A SEPARATE PURGE. This table's whole purpose
  -- is to answer "did the scheduler run", so making it depend on ANOTHER
  -- scheduled job to stay bounded would be circular: if the sweep stops, the
  -- purge stops, and the table that was supposed to tell you sits unchanged and
  -- unbounded. 90 days of hourly runs is ~2,200 rows.
  delete from public.sweep_runs where ran_at < now() - interval '90 days';
end $$;

comment on function public.record_sweep_run(jsonb) is
  'Records one COMPLETED sweep run and trims rows older than 90 days. Self-trimming on purpose: a table that exists to prove the scheduler ran must not depend on the scheduler to stay bounded. A non-object summary is stored as {} rather than rejected — a monitoring write must never be the thing that fails a run.';

revoke execute on function public.record_sweep_run(jsonb) from public, anon, authenticated;
grant execute on function public.record_sweep_run(jsonb) to service_role;


-- =============================================================================
-- 3. sweep_health — the one call that answers the question
-- =============================================================================
-- ⚠️ THE THRESHOLD IS 3 HOURS FOR AN HOURLY JOB, not 1. A single missed run is
-- ordinary — a deploy, a cold start, a Stripe timeout — and a check that cries
-- wolf on those teaches everyone to ignore it, which is exactly how the SQL
-- suites came to sit red for a month. Three consecutive misses is a fault.
create or replace function public.sweep_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_last    timestamptz;
  v_summary jsonb;
begin
  select ran_at, summary into v_last, v_summary
    from public.sweep_runs
   order by ran_at desc
   limit 1;

  return jsonb_build_object(
    -- NULL means it has never completed a run since this table existed, which
    -- reads very differently from "ran a while ago" and must not be collapsed
    -- into it.
    'last_run_at',   v_last,
    'age_minutes',   case when v_last is null then null
                          else floor(extract(epoch from (now() - v_last)) / 60)::int end,
    'healthy',       v_last is not null and v_last > now() - interval '3 hours',
    'last_summary',  coalesce(v_summary, '{}'::jsonb)
  );
end $$;

comment on function public.sweep_health() is
  'One call answering "is the hourly sweep still running": last completed run, its age in minutes, a healthy flag (false past 3 hours — three misses, not one, so it does not cry wolf), and the counters from that run. NULL last_run_at means it has never completed one.';

revoke execute on function public.sweep_health() from public, anon, authenticated;
grant execute on function public.sweep_health() to service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
