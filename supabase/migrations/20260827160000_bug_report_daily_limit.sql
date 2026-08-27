-- =============================================================================
-- WHAT:  Bug reports move from 5 per rolling HOUR to 3 per rolling 24 HOURS,
--        in submit_bug_report (the authority) and bug_report_quota_remaining
--        (the courtesy probe) together.
-- WHY:   Owner request, 2026-08-27, once reports started reaching an inbox.
--        The old ceiling allowed 5 an hour — up to 120 a day from one account —
--        which was fine while these landed in a table nobody watched and is not
--        fine now that each one is an email.
--
--        ⚠️ THREE, NOT ONE, AND THAT IS THE PRODUCT DECISION. One a day was
--        asked about and deliberately not taken: this flow is built around
--        someone annoyed who is doing us a favour, and a person who hits two
--        separate bugs in one sitting would have been refused the second. They
--        do not come back tomorrow to file it — they have moved on, and the
--        report is lost. Three still ends inbox flooding (a ~40x cut) while
--        leaving a real bug session reportable.
--
--        ⚠️ BOTH FUNCTIONS OR NEITHER. The probe exists so a rate-limited
--        reporter is told BEFORE three screenshots upload. If only one of these
--        moved, the probe would either wave someone through to a refusal after
--        the upload, or refuse someone the RPC would have accepted. They are
--        one rule in two places and must change together.
-- LINKS: supabase/tests/bug_reports_verification.sql (CHECK 4 pins the ceiling);
--        src/features/profile/api/bugReportApi.ts (the copy that names it);
--        supabase/migrations/20260827120000_bug_report_email_by_id.sql (the
--          body reproduced below, unchanged apart from the window and count).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The authority.
-- -----------------------------------------------------------------------------
-- ⚠️ `create or replace`, and the signature is UNTOUCHED, so grants survive and
-- no drop is needed. The body below is verbatim from 20260827120000 except for
-- the two values in the rate-limit block — every guard, the advisory lock, the
-- clamping and all of their reasoning are carried across intact.
create or replace function public.submit_bug_report(
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

  -- --- RATE_LIMITED: max 3 per reporter per ROLLING 24h ----------------------
  -- Unchanged: create_sighting's advisory-lock idiom, keyed on the caller
  -- alone. The lock serialises one caller's concurrent submissions so two
  -- parallel requests cannot both pass the count; it releases at transaction
  -- end.
  perform pg_advisory_xact_lock(
    hashtextextended('submit_bug_report:' || v_uid::text, 0));

  select count(*) into v_recent
  from public.bug_reports b
  where b.reporter_id = v_uid
    and b.created_at > now() - interval '24 hours';

  if v_recent >= 3 then
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
  'Records the caller''s bug report into bug_reports and RETURNS its id, which the client passes to notify-bug-report so the operator is emailed the report that was actually just filed. SECURITY DEFINER; reporter_id pinned to auth.uid() (never client-supplied). Verifies every screenshot path lives under the caller''s own folder. Raises NOT_AUTHENTICATED for a guest, INVALID_INPUT for an empty/over-long message, an over-long expected, or a foreign/over-long screenshot path, and RATE_LIMITED above 3 reports per rolling 24 hours. Grants: authenticated + service_role only.';


-- -----------------------------------------------------------------------------
-- 2. The courtesy probe, moved in lockstep.
-- -----------------------------------------------------------------------------
-- ⚠️ THIS IS A COURTESY, NOT A CONTROL — unchanged from 20260824140000, and
-- worth restating because the numbers now live in two places. submit_bug_report
-- remains the only authority. This exists because screenshots upload BEFORE the
-- report is submitted, and being told to come back tomorrow only after three
-- images have finished uploading is a bad enough experience to be worth one
-- extra round trip. Never gate on this alone: it is stale the moment it returns.
create or replace function public.bug_report_quota_remaining()
returns integer
language plpgsql
security definer
stable
set search_path = ''
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_recent integer;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select count(*) into v_recent
  from public.bug_reports b
  where b.reporter_id = v_uid
    and b.created_at > now() - interval '24 hours';

  return greatest(0, 3 - v_recent);
end;
$fn$;

comment on function public.bug_report_quota_remaining() is
  'Reports the caller may still file in this rolling 24 hours (0-3). Advisory only — submit_bug_report enforces the limit. Exists so a rate-limited reporter is told before uploading screenshots, not after.';

-- `create or replace` keeps grants, but re-asserted: this reads one caller's own
-- report count and must stay reachable by a signed-in user, never by a guest.
revoke execute on function public.bug_report_quota_remaining() from public, anon;
grant execute on function public.bug_report_quota_remaining() to authenticated, service_role;
