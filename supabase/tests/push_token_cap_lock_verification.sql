-- =============================================================================
-- WHAT:  Verification for 20261028110000_push_token_cap_holds_under_concurrency.sql.
--        NOT a migration.
-- WHY:   The ten-device cap was enforced by "upsert, then delete all but the ten
--        newest" with nothing serialising one user's calls, so overlapping
--        registrations could leave 9+N rows — enough, across accounts, to push a
--        100-user token lookup past PostgREST's max_rows and silently drop other
--        users' alerts (audit run 3, lead 4).
-- CHECKS: 1 ⚠️ a registration holds the caller's per-user advisory lock (the
-- serialisation itself — a true two-session race cannot run in one psql
-- session) · 2 the cap still keeps exactly the ten newest · 3 grants unchanged.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        Registers as seed user Alex (1111…) with no session_id claim.
-- LINKS: supabase/migrations/20261028110000_push_token_cap_holds_under_concurrency.sql.
-- =============================================================================

begin;

select set_config('request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
set local role authenticated;

-- CHECK 1 — the lock is taken, keyed on this user, and held to the end of the
-- transaction (pg_advisory_xact_lock).
select public.register_push_token('ExponentPushToken[lock-check-0]', 'android');

reset role;
do $$
declare
  v_key bigint := hashtextextended('register_push_token:11111111-1111-1111-1111-111111111111', 0);
begin
  if not exists (
    select 1 from pg_locks
     where locktype = 'advisory'
       and pid = pg_backend_pid()
       and objsubid = 1
       and ((classid::bigint << 32) | objid::bigint) = v_key
  ) then
    raise exception 'CHECK 1 FAILED: register_push_token did not take the per-user lock.';
  end if;
  raise notice 'CHECK 1 passed: a registration holds the caller''s per-user lock.';
end $$;

-- CHECK 2 — eleven more registrations leave exactly the ten newest.
set local role authenticated;
select public.register_push_token('ExponentPushToken[lock-check-' || n || ']', 'android')
  from generate_series(1, 11) as n;
reset role;
do $$
begin
  if (select count(*) from public.push_tokens
       where user_id = '11111111-1111-1111-1111-111111111111') <> 10 then
    raise exception 'CHECK 2 FAILED: the cap did not leave exactly ten tokens (got %).',
      (select count(*) from public.push_tokens where user_id = '11111111-1111-1111-1111-111111111111');
  end if;
  raise notice 'CHECK 2 passed: the ten newest devices are kept.';
end $$;

-- CHECK 3 — grants as they have always been.
do $$
begin
  if has_function_privilege('anon', 'public.register_push_token(text, text)', 'execute') then
    raise exception 'CHECK 3 FAILED: anon can register a push token.';
  end if;
  if not has_function_privilege('authenticated', 'public.register_push_token(text, text)', 'execute') then
    raise exception 'CHECK 3 FAILED: a signed-in user cannot register a push token.';
  end if;
  raise notice 'CHECK 3 passed: grants unchanged.';
end $$;

rollback;
