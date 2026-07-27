-- =============================================================================
-- Report / flag capture verification (NOT a migration — do not place in
-- migrations/).
--
-- SELF-ASSERTING: each check is a seeded begin…rollback (or a grant assertion)
-- that RAISES on failure, so the file aborts non-zero the moment a property is
-- violated. Properties: flag_post pins reporter_id to auth.uid(), is idempotent
-- (one flag per user/post), requires a signed-in caller, and post_flags is
-- service-role-only (no client read/write).
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset
--     psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/post_flags_verification.sql
--
-- Fixtures: an active post owned by seed profile 22222222; reporters are seed
-- profiles 11111111 and 22222222. Function under test:
--   flag_post(p_post_id uuid, p_reason text) (20260730110000_post_flags.sql).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — flag_post records the CALLER's report; reporter_id = auth.uid();
-- a SECOND call by the same user is a no-op (one flag per user/post).
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeeeeeee-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222', 'active', 25000, 'FL11 AGG');

do $$
declare
  v_n        integer;
  v_reporter uuid;
  v_reason   text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  perform public.flag_post('eeeeeeee-0000-0000-0000-000000000001', '  Looks fake  ');
  -- second report of the SAME post by the SAME user → no-op
  perform public.flag_post('eeeeeeee-0000-0000-0000-000000000001', 'again');

  select count(*), max(reporter_id::text)::uuid, max(reason)
    into v_n, v_reporter, v_reason
  from public.post_flags where post_id = 'eeeeeeee-0000-0000-0000-000000000001';

  if v_n <> 1 then
    raise exception 'CHECK 1 FAILED: expected exactly 1 flag after two calls, got %', v_n;
  end if;
  if v_reporter <> '11111111-1111-1111-1111-111111111111' then
    raise exception 'CHECK 1 FAILED: reporter_id is %, expected the caller', v_reporter;
  end if;
  -- reason trimmed; the first report's reason is retained (second was a no-op).
  if v_reason <> 'Looks fake' then
    raise exception 'CHECK 1 FAILED: reason is %, expected trimmed "Looks fake"', v_reason;
  end if;
  raise notice 'CHECK 1 passed: flag_post pins reporter_id to the caller and is idempotent';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 — a DIFFERENT user flagging the same post adds a second row.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeeeeeee-0000-0000-0000-000000000002',
        '22222222-2222-2222-2222-222222222222', 'active', 25000, 'FL22 AGG');

do $$
declare v_n integer;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  perform public.flag_post('eeeeeeee-0000-0000-0000-000000000002', null);

  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  perform public.flag_post('eeeeeeee-0000-0000-0000-000000000002', null);

  select count(*) into v_n from public.post_flags
    where post_id = 'eeeeeeee-0000-0000-0000-000000000002';
  if v_n <> 2 then
    raise exception 'CHECK 2 FAILED: expected 2 flags from 2 distinct users, got %', v_n;
  end if;
  raise notice 'CHECK 2 passed: distinct reporters each record a flag';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — a GUEST (no auth.uid) cannot flag: raises NOT_AUTHENTICATED.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeeeeeee-0000-0000-0000-000000000003',
        '22222222-2222-2222-2222-222222222222', 'active', 25000, 'FL33 AGG');

do $$
declare v_ok boolean := false;
begin
  perform set_config('request.jwt.claims', '', true);  -- no sub → auth.uid() null
  begin
    perform public.flag_post('eeeeeeee-0000-0000-0000-000000000003', null);
  exception when others then
    if sqlerrm like '%NOT_AUTHENTICATED%' then v_ok := true;
    else raise exception 'CHECK 3 FAILED: expected NOT_AUTHENTICATED, got %', sqlerrm; end if;
  end;
  if not v_ok then raise exception 'CHECK 3 FAILED: a guest was allowed to flag'; end if;
  raise notice 'CHECK 3 passed: a guest gets NOT_AUTHENTICATED';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 — GRANTS. anon must NOT EXECUTE flag_post; authenticated must. And
-- post_flags is client-locked (no anon/authenticated table privileges).
-- -----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.flag_post(uuid, text)', 'EXECUTE') then
    raise exception 'CHECK 4 FAILED: anon can EXECUTE flag_post (should be revoked)';
  end if;
  if not has_function_privilege('authenticated', 'public.flag_post(uuid, text)', 'EXECUTE') then
    raise exception 'CHECK 4 FAILED: authenticated CANNOT EXECUTE flag_post (should be granted)';
  end if;
  if has_table_privilege('anon', 'public.post_flags', 'SELECT')
     or has_table_privilege('authenticated', 'public.post_flags', 'SELECT')
     or has_table_privilege('authenticated', 'public.post_flags', 'INSERT') then
    raise exception 'CHECK 4 FAILED: a client role has a direct privilege on post_flags (moderation data)';
  end if;
  raise notice 'CHECK 4 passed: flag_post is authenticated-only; post_flags is client-locked';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 5 — flagging a NON-active (e.g. draft) post is a SILENT no-op: no row,
-- no error (not an existence/status oracle for hidden posts).
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeeeeeee-0000-0000-0000-000000000005',
        '22222222-2222-2222-2222-222222222222', 'draft', 25000, 'FL55 AGG');

do $$
declare v_n integer;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  -- Must NOT raise, and must write nothing.
  perform public.flag_post('eeeeeeee-0000-0000-0000-000000000005', null);
  -- A completely unknown id is likewise a silent no-op (no FK error surfaced).
  perform public.flag_post('eeeeeeee-9999-9999-9999-999999999999', null);

  select count(*) into v_n from public.post_flags
    where post_id in ('eeeeeeee-0000-0000-0000-000000000005',
                      'eeeeeeee-9999-9999-9999-999999999999');
  if v_n <> 0 then
    raise exception 'CHECK 5 FAILED: flagging a non-active/unknown post wrote % row(s)', v_n;
  end if;
  raise notice 'CHECK 5 passed: flagging a non-active/unknown post is a silent no-op';
end $$;
rollback;
