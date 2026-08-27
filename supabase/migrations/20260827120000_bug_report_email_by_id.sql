-- =============================================================================
-- WHAT:  Makes the emailed report the one that was just filed — submit_bug_report
--        returns the new row's id, and claim_bug_report_email takes that id
--        instead of guessing by age.
-- WHY:   ⚠️ THE OPERATOR WAS EMAILED THE WRONG REPORT, and this is the fix for
--        a real incident on 2026-08-27, an hour after the email path shipped.
--
--        The first design could not know WHICH report the client had just
--        written, because submit_bug_report returned void. So it claimed the
--        OLDEST unsent report for that reporter and hoped the two were the
--        same. They were not: two reports filed at 10:23 were still unsent when
--        the feature deployed at 11:34, so the report filed at 11:36:43 emailed
--        the 10:23 one, and the report filed at 11:37:59 emailed the 10:23:51
--        one. Every email lagged one behind, and would have kept lagging
--        forever — one missed dispatch offsets every report after it
--        PERMANENTLY, because the backlog never shrinks back.
--
--        Guessing was the bug. The id is now carried end to end: the RPC hands
--        it to the client, the client hands it to the Edge Function, and the
--        claim serves that row or nothing. There is no ordering left to be
--        wrong about.
--
--        ⚠️ OWNERSHIP IS STILL CHECKED HERE, and now it matters more: an id
--        that arrives from a client is an id a patched client could invent. The
--        claim serves the row only when reporter_id = p_actor, so a forged id
--        returns the same {"claimed": false} as a missing one and is not an
--        oracle for whether it exists.
-- LINKS: supabase/functions/notify-bug-report/index.ts (passes the id);
--        src/features/profile/api/bugReportApi.ts (returns it);
--        supabase/migrations/20260827100000_bug_report_email.sql (the version
--          this replaces); 20260824140000_bug_report_details.sql (the body of
--          submit_bug_report, unchanged below except for the return).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Drain the backlog that caused the incident.
-- -----------------------------------------------------------------------------
-- Everything unsent right now either predates the email path or was passed over
-- by it. Nothing will ever come along to send these — the claim is by id from
-- here on, and no client holds their ids any more. Marking them sent stops them
-- sitting in the table looking pending forever. They are readable in full in
-- bug_reports; nothing is lost but the notification.
update public.bug_reports
   set emailed_at = now()
 where emailed_at is null;


-- -----------------------------------------------------------------------------
-- 2. submit_bug_report now returns the id of the row it wrote.
-- -----------------------------------------------------------------------------
-- ⚠️ DROP, NOT REPLACE. `create or replace function` cannot change a return
-- type, so this is the one safe way to do it. The BODY BELOW IS UNCHANGED from
-- 20260824140000 — every guard, the advisory lock, the clamping and all of
-- their reasoning are copied verbatim; the only edits are `returns uuid`, the
-- `v_id` declaration, `returning id into v_id`, and `return v_id`.
--
-- Returning the id is not a widening of what the client may see: it is the id
-- of a row that client just wrote, and bug_reports still has no client select
-- policy, so the id opens nothing.
drop function if exists public.submit_bug_report(
  text, text, text, text, text, text, text, text, text, text[], text[]);

create function public.submit_bug_report(
  p_message          text,
  p_app_version      text default null,
  p_platform         text default null,
  p_os_version       text default null,
  p_device_model     text default null,
  p_area             text default null,
  p_severity         text default null,
  p_frequency        text default null,
  p_expected         text default null,
  p_breadcrumbs      text[] default null,
  p_screenshot_paths text[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_message  text := btrim(coalesce(p_message, ''));
  v_expected text := nullif(btrim(coalesce(p_expected, '')), '');
  v_recent   integer;
  v_path     text;
  v_id       uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- The client caps and trims too; this is the authority. An empty report is a
  -- mis-tap, not a submission.
  if v_message = '' or char_length(v_message) > 2000 then
    raise exception 'INVALID_INPUT';
  end if;

  if v_expected is not null and char_length(v_expected) > 2000 then
    raise exception 'INVALID_INPUT';
  end if;

  -- SAFETY: every screenshot path must live under the CALLER's own folder.
  -- The storage policy already stops them WRITING elsewhere, but nothing stops
  -- them naming someone else's existing path here — which would attach another
  -- user's private upload to their own report and surface it in the operator's
  -- queue under the wrong name. Checked here because a CHECK constraint cannot
  -- see auth.uid().
  if p_screenshot_paths is not null then
    if coalesce(array_length(p_screenshot_paths, 1), 0) > 3 then
      raise exception 'INVALID_INPUT';
    end if;
    foreach v_path in array p_screenshot_paths loop
      if v_path is null or v_path not like (v_uid::text || '/%') then
        raise exception 'INVALID_INPUT';
      end if;
    end loop;
  end if;

  -- --- RATE_LIMITED: max 5 per reporter per ROLLING 1h -----------------------
  -- Unchanged: create_sighting's advisory-lock idiom, keyed on the caller
  -- alone. The lock serialises one caller's concurrent submissions so two
  -- parallel requests cannot both pass the count; it releases at transaction
  -- end.
  perform pg_advisory_xact_lock(
    hashtextextended('submit_bug_report:' || v_uid::text, 0));

  select count(*) into v_recent
  from public.bug_reports b
  where b.reporter_id = v_uid
    and b.created_at > now() - interval '1 hour';

  if v_recent >= 5 then
    raise exception 'RATE_LIMITED';
  end if;

  -- ⚠️ THE DIAGNOSTICS ARE CLAMPED, NOT VALIDATED. The columns CHECK 40/40/80
  -- characters, and an over-long Device.modelName would otherwise raise a raw
  -- check violation the client can only map to its generic fallback — so the
  -- user retries forever and loses the report over a field they did not type
  -- and cannot change. The message is the payload; the diagnostics are
  -- advisory. Same reasoning now covers `expected`, which IS the user's own
  -- text and so is length-CHECKED above rather than silently truncated.
  --
  -- area / severity / frequency are NOT clamped: they carry value CHECKs, not
  -- length ones, and coercing an unrecognised value to a passing one would put
  -- a fact in the operator's queue that the reporter never chose. Unreachable
  -- from our own client, which types all three as closed unions.
  insert into public.bug_reports (
    reporter_id, message, app_version, platform, os_version, device_model,
    area, severity, frequency, expected, breadcrumbs, screenshot_paths
  )
  values (
    v_uid,
    v_message,
    left(nullif(btrim(coalesce(p_app_version, '')), ''), 40),
    nullif(btrim(coalesce(p_platform, '')), ''),
    left(nullif(btrim(coalesce(p_os_version, '')), ''), 40),
    left(nullif(btrim(coalesce(p_device_model, '')), ''), 80),
    nullif(btrim(coalesce(p_area, '')), ''),
    nullif(btrim(coalesce(p_severity, '')), ''),
    nullif(btrim(coalesce(p_frequency, '')), ''),
    v_expected,
    p_breadcrumbs,
    p_screenshot_paths
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.submit_bug_report(text, text, text, text, text, text, text, text, text, text[], text[]) is
  'Records the caller''s bug report into bug_reports and RETURNS its id, which the client passes to notify-bug-report so the operator is emailed the report that was actually just filed. SECURITY DEFINER; reporter_id pinned to auth.uid() (never client-supplied). Verifies every screenshot path lives under the caller''s own folder. Raises NOT_AUTHENTICATED for a guest, INVALID_INPUT for an empty/over-long message, an over-long expected, or a foreign/over-long screenshot path, and RATE_LIMITED above 5 reports per rolling hour. Grants: authenticated + service_role only.';

-- SAFETY: functions default to EXECUTE granted to PUBLIC, and dropping the
-- function dropped its grants with it. Restored exactly as 20260824100000 set
-- them: a signed-in reporter and the service role, nobody else. A guest is
-- refused inside the function too, but the grant is the outer wall.
revoke all on function public.submit_bug_report(
  text, text, text, text, text, text, text, text, text, text[], text[]) from public;
revoke all on function public.submit_bug_report(
  text, text, text, text, text, text, text, text, text, text[], text[]) from anon;
grant execute on function public.submit_bug_report(
  text, text, text, text, text, text, text, text, text, text[], text[]) to authenticated;
grant execute on function public.submit_bug_report(
  text, text, text, text, text, text, text, text, text, text[], text[]) to service_role;


-- -----------------------------------------------------------------------------
-- 3. The claim takes an id.
-- -----------------------------------------------------------------------------
drop function if exists public.claim_bug_report_email(uuid);

create function public.claim_bug_report_email(p_actor uuid, p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_report public.bug_reports;
begin
  if p_actor is null or p_report_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- ⚠️ STILL ONE STATEMENT, and still SKIP LOCKED. The id removes the ordering
  -- guess, not the race: two dispatches for the same report (a retried invoke)
  -- must not both send. The row lock plus `emailed_at is null` is what makes
  -- the second one a no-op.
  --
  -- ⚠️ AND STILL SCOPED TO THE ACTOR. The id now arrives from a client, so it
  -- is exactly the kind of value a patched client could invent. Serving only
  -- rows whose reporter_id is the actor means a forged id gets the same
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

  -- The report's own content. The screenshot PATHS travel, never URLs: the
  -- bucket is private and has no client read path, so the sender signs them
  -- with the service role and gives the operator a link that expires.
  return jsonb_build_object(
    'claimed',          true,
    'id',               v_report.id,
    'created_at',       v_report.created_at,
    'message',          v_report.message,
    'expected',         v_report.expected,
    'area',             v_report.area,
    'severity',         v_report.severity,
    'frequency',        v_report.frequency,
    'app_version',      v_report.app_version,
    'platform',         v_report.platform,
    'os_version',       v_report.os_version,
    'device_model',     v_report.device_model,
    'breadcrumbs',      v_report.breadcrumbs,
    'screenshot_paths', v_report.screenshot_paths
  );
end;
$fn$;

comment on function public.claim_bug_report_email(uuid, uuid) is
  'Claims the report p_report_id for emailing and returns its content, stamping emailed_at so it is never sent twice. SECURITY DEFINER; serves the row ONLY when its reporter_id is p_actor, so a forged id from a client-invoked sender reaches nothing. Returns {"claimed": false} for a foreign, missing or already-sent id alike. Grants: service_role only.';

-- SAFETY: as before — this returns the full text of a bug report out of a table
-- with no client select policy, so only the service role inside the Edge
-- Function may call it.
revoke all on function public.claim_bug_report_email(uuid, uuid) from public;
revoke all on function public.claim_bug_report_email(uuid, uuid) from anon;
revoke all on function public.claim_bug_report_email(uuid, uuid) from authenticated;
grant execute on function public.claim_bug_report_email(uuid, uuid) to service_role;

-- The unsent-report index existed to support the oldest-first scan, which no
-- longer happens: the claim is now a primary-key lookup with two extra
-- predicates. Dropped rather than left as a cost on every insert.
drop index if exists public.bug_reports_unsent_idx;
