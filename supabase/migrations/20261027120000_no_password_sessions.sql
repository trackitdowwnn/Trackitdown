-- =============================================================================
-- WHAT: A Custom Access Token hook that refuses any session signed in with a
--       PASSWORD. Trackitdown signs in with an email code, Google or Apple —
--       "No passwords, ever" (docs/DOMAIN.md) — but Supabase Auth's email
--       provider still serves the password routes to anyone with the
--       publishable key (security audit run 2, lead 3).
--
-- WHY:  Two ways a password reached an account the app never offered one on:
--         a) pre-hijack: someone signs up a not-yet-registered address with
--            THEIR password; when the real person later asks for a code, the
--            code confirms that same user and the planted password still works;
--         b) persistence: anyone holding a live session (a lost phone) sets a
--            password with PUT /auth/v1/user, and "Log out everywhere" — which
--            revokes refresh tokens — does not touch it.
--       Neither matters if no password ever yields a session. The hook is the
--       one place every token is minted, so it is the one check that covers
--       the password grant AND a refresh of a session it began (amr).
--
-- HOW:  Supabase Auth calls this with {user_id, claims, authentication_method}
--       before issuing each access token. 'password', or a session whose amr
--       history includes a password, gets the documented error object (403);
--       everything else returns the claims untouched. It reads no tables.
--       ⚠️ It only runs once enabled: Dashboard → Authentication → Hooks →
--       Customize Access Token → Postgres → public.custom_access_token_hook.
--       ⚠️ An exception here fails EVERY sign-in — keep it this small.
-- =============================================================================

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  if event->>'authentication_method' = 'password'
     or coalesce(event->'claims'->'amr', '[]'::jsonb) @> '[{"method": "password"}]'::jsonb then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Trackitdown signs you in with an email code, Google or Apple.'
      )
    );
  end if;
  return jsonb_build_object('claims', event->'claims');
end $$;

comment on function public.custom_access_token_hook(jsonb) is
  'Supabase Auth Custom Access Token hook (enable in the dashboard). Refuses '
  'any token for a password sign-in or a session that began with one; returns '
  'all other claims unchanged. Called by supabase_auth_admin only. 20261027120000.';

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
