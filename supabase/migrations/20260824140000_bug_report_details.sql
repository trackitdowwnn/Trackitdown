-- =============================================================================
-- WHAT:  Widens the bug reporter from "free text + four device facts" to a
--        triageable report: which area of the app, how bad, how often, what was
--        expected, an event-name breadcrumb trail, and up to three screenshots
--        in a PRIVATE bucket. Adds public.bug_screenshots storage, six columns
--        on public.bug_reports, a quota probe, and a replacement RPC.
-- WHY:   The first cut deliberately carried the minimum, and the owner has now
--        asked for the fuller form (2026-08-24). Every addition below was
--        chosen so that MORE USEFUL did not mean MORE DANGEROUS — the three
--        rejections in the original header stand, and two of them are answered
--        here rather than reversed:
--
--          * THE ROUTE is still not captured. `p_area` is a fixed vocabulary of
--            ten app AREAS, so a report can say "posting a car" without ever
--            saying WHICH car. That was the whole objection to /post/<id>, and
--            a closed enum cannot carry an id.
--          * LOGS arrive as EVENT NAMES ONLY. The client sends
--            'feed_mounted' / 'sighting_submit_failed' and drops every data
--            payload, because that payload is where the bare UUIDs live and
--            logger.ts's redaction is key-name matching with no lat/lng/plate
--            in the pattern. A breadcrumb trail with no ids is the useful half.
--          * SCREENSHOTS are now allowed, and this is the real change of mind.
--            They are user-picked (never auto-captured), previewed before
--            sending, re-encoded client-side so source EXIF/GPS is dropped, and
--            they land in a PRIVATE bucket with no client read at all. The
--            screen warns that a screenshot can show an address or a plate.
--            ⚠️ THIS REMAINS THE MOST DANGEROUS THING THE APP COLLECTS. An
--            owner's sighting-detail screen shows the exact point that
--            SECURITY_AND_TRUST §2 spends forty lines coarsening for everyone
--            else, and no redaction helper can reach inside a PNG. It is
--            defensible only because the user chose the image and could see it.
-- LINKS: supabase/migrations/20260824100000_bug_reports.sql (the table this
--          widens, and the reasoning it inherits),
--        supabase/migrations/20260713190000_post_a_car.sql (the PRIVATE
--          'verification-documents' bucket this copies exactly),
--        src/features/profile/lib/bugReportOptions.ts (the same vocabulary,
--          client side — the two must not drift),
--        src/shared/api/photoUpload.ts (the re-encode that drops EXIF).
--
-- SAFETY: bug_screenshots is a PRIVATE bucket (public = false). Clients may
--        INSERT under their OWN folder only and hold NO select — there is no
--        client read path, and no public URL exists to leak. Reads are
--        service-role, i.e. the operator's queue.
--
-- SAFETY: submit_bug_report VERIFIES every screenshot path begins with the
--        caller's own auth.uid(). A path is the one field here a client could
--        use to point the operator's queue at somebody else's upload, so it is
--        checked server-side rather than trusted.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: one `drop function
--        public.submit_bug_report(text,text,text,text,text)`. The five-argument
--        form is REPLACED, not removed — adding parameters with defaults would
--        otherwise leave a second overload and make every call ambiguous. No
--        table, no policy and no row is dropped. The alters below are all
--        ADD COLUMN with defaults of null, so no existing row changes.
-- =============================================================================


-- =============================================================================
-- 1. STORAGE: 'bug-screenshots' — PRIVATE bucket
-- =============================================================================
-- Mirrors 'verification-documents' (20260713190000) rather than 'post-photos':
-- there is no public delivery path for these and there must never be one.
-- 5 MB and images only — no PDF, because nothing about a bug report needs a
-- document, and a narrower MIME list is a smaller abuse surface.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bug-screenshots', 'bug-screenshots', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- SAFETY: storage.objects has RLS enabled by Supabase with no default policies,
-- so this bucket is deny-by-default until the policy below. The policy is
-- scoped to this single bucket_id and loosens nothing else.

-- SAFETY: a signed-in user may UPLOAD only under their OWN folder — the object
-- path must start with '<their auth.uid()>/'. Without this, one reporter could
-- plant an image in another's folder and have it surface in the operator's
-- queue attributed to them.
create policy "bug_screenshots_insert_own_folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'bug-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- SAFETY: DELIBERATELY NO SELECT, UPDATE OR DELETE POLICY FOR ANY CLIENT ROLE.
-- No read: the bucket is private, so there is no URL path either, and denying
-- SELECT also denies the Storage LIST api that would otherwise let a signed-in
-- user enumerate folders. No delete: a reporter must not be able to remove
-- evidence of a report after filing it. The operator reads and clears these
-- with the service role.


-- =============================================================================
-- 2. COLUMNS
-- =============================================================================
alter table public.bug_reports
  -- Which AREA of the app, from a closed vocabulary. ⚠️ Deliberately NOT a
  -- route: 'posting' says what broke without saying which car it broke on.
  -- Mirrored in src/features/profile/lib/bugReportOptions.ts.
  add column area text
    check (area is null or area in (
      'explore', 'watchlist', 'messages', 'my_cars', 'posting',
      'sightings', 'payments', 'alerts', 'account', 'other'
    )),

  -- How much it cost them. The single most useful triage signal, and the one
  -- that should sort the queue.
  add column severity text
    check (severity is null or severity in ('annoying', 'blocked', 'lost')),

  -- Whether it is worth trying to reproduce before reading further.
  add column frequency text
    check (frequency is null or frequency in ('always', 'sometimes', 'once')),

  -- What they expected instead. Same cap and the same rules as `message`:
  -- ⚠️ free text the user wrote, never logged, never shown to another user.
  add column expected text
    check (expected is null or char_length(expected) between 1 and 2000),

  -- ⚠️ EVENT NAMES ONLY — no data payloads, no ids. Stored as text[] rather
  -- than jsonb because there is nothing structured left once the payload is
  -- gone, and a flat array cannot quietly regrow a nested object later.
  -- Bounded by total characters, not just element count: a CHECK cannot hold a
  -- subquery, so array_to_string is how the per-entry length is contained.
  add column breadcrumbs text[]
    check (
      breadcrumbs is null
      or (coalesce(array_length(breadcrumbs, 1), 0) <= 50
          and char_length(array_to_string(breadcrumbs, ',')) <= 4000)
    ),

  -- Object paths inside the PRIVATE bug-screenshots bucket. Paths, never URLs:
  -- a URL implies something fetchable, and nothing here is.
  -- ⚠️ Ownership of each path is enforced in submit_bug_report, not here — a
  -- CHECK cannot see auth.uid().
  add column screenshot_paths text[]
    check (
      screenshot_paths is null
      or (coalesce(array_length(screenshot_paths, 1), 0) <= 3
          and char_length(array_to_string(screenshot_paths, ',')) <= 1000)
    );

comment on column public.bug_reports.area is
  'Which area of the app the report is about, from a closed ten-value vocabulary. Deliberately NOT a route — it must be impossible for this to identify a specific post, sighting or thread.';
comment on column public.bug_reports.breadcrumbs is
  'Recent log EVENT NAMES only (e.g. ''sighting_submit_failed''), newest last. Data payloads are dropped client-side because that is where the bare UUIDs live.';
comment on column public.bug_reports.screenshot_paths is
  'Object paths in the PRIVATE bug-screenshots bucket. Service-role read only; no client select policy exists. Each path is verified to start with the reporter''s own auth.uid() by submit_bug_report.';


-- =============================================================================
-- 3. FUNCTION: bug_report_quota_remaining()
-- =============================================================================
-- How many reports the caller may still file this hour. Read-only.
--
-- ⚠️ THIS IS A COURTESY, NOT A CONTROL. submit_bug_report remains the only
-- authority on the limit. It exists because screenshots upload BEFORE the
-- report is submitted, and being told "come back in an hour" only after three
-- images have finished uploading is a bad enough experience to be worth one
-- extra round trip. Never gate on this alone: it is stale the moment it
-- returns.
create or replace function public.bug_report_quota_remaining()
returns integer
language plpgsql
security definer
stable
set search_path = ''
as $$
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
    and b.created_at > now() - interval '1 hour';

  return greatest(0, 5 - v_recent);
end;
$$;

comment on function public.bug_report_quota_remaining() is
  'Reports the caller may still file this rolling hour (0-5). Advisory only — submit_bug_report enforces the limit. Exists so a rate-limited reporter is told before uploading screenshots, not after.';

revoke execute on function public.bug_report_quota_remaining() from public, anon;
grant execute on function public.bug_report_quota_remaining() to authenticated, service_role;


-- =============================================================================
-- 4. FUNCTION: submit_bug_report(...)  — replaces the five-argument form
-- =============================================================================
-- SAFETY: dropped rather than overloaded. Adding parameters with defaults to
-- the existing function would leave BOTH signatures resolvable and make a
-- five-argument call ambiguous; PostgREST would pick by name, which is not a
-- property worth depending on.
drop function if exists public.submit_bug_report(text, text, text, text, text);

-- Records the CALLER's bug report. reporter_id is pinned to auth.uid() (never
-- trusted from the client). Requires a signed-in caller.
--
-- ⚠️ SIGNED-IN ONLY MEANS A BUG THAT PREVENTS SIGN-IN CANNOT BE REPORTED HERE.
-- Unchanged from the original, and still accepted for the same reason: the row
-- lives in Profile, which hold-and-sheets a guest, and an anonymous write
-- endpoint nobody can rate-limit per-device is a spam target. The escape hatch
-- is the support address, which is why that row should be fixed not replaced.
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
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_message  text := btrim(coalesce(p_message, ''));
  v_expected text := nullif(btrim(coalesce(p_expected, '')), '');
  v_recent   integer;
  v_path     text;
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
  );
end;
$$;

comment on function public.submit_bug_report(text, text, text, text, text, text, text, text, text, text[], text[]) is
  'Records the caller''s bug report into bug_reports. SECURITY DEFINER; reporter_id pinned to auth.uid() (never client-supplied). Verifies every screenshot path lives under the caller''s own folder. Raises NOT_AUTHENTICATED for a guest, INVALID_INPUT for an empty/over-long message, an over-long expected, or a foreign/over-long screenshot path, and RATE_LIMITED above 5 reports per rolling hour. Grants: authenticated + service_role only.';

-- SAFETY: functions default to EXECUTE granted to PUBLIC, and this project also
-- auto-grants anon at CREATE time (see 20260713190000_post_a_car.sql). The drop
-- above discarded the old grants with the old signature, so both the revoke and
-- the grant have to be restated here — reporting requires an account.
revoke execute on function public.submit_bug_report(
  text, text, text, text, text, text, text, text, text, text[], text[])
  from public, anon;
grant execute on function public.submit_bug_report(
  text, text, text, text, text, text, text, text, text, text[], text[])
  to authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
