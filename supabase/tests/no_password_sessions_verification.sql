-- =============================================================================
-- WHAT:  Verification for 20261027120000_no_password_sessions.sql. NOT a migration.
-- WHY:   The app has no passwords, but Supabase Auth still serves the password
--        routes; a password planted on an account must never yield a session
--        (audit run 2, lead 3). And because this hook runs on EVERY token, a
--        wrong answer for the real sign-in methods would lock everyone out.
-- CHECKS: 1 ⚠️ email code, Google/Apple, sign-up confirm and a code session's
-- refresh all pass with their claims untouched · 2 ⚠️ a password sign-in is
-- refused (403) · 3 a refresh of a session that began with a password is
-- refused · 4 an event with no amr passes · 5 only supabase_auth_admin may
-- call it.
-- HOW:   Self-asserting, RAISE on failure (CI's db job). Pure function calls.
-- LINKS: supabase/migrations/20261027120000_no_password_sessions.sql.
-- =============================================================================

do $$
declare
  v_method text;
  v_claims jsonb := '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated",
                      "aal": "aal1", "amr": [{"method": "otp", "timestamp": 1}],
                      "session_id": "s1"}';
  v_out    jsonb;
begin
  foreach v_method in array array['otp', 'oauth', 'email/signup', 'magiclink', 'token_refresh'] loop
    v_out := public.custom_access_token_hook(jsonb_build_object(
      'user_id', '11111111-1111-1111-1111-111111111111',
      'claims', v_claims,
      'authentication_method', v_method));
    if v_out ? 'error' or v_out->'claims' is distinct from v_claims then
      raise exception 'CHECK 1 FAILED: a % sign-in was refused or its claims changed (got %).', v_method, v_out;
    end if;
  end loop;
  raise notice 'CHECK 1 passed: code, Google/Apple, sign-up and refresh pass unchanged.';
end $$;

do $$
declare
  v_out jsonb;
begin
  v_out := public.custom_access_token_hook(jsonb_build_object(
    'user_id', '11111111-1111-1111-1111-111111111111',
    'claims', '{"sub": "11111111-1111-1111-1111-111111111111", "amr": [{"method": "password", "timestamp": 1}]}'::jsonb,
    'authentication_method', 'password'));
  if (v_out->'error'->>'http_code')::int is distinct from 403 or v_out ? 'claims' then
    raise exception 'CHECK 2 FAILED: a password sign-in was not refused (got %).', v_out;
  end if;
  raise notice 'CHECK 2 passed: a password sign-in is refused.';
end $$;

do $$
declare
  v_out jsonb;
begin
  v_out := public.custom_access_token_hook(jsonb_build_object(
    'user_id', '11111111-1111-1111-1111-111111111111',
    'claims', '{"sub": "11111111-1111-1111-1111-111111111111",
                "amr": [{"method": "password", "timestamp": 1}, {"method": "otp", "timestamp": 2}]}'::jsonb,
    'authentication_method', 'token_refresh'));
  if (v_out->'error'->>'http_code')::int is distinct from 403 then
    raise exception 'CHECK 3 FAILED: a session that began with a password refreshed (got %).', v_out;
  end if;
  raise notice 'CHECK 3 passed: a password-begun session cannot refresh.';
end $$;

do $$
declare
  v_out jsonb;
begin
  v_out := public.custom_access_token_hook(jsonb_build_object(
    'user_id', '11111111-1111-1111-1111-111111111111',
    'claims', '{"sub": "11111111-1111-1111-1111-111111111111"}'::jsonb,
    'authentication_method', 'otp'));
  if v_out ? 'error' or v_out->'claims'->>'sub' is distinct from '11111111-1111-1111-1111-111111111111' then
    raise exception 'CHECK 4 FAILED: an event without amr did not pass (got %).', v_out;
  end if;
  raise notice 'CHECK 4 passed: no amr → passes.';
end $$;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.custom_access_token_hook(jsonb)', 'execute') then
      raise exception 'CHECK 5 FAILED: % can call the access token hook.', v_role;
    end if;
  end loop;
  if not has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'execute') then
    raise exception 'CHECK 5 FAILED: Supabase Auth (supabase_auth_admin) cannot call the hook.';
  end if;
  raise notice 'CHECK 5 passed: only Supabase Auth calls the hook.';
end $$;
