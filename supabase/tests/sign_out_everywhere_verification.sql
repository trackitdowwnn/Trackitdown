-- =============================================================================
-- WHAT:  Verification for 20261023130000_sign_out_everywhere.sql. NOT a
--        migration.
-- WHY:   "Sign out on all devices" must stop pushes reaching the OTHER phones
--        too — and must never touch anyone else's.
--
-- CHECKS: 1 ⚠️ the caller's tokens go, on every device; another user's stay ·
-- 2 no session: a silent no-op · 3 who may call it · 4 ⚠️ register_push_token
-- refuses a revoked session's JWT, accepts a live one.
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

-- 2 — no session: nothing happens, no error — A's tokens (put back) survive too.
insert into public.push_tokens (token, user_id, platform) values
  ('ExponentPushToken[everywhere-a1]', '11111111-1111-1111-1111-111111111111', 'android');
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select public.forget_my_push_tokens();
reset role;

do $$
begin
  if (select count(*) from public.push_tokens
       where token in ('ExponentPushToken[everywhere-a1]', 'ExponentPushToken[everywhere-b1]')) <> 2 then
    raise exception 'CHECK 2 FAILED: a call with no session deleted a token';
  end if;
end $$;
rollback;

-- 4 — ⚠️ a phone whose session was revoked by "everywhere" can't register its
-- token again with the access token it still holds; a live session can.
begin;
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('5e550000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', now(), now());

select set_config('request.jwt.claims', json_build_object(
  'sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated',
  'session_id', '5e550000-0000-0000-0000-0000000000ff')::text, true);  -- revoked: no such row
set local role authenticated;
select public.register_push_token('ExponentPushToken[everywhere-lost]', 'android');
reset role;

select set_config('request.jwt.claims', json_build_object(
  'sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated',
  'session_id', '5e550000-0000-0000-0000-000000000001')::text, true);  -- live
set local role authenticated;
select public.register_push_token('ExponentPushToken[everywhere-live]', 'android');
reset role;

-- …and a JWT with no session_id claim at all (older tokens, other issuers)
-- registers as before — the check only bites on a NAMED, revoked session.
select set_config('request.jwt.claims', json_build_object(
  'sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.register_push_token('ExponentPushToken[everywhere-noclaim]', 'android');
reset role;

do $$
begin
  if not exists (select 1 from public.push_tokens where token = 'ExponentPushToken[everywhere-noclaim]') then
    raise exception 'CHECK 4 FAILED: a JWT with no session_id could not register';
  end if;
  if exists (select 1 from public.push_tokens where token = 'ExponentPushToken[everywhere-lost]') then
    raise exception 'CHECK 4 FAILED: a revoked session registered its push token again';
  end if;
  if not exists (select 1 from public.push_tokens where token = 'ExponentPushToken[everywhere-live]') then
    raise exception 'CHECK 4 FAILED: a live session could not register its push token';
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
  -- The redefined register_push_token keeps its grants.
  if has_function_privilege('anon', 'public.register_push_token(text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.register_push_token(text, text)', 'execute') then
    raise exception 'CHECK 3 FAILED: register_push_token lost its grant posture';
  end if;
end $$;
