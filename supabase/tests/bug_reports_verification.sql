-- =============================================================================
-- Bug report capture verification (NOT a migration — do not place in
-- migrations/).
--
-- SELF-ASSERTING: each check is a seeded begin…rollback (or a grant assertion)
-- that RAISES on failure, so the file aborts non-zero the moment a property is
-- violated. Properties: submit_bug_report pins reporter_id to auth.uid(),
-- refuses a guest, refuses an empty or over-long message, rate-limits at 5 per
-- rolling hour, and bug_reports is service-role-only (no client read, and
-- crucially no TRUNCATE, which this project's default privileges would
-- otherwise grant at CREATE TABLE).
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
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.submit_bug_report('anonymous', null, null, null, null);
    raise exception 'CHECK 2 FAILED: a guest was allowed to submit';
  exception
    when others then
      if sqlerrm not like '%NOT_AUTHENTICATED%' then
        raise exception 'CHECK 2 FAILED: expected NOT_AUTHENTICATED, got %', sqlerrm;
      end if;
  end;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — an empty (or whitespace-only) message is INVALID_INPUT, and so is
-- one past the 2000 cap. The client trims and caps too; this is the authority.
-- -----------------------------------------------------------------------------
begin;
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  begin
    perform public.submit_bug_report('   ', null, null, null, null);
    raise exception 'CHECK 3 FAILED: an empty message was accepted';
  exception
    when others then
      if sqlerrm not like '%INVALID_INPUT%' then
        raise exception 'CHECK 3 FAILED: expected INVALID_INPUT for empty, got %', sqlerrm;
      end if;
  end;

  begin
    perform public.submit_bug_report(repeat('x', 2001), null, null, null, null);
    raise exception 'CHECK 3 FAILED: an over-long message was accepted';
  exception
    when others then
      if sqlerrm not like '%INVALID_INPUT%' then
        raise exception 'CHECK 3 FAILED: expected INVALID_INPUT for 2001 chars, got %', sqlerrm;
      end if;
  end;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 — RATE_LIMITED above 5 per reporter per rolling hour. This is the
-- schema's first PER-ACCOUNT limiter (every other one is per user+target), so
-- it is worth pinning that the sixth call in the window is the one that fails.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  i integer;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  for i in 1..5 loop
    perform public.submit_bug_report('report ' || i, null, null, null, null);
  end loop;

  begin
    perform public.submit_bug_report('the sixth', null, null, null, null);
    raise exception 'CHECK 4 FAILED: a 6th report inside the hour was accepted';
  exception
    when others then
      if sqlerrm not like '%RATE_LIMITED%' then
        raise exception 'CHECK 4 FAILED: expected RATE_LIMITED, got %', sqlerrm;
      end if;
  end;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 — an OLDER report does not count against the window. The limit is a
-- rolling hour, not a bucket, so five yesterday must not block one today.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_n integer;
begin
  insert into public.bug_reports (reporter_id, message, created_at)
  select '11111111-1111-1111-1111-111111111111', 'old ' || g, now() - interval '2 hours'
  from generate_series(1, 5) g;

  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  perform public.submit_bug_report('a fresh one', null, null, null, null);

  select count(*) into v_n
  from public.bug_reports
  where reporter_id = '11111111-1111-1111-1111-111111111111';

  if v_n <> 6 then
    raise exception 'CHECK 5 FAILED: expected 6 rows (5 old + 1 new), got %', v_n;
  end if;
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
begin
  if has_function_privilege('anon',
       'public.submit_bug_report(text, text, text, text, text)', 'EXECUTE') then
    raise exception 'CHECK 7 FAILED: anon can execute submit_bug_report';
  end if;
  if not has_function_privilege('authenticated',
       'public.submit_bug_report(text, text, text, text, text)', 'EXECUTE') then
    raise exception 'CHECK 7 FAILED: authenticated cannot execute submit_bug_report';
  end if;
end $$;


-- =============================================================================
-- END — all checks passed if this file completed without raising.
-- =============================================================================
