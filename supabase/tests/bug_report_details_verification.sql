-- =============================================================================
-- Bug report DETAILS verification (NOT a migration — do not place in
-- migrations/).
--
-- SELF-ASSERTING: each check is a seeded begin…rollback (or a grant assertion)
-- that RAISES on failure, so the file aborts non-zero the moment a property is
-- violated. Properties: the widened submit_bug_report stores area / severity /
-- frequency / expected / breadcrumbs / screenshot paths, REFUSES a screenshot
-- path belonging to somebody else, refuses an over-long `expected` and more
-- than three screenshots, the bug-screenshots bucket is PRIVATE with no client
-- read, and the quota probe refuses a guest.
--
-- ⚠️ THE PATH-OWNERSHIP CHECK IS THE POINT OF THIS FILE. The storage policy
-- stops a client WRITING outside their own folder, but nothing stops them
-- naming an existing foreign path in the RPC — which would attach another
-- user's private upload to their own report and surface it in the operator's
-- queue under the wrong name. That is the one genuinely new attack surface the
-- widening opened, and CHECK 3 is what proves it is closed.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset
--     npm run test:db
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — the chosen details are stored as given, and `expected` is trimmed.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_area     text;
  v_severity text;
  v_freq     text;
  v_expected text;
  v_crumbs   text[];
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  perform public.submit_bug_report(
    'the map went blank', '1.0.0', 'ios', '18.2', 'iPhone 14',
    'explore', 'blocked', 'always', '  the map  ',
    array['10:00:00 info map:feed_mounted'], null);

  select b.area, b.severity, b.frequency, b.expected, b.breadcrumbs
    into v_area, v_severity, v_freq, v_expected, v_crumbs
  from public.bug_reports b
  where b.reporter_id = '11111111-1111-1111-1111-111111111111'
  order by b.created_at desc
  limit 1;

  if v_area <> 'explore' or v_severity <> 'blocked' or v_freq <> 'always' then
    raise exception 'CHECK 1 FAILED: details not stored, got %/%/%',
      v_area, v_severity, v_freq;
  end if;
  if v_expected <> 'the map' then
    raise exception 'CHECK 1 FAILED: expected not trimmed, got %',
      quote_literal(v_expected);
  end if;
  if v_crumbs is null or array_length(v_crumbs, 1) <> 1 then
    raise exception 'CHECK 1 FAILED: breadcrumbs not stored';
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 — a screenshot path under the CALLER's own folder is accepted.
-- The positive case, so CHECK 3's refusal cannot pass by refusing everything.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_paths text[];
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  perform public.submit_bug_report(
    'with a screenshot', null, null, null, null, null, null, null, null, null,
    array['11111111-1111-1111-1111-111111111111/abc-0.jpg']);

  select b.screenshot_paths into v_paths
  from public.bug_reports b
  where b.reporter_id = '11111111-1111-1111-1111-111111111111'
  order by b.created_at desc
  limit 1;

  if v_paths is null or array_length(v_paths, 1) <> 1 then
    raise exception 'CHECK 2 FAILED: an own-folder screenshot path was not stored';
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — ⚠️ a screenshot path in SOMEBODY ELSE'S folder is refused.
--
-- The whole reason the RPC inspects paths at all. Without this a reporter can
-- attach another user's private upload to their own report, and the operator's
-- queue shows it under the wrong name — an attribution hole and a disclosure
-- of someone else's image in one move.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_refused boolean := false;
  v_err     text := '(no error raised at all)';
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  begin
    perform public.submit_bug_report(
      'not mine', null, null, null, null, null, null, null, null, null,
      array['22222222-2222-2222-2222-222222222222/secret-0.jpg']);
  exception
    when others then
      v_err := sqlerrm;
      v_refused := sqlerrm like '%INVALID_INPUT%';
  end;

  if not v_refused then
    raise exception 'CHECK 3 FAILED: expected INVALID_INPUT for a foreign screenshot path, got %',
      v_err;
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 — a path that merely STARTS with the uid as a prefix is still
-- refused. '111…1112/x.jpg' is not '111…1111/x.jpg', and a `like uid || '%'`
-- (no slash) would have let it through.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_refused boolean := false;
  v_err     text := '(no error raised at all)';
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  begin
    perform public.submit_bug_report(
      'sneaky prefix', null, null, null, null, null, null, null, null, null,
      array['11111111-1111-1111-1111-111111111111x/abc-0.jpg']);
  exception
    when others then
      v_err := sqlerrm;
      v_refused := sqlerrm like '%INVALID_INPUT%';
  end;

  if not v_refused then
    raise exception 'CHECK 4 FAILED: expected INVALID_INPUT for a prefix-only path, got %',
      v_err;
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 — more than three screenshots, and an over-long `expected`, are
-- both INVALID_INPUT. `expected` is the user's OWN text, so it is refused
-- rather than silently truncated the way a device fact is.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_many_refused boolean := false;
  v_long_refused boolean := false;
  v_many_err     text := '(no error raised at all)';
  v_long_err     text := '(no error raised at all)';
  v_uid          text := '11111111-1111-1111-1111-111111111111';
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  begin
    perform public.submit_bug_report(
      'four images', null, null, null, null, null, null, null, null, null,
      array[v_uid || '/a.jpg', v_uid || '/b.jpg', v_uid || '/c.jpg', v_uid || '/d.jpg']);
  exception
    when others then
      v_many_err := sqlerrm;
      v_many_refused := sqlerrm like '%INVALID_INPUT%';
  end;

  begin
    perform public.submit_bug_report(
      'long expected', null, null, null, null, null, null, null,
      repeat('x', 2001), null, null);
  exception
    when others then
      v_long_err := sqlerrm;
      v_long_refused := sqlerrm like '%INVALID_INPUT%';
  end;

  if not v_many_refused then
    raise exception 'CHECK 5 FAILED: expected INVALID_INPUT for four screenshots, got %',
      v_many_err;
  end if;
  if not v_long_refused then
    raise exception 'CHECK 5 FAILED: expected INVALID_INPUT for a 2001-char expected, got %',
      v_long_err;
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 6 — an unrecognised area / severity / frequency is refused rather than
-- coerced. Storing a value the reporter never chose would put a fact in the
-- operator's queue that no one asserted.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_refused boolean := false;
  v_err     text := '(no error raised at all)';
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  begin
    perform public.submit_bug_report(
      'bad area', null, null, null, null, '/post/123', null, null, null, null, null);
  exception
    when others then
      v_err := sqlerrm;
      -- A CHECK violation, not our raise: 23514 rather than a token. Either way
      -- it must NOT have been stored.
      v_refused := true;
  end;

  if not v_refused then
    raise exception 'CHECK 6 FAILED: an unrecognised area was accepted (got %)', v_err;
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 7 — ⚠️ the bug-screenshots bucket is PRIVATE and no client role can
-- read it. A public bucket serves by URL WITHOUT passing through RLS, so
-- `public = false` is not a preference here — it is the whole control.
-- -----------------------------------------------------------------------------
do $$
declare
  v_public   boolean;
  v_policies integer;
begin
  select b.public into v_public from storage.buckets b where b.id = 'bug-screenshots';

  if v_public is null then
    raise exception 'CHECK 7 FAILED: the bug-screenshots bucket does not exist';
  end if;
  if v_public then
    raise exception 'CHECK 7 FAILED: bug-screenshots is a PUBLIC bucket';
  end if;

  -- Exactly one policy, and it must be the INSERT one. A select policy here
  -- would hand every reporter the Storage LIST api over their own uploads and,
  -- more importantly, is one copy-paste away from being scoped wrongly.
  select count(*) into v_policies
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'bug_screenshots_insert_own_folder';

  if v_policies <> 1 then
    raise exception 'CHECK 7 FAILED: expected the own-folder insert policy, found %', v_policies;
  end if;

  select count(*) into v_policies
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname like 'bug_screenshots%'
    and cmd <> 'INSERT';

  if v_policies <> 0 then
    raise exception 'CHECK 7 FAILED: bug-screenshots has % non-INSERT client policies', v_policies;
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 8 — the quota probe refuses a guest and reports the remaining
-- allowance. Advisory, but it must not become an unauthenticated oracle on
-- whether a given session exists.
--
-- ⚠️ THE NUMBERS ARE 3 AND 2 SINCE 20260827160000, when the limit moved from 5
-- per hour to 3 per rolling 24h. This check lives in a DIFFERENT suite from the
-- one that pins the limit itself, which is exactly why it was missed and caught
-- only by CI: the allowance is asserted in two files and both have to move.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_remaining integer;
  v_refused   boolean := false;
  v_err       text := '(no error raised at all)';
begin
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.bug_report_quota_remaining();
  exception
    when others then
      v_err := sqlerrm;
      v_refused := sqlerrm like '%NOT_AUTHENTICATED%';
  end;

  if not v_refused then
    raise exception 'CHECK 8 FAILED: expected NOT_AUTHENTICATED for a guest, got %', v_err;
  end if;

  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  select public.bug_report_quota_remaining() into v_remaining;
  if v_remaining <> 3 then
    raise exception 'CHECK 8 FAILED: expected 3 remaining for a fresh reporter, got %', v_remaining;
  end if;

  perform public.submit_bug_report('one', null, null, null, null);

  select public.bug_report_quota_remaining() into v_remaining;
  if v_remaining <> 2 then
    raise exception 'CHECK 8 FAILED: expected 2 remaining after one report, got %', v_remaining;
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 9 — grants survived the drop-and-recreate. Dropping a function discards
-- its grants, so both the revoke and the grant had to be restated in the
-- migration; if either were forgotten, anon would hold EXECUTE by this
-- project's CREATE-time default.
-- -----------------------------------------------------------------------------
do $$
declare
  v_sig text := 'public.submit_bug_report(text, text, text, text, text, text, text, text, text, text[], text[])';
begin
  if has_function_privilege('anon', v_sig, 'EXECUTE') then
    raise exception 'CHECK 9 FAILED: anon can execute the widened submit_bug_report';
  end if;
  if not has_function_privilege('authenticated', v_sig, 'EXECUTE') then
    raise exception 'CHECK 9 FAILED: authenticated cannot execute the widened submit_bug_report';
  end if;

  if has_function_privilege('anon', 'public.bug_report_quota_remaining()', 'EXECUTE') then
    raise exception 'CHECK 9 FAILED: anon can execute bug_report_quota_remaining';
  end if;

  -- ⚠️ The five-argument form must be GONE, not merely shadowed. Leaving it
  -- would make every call ambiguous and let a client reach a version that does
  -- not check screenshot paths.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'submit_bug_report'
      and p.pronargs = 5
  ) then
    raise exception 'CHECK 9 FAILED: the old five-argument submit_bug_report still exists';
  end if;
end $$;


-- =============================================================================
-- END — all checks passed if this file completed without raising.
-- =============================================================================
