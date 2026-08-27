-- =============================================================================
-- Bug report capture verification (NOT a migration — do not place in
-- migrations/).
--
-- SELF-ASSERTING: each check is a seeded begin…rollback (or a grant assertion)
-- that RAISES on failure, so the file aborts non-zero the moment a property is
-- violated. Properties: submit_bug_report pins reporter_id to auth.uid(),
-- refuses a guest, refuses an empty or over-long message, rate-limits at 5 per
-- rolling hour, clamps over-long diagnostics rather than discarding the
-- report, and bug_reports is service-role-only (no client read, and crucially
-- no TRUNCATE, which this project's default privileges would otherwise grant
-- at CREATE TABLE) with RLS enabled and ZERO policies.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset
--     psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/bug_reports_verification.sql
--
-- Fixtures: seed profile 11111111. Function under test:
--   submit_bug_report(text, text, text, text, text)
--   (20260824100000_bug_reports.sql).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — records the CALLER's report; reporter_id = auth.uid(); the message
-- is trimmed; the four diagnostics land as given.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_n        integer;
  v_reporter uuid;
  v_message  text;
  v_platform text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  perform public.submit_bug_report(
    '  The map went blank  ', '1.0.0', 'ios', '18.2', 'iPhone 14'
  );

  select count(*), max(reporter_id::text)::uuid, max(message), max(platform)
    into v_n, v_reporter, v_message, v_platform
  from public.bug_reports;

  if v_n <> 1 then
    raise exception 'CHECK 1 FAILED: expected 1 report, got %', v_n;
  end if;
  -- ⚠️ The property that matters most: a client cannot attribute a report to
  -- anyone else, because reporter_id is never read from the arguments.
  if v_reporter <> '11111111-1111-1111-1111-111111111111' then
    raise exception 'CHECK 1 FAILED: reporter_id not pinned to auth.uid(), got %', v_reporter;
  end if;
  if v_message <> 'The map went blank' then
    raise exception 'CHECK 1 FAILED: message not trimmed, got %', quote_literal(v_message);
  end if;
  if v_platform <> 'ios' then
    raise exception 'CHECK 1 FAILED: platform not stored, got %', v_platform;
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 — a guest is refused. Reporting requires an account.
-- -----------------------------------------------------------------------------
begin;
-- ⚠️ The flag-then-assert shape (the `v_ok` flag in post_flags_verification)
-- is not a
-- style choice. Raising the FAILURE inside the block whose own
-- `exception when others` is two lines below means the handler catches its own
-- complaint and re-raises it wrapped — "expected NOT_AUTHENTICATED, got CHECK 2
-- FAILED: a guest was allowed to submit". It still aborts today only because
-- no failure string happens to contain its own token; make one of them read
-- "...expected NOT_AUTHENTICATED..." and the check passes silently forever.
do $$
declare
  v_refused boolean := false;
  v_err     text := '(no error raised at all)';
begin
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.submit_bug_report('anonymous', null, null, null, null);
  exception
    when others then
      -- sqlerrm is KEPT, not just tested. Without it a missing function or an
      -- unrelated raise reads identically to "the guest got in", and the whole
      -- point of moving off the raise-inside-its-own-handler shape was to make
      -- the diagnosis legible.
      v_err := sqlerrm;
      v_refused := sqlerrm like '%NOT_AUTHENTICATED%';
  end;

  if not v_refused then
    raise exception 'CHECK 2 FAILED: expected NOT_AUTHENTICATED for a guest, got %', v_err;
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — an empty (or whitespace-only) message is INVALID_INPUT, and so is
-- one past the 2000 cap. The client trims and caps too; this is the authority.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_empty_refused boolean := false;
  v_long_refused  boolean := false;
  v_empty_err     text := '(no error raised at all)';
  v_long_err      text := '(no error raised at all)';
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  begin
    perform public.submit_bug_report('   ', null, null, null, null);
  exception
    when others then
      v_empty_err := sqlerrm;
      v_empty_refused := sqlerrm like '%INVALID_INPUT%';
  end;

  begin
    perform public.submit_bug_report(repeat('x', 2001), null, null, null, null);
  exception
    when others then
      v_long_err := sqlerrm;
      v_long_refused := sqlerrm like '%INVALID_INPUT%';
  end;

  if not v_empty_refused then
    raise exception 'CHECK 3 FAILED: expected INVALID_INPUT for a whitespace-only message, got %',
      v_empty_err;
  end if;
  if not v_long_refused then
    raise exception 'CHECK 3 FAILED: expected INVALID_INPUT for a 2001-character message, got %',
      v_long_err;
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 — RATE_LIMITED above 3 per reporter per rolling 24 HOURS. This is the
-- schema's first PER-ACCOUNT limiter (every other one is per user+target), so
-- it is worth pinning that the fourth call in the window is the one that fails.
--
-- ⚠️ THE NUMBERS MOVED ON 2026-08-27, from 5 per hour to 3 per 24 hours, once
-- every report became an email. The old ceiling allowed 120 a day from one
-- account. Three was chosen over one deliberately: someone who hits two
-- separate bugs in a sitting must still be able to report the second, because
-- they will not come back tomorrow to do it.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  i         integer;
  v_refused boolean := false;
  v_err     text := '(no error raised at all)';
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  -- All three land inside the window: they share the transaction's now().
  for i in 1..3 loop
    perform public.submit_bug_report('report ' || i, null, null, null, null);
  end loop;

  begin
    perform public.submit_bug_report('the fourth', null, null, null, null);
  exception
    when others then
      v_err := sqlerrm;
      v_refused := sqlerrm like '%RATE_LIMITED%';
  end;

  if not v_refused then
    raise exception 'CHECK 4 FAILED: expected RATE_LIMITED for the 4th report in 24h, got %',
      v_err;
  end if;

  raise notice 'CHECK 4 passed: 3 reports per rolling 24h allowed, the 4th raises RATE_LIMITED';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4b — the courtesy probe agrees with the authority, at every step.
--
-- ⚠️ ONE RULE IN TWO PLACES. bug_report_quota_remaining exists so a reporter is
-- refused BEFORE three screenshots upload rather than after, which means it
-- carries its own copy of the window and the count. If the two ever drift, the
-- probe either waves someone through to a refusal they already paid an upload
-- for, or refuses a report the RPC would have taken.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  i       integer;
  v_left  integer;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  v_left := public.bug_report_quota_remaining();
  if v_left <> 3 then
    raise exception 'CHECK 4b FAILED: a fresh account should have 3, got %', v_left;
  end if;

  for i in 1..3 loop
    perform public.submit_bug_report('report ' || i, null, null, null, null);
    v_left := public.bug_report_quota_remaining();
    if v_left <> 3 - i then
      raise exception 'CHECK 4b FAILED: after % reports the probe said %, expected %',
        i, v_left, 3 - i;
    end if;
  end loop;

  -- Never negative: the client gates on `remaining === 0`, and a -1 would read
  -- as truthy nonsense rather than "you are out".
  if public.bug_report_quota_remaining() <> 0 then
    raise exception 'CHECK 4b FAILED: the probe did not floor at 0';
  end if;

  raise notice 'CHECK 4b passed: the probe counts down 3-2-1-0 in step with the limit';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 — an OLDER report does not count against the window. The limit is a
-- ROLLING 24 hours, not a calendar bucket, so three from two days ago must not
-- block one today.
--
-- ⚠️ THE SEED IS 2 DAYS, NOT 2 HOURS. It was 2 hours while the window was an
-- hour; against a 24-hour window that seed sits INSIDE it, and this check would
-- have started asserting the opposite of what it was written to prove.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_n integer;
begin
  insert into public.bug_reports (reporter_id, message, created_at)
  select '11111111-1111-1111-1111-111111111111', 'old ' || g, now() - interval '2 days'
  from generate_series(1, 3) g;

  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  perform public.submit_bug_report('a fresh one', null, null, null, null);

  select count(*) into v_n
  from public.bug_reports
  where reporter_id = '11111111-1111-1111-1111-111111111111';

  if v_n <> 4 then
    raise exception 'CHECK 5 FAILED: expected 4 rows (3 old + 1 new), got %', v_n;
  end if;

  raise notice 'CHECK 5 passed: reports outside the rolling 24h do not count against it';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 6 — bug_reports is service-role only. Clients get NOTHING: not select,
-- not insert, and NOT TRUNCATE.
--
-- ⚠️ TRUNCATE is the point of this check. This project ships
-- `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon, authenticated`, so
-- CREATE TABLE hands both roles TRUNCATE unless the migration revokes it — and
-- a per-table `grant select` ADDS to that default rather than replacing it.
-- Without the revoke, any signed-in user could empty the queue.
-- -----------------------------------------------------------------------------
do $$
declare
  v_role text;
  v_priv text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES'] loop
      if has_table_privilege(v_role, 'public.bug_reports', v_priv) then
        raise exception 'CHECK 6 FAILED: % has % on bug_reports', v_role, v_priv;
      end if;
    end loop;
  end loop;

  if not has_table_privilege('service_role', 'public.bug_reports', 'SELECT') then
    raise exception 'CHECK 6 FAILED: service_role cannot read the queue';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 7 — the RPC is executable by authenticated and service_role only.
-- Functions default to PUBLIC here, and this project also auto-grants anon at
-- CREATE time, so both revokes are load-bearing.
-- -----------------------------------------------------------------------------
do $$
declare
  v_oid   oid;
  v_count integer;
begin
  -- ⚠️ LOOKED UP BY NAME, NOT BY A HARDCODED SIGNATURE — and this check failed
  -- on its first ever execution for exactly that reason. It named
  -- `submit_bug_report(text, text, text, text, text)`, which a later migration
  -- (20260824140000) dropped when it widened the function to eleven arguments.
  -- has_function_privilege RAISES on a function that does not exist, so this
  -- aborted the whole run under ON_ERROR_STOP and the eighteen suites sorting
  -- after this file never got to say anything at all.
  --
  -- A signature is the wrong thing for this file to assert. What it cares about
  -- is that whatever submit_bug_report currently IS, anon cannot execute it —
  -- and that survives the next widening without anybody remembering to come
  -- back here. The exact-signature assertion belongs in
  -- bug_report_details_verification, which owns that migration and checks it.
  select count(*), min(p.oid) into v_count, v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'submit_bug_report';

  -- Exactly one overload. Two would make every call ambiguous and could let a
  -- client reach a version that skips the newer argument checks.
  if v_count <> 1 then
    raise exception 'CHECK 7 FAILED: expected exactly one submit_bug_report, found %', v_count;
  end if;

  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'CHECK 7 FAILED: anon can execute submit_bug_report';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'CHECK 7 FAILED: authenticated cannot execute submit_bug_report';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 8 — RLS is on and there are NO policies. The migration's SAFETY block
-- rests entirely on this sentence ("RLS ENABLED with NO client policies"), and
-- until now nothing asserted it: CHECK 6 proves the GRANTS, which is a
-- different mechanism. A policy added here later would be a silent widening,
-- because grants would still look correct.
-- -----------------------------------------------------------------------------
do $$
declare
  v_rls      boolean;
  v_policies integer;
begin
  select c.relrowsecurity into v_rls
  from pg_class c
  where c.oid = 'public.bug_reports'::regclass;

  if not v_rls then
    raise exception 'CHECK 8 FAILED: row level security is not enabled on bug_reports';
  end if;

  select count(*) into v_policies
  from pg_policies
  where schemaname = 'public' and tablename = 'bug_reports';

  if v_policies <> 0 then
    raise exception 'CHECK 8 FAILED: expected no policies on bug_reports, found %', v_policies;
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 9 — an over-long DIAGNOSTIC is truncated, not fatal.
--
-- ⚠️ This is about not losing the report. The columns CHECK 40/40/80, and
-- before the clamp an unusually long Device.modelName raised a check violation
-- the client could only show as its generic "please try again" — so the user
-- retried forever and lost what they wrote, over a field they never typed and
-- could not change. The message is the payload; the diagnostics are advisory.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_app     text;
  v_os      text;
  v_model   text;
  v_message text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  perform public.submit_bug_report(
    'the map went blank', repeat('v', 100), 'ios', repeat('o', 100), repeat('m', 200));

  -- order/limit so this stays deterministic if the seed ever gains fixtures.
  select b.app_version, b.os_version, b.device_model, b.message
    into v_app, v_os, v_model, v_message
  from public.bug_reports b
  where b.reporter_id = '11111111-1111-1111-1111-111111111111'
  order by b.created_at desc
  limit 1;

  -- All three are asserted, so a failure names the field rather than
  -- surfacing as an opaque check-constraint abort.
  if v_app is null or char_length(v_app) <> 40 then
    raise exception 'CHECK 9 FAILED: app_version not clamped to 40, got %',
      coalesce(char_length(v_app)::text, 'null');
  end if;
  if v_os is null or char_length(v_os) <> 40 then
    raise exception 'CHECK 9 FAILED: os_version not clamped to 40, got %',
      coalesce(char_length(v_os)::text, 'null');
  end if;
  if v_model is null or char_length(v_model) <> 80 then
    raise exception 'CHECK 9 FAILED: device_model not clamped to 80, got %',
      coalesce(char_length(v_model)::text, 'null');
  end if;

  -- The point of the clamp: the report itself survived intact.
  if v_message <> 'the map went blank' then
    raise exception 'CHECK 9 FAILED: the report text did not survive, got %',
      quote_literal(v_message);
  end if;
end $$;
rollback;


-- =============================================================================
-- END — all checks passed if this file completed without raising.
-- =============================================================================
