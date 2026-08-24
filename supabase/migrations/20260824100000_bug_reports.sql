-- =============================================================================
-- WHAT:  The in-app bug report capture path. Adds public.bug_reports (one row
--        per submitted report) and public.submit_bug_report(...) — a SECURITY
--        DEFINER RPC that records the caller's report plus four named pieces of
--        device metadata.
-- WHY:   There was no way for a user to tell us something is broken. The one
--        support affordance is a mailto: to SUPPORT_EMAIL, which is still the
--        placeholder support@trackitdown.example (BUILD_PLAN Phase 5). A table
--        we can query is the honest minimum: durable, attributable, and
--        readable without waiting on an email provider we have not chosen.
--
--        ⚠️ WHAT THIS DELIBERATELY DOES NOT CARRY, and why, because the next
--        person will be tempted to add all three:
--          * NO LOGS. logger.ts keeps a 300-entry ring buffer whose auto-
--            redaction is key-name matching (token|password|secret|…) — there is
--            no lat/lng/plate in that pattern, so coordinate and plate redaction
--            is call-site discipline, not enforcement. Worse, the buffer is
--            mostly bare UUIDs: a postId in a support queue is a durable pointer
--            at a live victim's case, resolvable to an exact coordinate by
--            anyone holding service_role.
--          * NO SCREENSHOTS. ⚠️ SUPERSEDED THE SAME DAY by
--            20260824140000_bug_report_details.sql, at the owner's request.
--            The objection below was NOT answered — it is still true that a
--            screenshot bypasses every redaction helper — it was accepted as a
--            risk against a set of controls: user-picked only (never automatic),
--            previewed full-screen before sending, EXIF stripped by re-encode,
--            and stored in a PRIVATE bucket no client can read. Read that
--            migration's header before touching any of those four.
--            They bypass every redaction helper in the codebase.
--            An owner's sighting-detail screen shows the exact point that
--            SECURITY_AND_TRUST §2 spends forty lines coarsening for everyone
--            else.
--          * NO CURRENT ROUTE. A route can be /post/<id>, which ties a report to
--            one specific stolen car.
--        The bar is startupTrace.ts: "phase names and millisecond durations
--        only — never a coordinate, an id."
-- LINKS: supabase/migrations/20260730110000_post_flags.sql (the template: RLS
--          with no client policies, definer RPC, auth.uid() pinning),
--        supabase/migrations/20260714100000_sightings.sql (the advisory-lock
--          rolling-window rate limit this copies),
--        supabase/migrations/20260802170000_revoke_default_table_privileges.sql
--          (why the revoke below is not optional),
--        src/features/profile/api/bugReportApi.ts (the client caller),
--        docs/LOGGING.md (the privacy rules this design is bounded by).
--
-- SAFETY: bug_reports is operator-only data — RLS ENABLED with NO client
--        policies, so clients can neither read nor write it directly. Writes go
--        ONLY through submit_bug_report (SECURITY DEFINER, bypasses RLS), which
--        pins reporter_id to auth.uid() and is never client-supplied. Reads are
--        service-role only.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: one `revoke all … from anon,
--        authenticated` on the NEW table only. It removes privileges this
--        project's ALTER DEFAULT PRIVILEGES would otherwise hand out silently at
--        CREATE TABLE (including TRUNCATE); it touches no existing table and no
--        data. Nothing else here is destructive.
-- =============================================================================


-- =============================================================================
-- 1. TABLE: bug_reports  (one row per submitted report)
-- =============================================================================
create table public.bug_reports (
  id            uuid primary key default gen_random_uuid(),

  -- The reporter. FK to profiles (house convention for user-owned rows).
  -- ON DELETE CASCADE: GDPR erasure removes their reports, which is also what
  -- keeps the privacy policy's "kept while your account exists" true.
  reporter_id   uuid not null references public.profiles (id) on delete cascade,

  -- What they typed. 2000 to match the chat cap rather than the 500 used for
  -- flag reasons: a flag reason is a category, a bug report is an explanation.
  -- ⚠️ Free text the user wrote. It is never logged and never shown back to any
  -- other user — the same rule that governs message bodies and alert criteria.
  message       text not null check (char_length(message) between 1 and 2000),

  -- The four named diagnostics. Every one of them is displayed on screen before
  -- the user submits, which is the whole design: disclosed, not collected.
  app_version   text check (app_version is null or char_length(app_version) <= 40),
  -- Mirrors push_tokens.platform. Web is not a target, so the CHECK is the same
  -- two values rather than a free string.
  platform      text check (platform is null or platform in ('ios', 'android')),
  os_version    text check (os_version is null or char_length(os_version) <= 40),
  device_model  text check (device_model is null or char_length(device_model) <= 80),

  created_at    timestamptz not null default now()
);

comment on table public.bug_reports is
  'One row per in-app bug report. Written ONLY by submit_bug_report (SECURITY DEFINER) / service role. RLS enabled with NO client policies — never client-readable or writable. Carries the reporter''s free text plus four named device fields (app version, platform, OS version, device model) that are shown to the user before sending. Deliberately carries NO logs, NO screenshot and NO route: see the migration header.';

-- Triage order: the operator reads the queue newest-first.
create index bug_reports_created_at_idx on public.bug_reports (created_at desc);

-- ⚠️ THE RATE LIMIT READS BY REPORTER ON EVERY SUBMISSION. An earlier comment
-- here claimed "nothing reads these by reporter", which was false the moment it
-- was written — submit_bug_report's window count is
-- `where reporter_id = v_uid and created_at > now() - interval '1 hour'`, and
-- with only the created_at index that filters every row written in the last
-- hour. This is the composite that create_sighting's limiter already relies on
-- (sightings_spotter_created_idx), in the migration this one names as its
-- template.
create index bug_reports_reporter_created_idx
  on public.bug_reports (reporter_id, created_at desc);

alter table public.bug_reports enable row level security;

-- SAFETY: this project ships `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO
-- anon, authenticated`, so CREATE TABLE above has ALREADY handed both roles
-- privileges including TRUNCATE and REFERENCES. The per-table grants in a
-- migration ADD to that default, they do not replace it — so the revoke has to
-- come first and be explicit. See 20260802170000_revoke_default_table_privileges.
revoke all on public.bug_reports from anon, authenticated;

-- Operator-only. Clients get NOTHING here: writes go through the definer RPC.
grant select, insert, update, delete on public.bug_reports to service_role;


-- =============================================================================
-- 2. FUNCTION: submit_bug_report(message, app_version, platform, os_version,
--                                device_model)
-- =============================================================================
-- Records the CALLER's bug report. reporter_id is pinned to auth.uid() (never
-- trusted from the client). Requires a signed-in caller.
--
-- ⚠️ SIGNED-IN ONLY MEANS A BUG THAT PREVENTS SIGN-IN CANNOT BE REPORTED HERE.
-- That is accepted rather than overlooked: the row lives in Profile, which
-- hold-and-sheets a guest, so the screen is unreachable signed out anyway — and
-- an anonymous write endpoint on a table nobody rate-limits per-device is a spam
-- target. The escape hatch for a locked-out user is the support address, which
-- is why that row should be fixed rather than replaced.
create or replace function public.submit_bug_report(
  p_message      text,
  p_app_version  text default null,
  p_platform     text default null,
  p_os_version   text default null,
  p_device_model text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_message text := btrim(coalesce(p_message, ''));
  v_recent  integer;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- The client caps and trims too; this is the authority. An empty report is a
  -- mis-tap, not a submission.
  if v_message = '' or char_length(v_message) > 2000 then
    raise exception 'INVALID_INPUT';
  end if;

  -- --- RATE_LIMITED: max 5 per reporter per ROLLING 1h -----------------------
  -- The idiom is create_sighting's: an advisory xact lock serialises a caller's
  -- concurrent submissions so two parallel requests cannot both pass the count
  -- and both insert; it releases at transaction end.
  --
  -- ⚠️ Keyed on the CALLER ALONE, which makes this the schema's first per-account
  -- limiter — every existing one (sightings, messages) is per (user, target),
  -- and a bug report has no target to key on.
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
  -- check violation that the client can only map to its generic fallback — so
  -- the user retries forever and loses the report over a field they did not
  -- type and cannot change. The message is the payload; the diagnostics are
  -- advisory, and a truncated model name still triages.
  --
  -- p_platform is NOT clamped: it has a value CHECK, not a length one, and
  -- coercing a bad platform to one that passes would put a value in the
  -- operator's queue that no device reported.
  --
  -- The third option — `case when p_platform in ('ios','android') then
  -- p_platform else null end` — would satisfy both rules, since absence is not
  -- an invented value. It is not taken only because the case is unreachable
  -- from our own client: readBugDiagnostics types the field as
  -- BugReportPlatform | null, so nothing we ship can send a third value. A
  -- direct caller passing 'web' gets a 23514 and the generic fallback, which is
  -- their own doing rather than a real reporter losing a report. Revisit this
  -- the moment anything else calls the RPC.
  insert into public.bug_reports (
    reporter_id, message, app_version, platform, os_version, device_model
  )
  values (
    v_uid,
    v_message,
    left(nullif(btrim(coalesce(p_app_version, '')), ''), 40),
    nullif(btrim(coalesce(p_platform, '')), ''),
    left(nullif(btrim(coalesce(p_os_version, '')), ''), 40),
    left(nullif(btrim(coalesce(p_device_model, '')), ''), 80)
  );
end;
$$;

comment on function public.submit_bug_report(text, text, text, text, text) is
  'Records the caller''s bug report into bug_reports. SECURITY DEFINER; reporter_id pinned to auth.uid() (never client-supplied). Raises NOT_AUTHENTICATED for a guest, INVALID_INPUT for an empty or over-long message, and RATE_LIMITED above 5 reports per rolling hour. Grants: authenticated + service_role only.';

-- SAFETY: functions default to EXECUTE granted to PUBLIC, and this project also
-- auto-grants anon at CREATE time (see 20260713190000_post_a_car.sql). Reporting
-- requires an account, so revoke public + anon and grant only authenticated.
revoke execute on function public.submit_bug_report(text, text, text, text, text)
  from public, anon;
grant execute on function public.submit_bug_report(text, text, text, text, text)
  to authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
