-- =============================================================================
-- WHAT:  Verification for 20261023130000_sign_out_everywhere.sql. NOT a
--        migration.
-- WHY:   "Sign out on all devices" must stop pushes reaching the OTHER phones
--        too — and must never touch anyone else's.
--
-- CHECKS: 1 ⚠️ the caller's tokens go, on every device; another user's stay ·
-- 2 no session: a silent no-op · 3 who may call it.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        Uses seed.sql's two users. Called as authenticated with the JWT claim
--        set, then read back as postgres.
-- LINKS: supabase/migrations/20261023130000_sign_out_everywhere.sql.
-- =============================================================================

begin;
insert into public.push_tokens (token, user_id, platform) values
  ('ExponentPushToken[everywhere-a1]', '11111111-1111-1111-1111-111111111111', 'android'),
  ('ExponentPushToken[everywhere-a2]', '11111111-1111-1111-1111-111111111111', 'ios'),
  ('ExponentPushToken[everywhere-b1]', '22222222-2222-2222-2222-222222222222', 'android');

-- 1 — as user A.
select set_config('request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
set local role authenticated;
select public.forget_my_push_tokens();
reset role;

do $$
begin
  if exists (select 1 from public.push_tokens
              where token in ('ExponentPushToken[everywhere-a1]', 'ExponentPushToken[everywhere-a2]')) then
    raise exception 'CHECK 1 FAILED: one of the caller''s devices kept its push token';
  end if;
  if not exists (select 1 from public.push_tokens where token = 'ExponentPushToken[everywhere-b1]') then
    raise exception 'CHECK 1 FAILED: another user''s device token was deleted';
  end if;
end $$;

-- 2 — no session: nothing happens, no error.
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select public.forget_my_push_tokens();
reset role;

do $$
begin
  if not exists (select 1 from public.push_tokens where token = 'ExponentPushToken[everywhere-b1]') then
    raise exception 'CHECK 2 FAILED: a call with no session deleted a token';
  end if;
end $$;
rollback;

-- 3 — signed-in users only.
do $$
begin
  if has_function_privilege('anon', 'public.forget_my_push_tokens()', 'execute') then
    raise exception 'CHECK 3 FAILED: the public key can call forget_my_push_tokens';
  end if;
  if not has_function_privilege('authenticated', 'public.forget_my_push_tokens()', 'execute') then
    raise exception 'CHECK 3 FAILED: a signed-in user can''t call forget_my_push_tokens';
  end if;
end $$;
