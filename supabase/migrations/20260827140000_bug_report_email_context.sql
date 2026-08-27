-- =============================================================================
-- WHAT:  Adds the reporter and their history to what claim_bug_report_email
--        hands the sender: reporter_id, how many reports they have filed
--        before, and when the last one was.
-- WHY:   The email could not say WHO sent the report (owner request,
--        2026-08-27). The disclosure panel has always told the reporter their
--        account travels "so we can reply", and the operator had no way to
--        reply — no id, no address, nothing to look them up by. That is the
--        gap this closes.
--
--        ⚠️ THE ADDRESS IS NOT READ HERE. This returns the reporter's UUID and
--        the Edge Function resolves it through the auth admin API. Reading
--        auth.users from a SECURITY DEFINER function in `public` would put a
--        path to every user's email address behind a function whose whole job
--        is bug reports — a much wider door than the one thing needed. The
--        admin API is already service-role-only and is the intended route.
--
--        ⚠️ THE HISTORY IS COUNTS AND A DATE, NEVER TEXT. `prior_reports` and
--        `previous_report_at` tell an operator "this is their fourth report
--        this week" without putting three other reports' contents into an
--        email about this one. Each report is emailed once, on its own.
-- LINKS: supabase/functions/notify-bug-report/index.ts (resolves the address);
--        supabase/migrations/20260827120000_bug_report_email_by_id.sql (the
--          version this replaces).
-- =============================================================================

create or replace function public.claim_bug_report_email(p_actor uuid, p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_report   public.bug_reports;
  v_prior    integer;
  v_previous timestamptz;
begin
  if p_actor is null or p_report_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- ⚠️ STILL ONE STATEMENT, and still SKIP LOCKED. The id removes the ordering
  -- guess, not the race: two dispatches for the same report (a retried invoke)
  -- must not both send. The row lock plus `emailed_at is null` is what makes
  -- the second one a no-op.
  --
  -- ⚠️ AND STILL SCOPED TO THE ACTOR. The id arrives from a client, so it is
  -- exactly the kind of value a patched client could invent. Serving only rows
  -- whose reporter_id is the actor means a forged id gets the same
  -- {"claimed": false} as a missing one — no oracle, no other reporter's text.
  update public.bug_reports b
     set emailed_at = now()
   where b.id = (
           select c.id
             from public.bug_reports c
            where c.id = p_report_id
              and c.reporter_id = p_actor
              and c.emailed_at is null
              for update skip locked
         )
  returning b.* into v_report;

  if v_report.id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- Repeat-reporter context. Counted AFTER the claim and excluding this row, so
  -- "0 prior" means genuinely their first. Bounded to this reporter — a global
  -- count would leak how busy the queue is to nobody's benefit.
  select count(*), max(b.created_at)
    into v_prior, v_previous
  from public.bug_reports b
  where b.reporter_id = v_report.reporter_id
    and b.id <> v_report.id;

  return jsonb_build_object(
    'claimed',            true,
    'id',                 v_report.id,
    -- The UUID only. The Edge Function turns this into an address.
    'reporter_id',        v_report.reporter_id,
    'prior_reports',      v_prior,
    'previous_report_at', v_previous,
    'created_at',         v_report.created_at,
    'message',            v_report.message,
    'expected',           v_report.expected,
    'area',               v_report.area,
    'severity',           v_report.severity,
    'frequency',          v_report.frequency,
    'app_version',        v_report.app_version,
    'platform',           v_report.platform,
    'os_version',         v_report.os_version,
    'device_model',       v_report.device_model,
    'breadcrumbs',        v_report.breadcrumbs,
    'screenshot_paths',   v_report.screenshot_paths
  );
end;
$fn$;

comment on function public.claim_bug_report_email(uuid, uuid) is
  'Claims the report p_report_id for emailing and returns its content plus the reporter''s id and how many reports they have filed before, stamping emailed_at so it is never sent twice. SECURITY DEFINER; serves the row ONLY when its reporter_id is p_actor, so a forged id from a client-invoked sender reaches nothing. Returns {"claimed": false} for a foreign, missing or already-sent id alike. Never reads auth.users — the sender resolves the address through the admin API. Grants: service_role only.';

-- SAFETY: `create or replace` KEEPS existing grants, so the service-role-only
-- position set by 20260827100000 and re-set by 20260827120000 still stands.
-- Re-asserted here anyway: this returns the full text of a bug report out of a
-- table with no client select policy, and a future replace that forgets is one
-- careless edit away from handing it to every signed-in user.
revoke all on function public.claim_bug_report_email(uuid, uuid) from public;
revoke all on function public.claim_bug_report_email(uuid, uuid) from anon;
revoke all on function public.claim_bug_report_email(uuid, uuid) from authenticated;
grant execute on function public.claim_bug_report_email(uuid, uuid) to service_role;
