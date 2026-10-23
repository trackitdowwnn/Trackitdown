-- =============================================================================
-- WHAT:  forget_my_push_tokens() — deletes EVERY push token the caller owns,
--        on every device. Called by the app's "Sign out on all devices" just
--        before supabase.auth.signOut({ scope: 'global' }).
-- WHY:   A global sign-out revokes every refresh token, but a push token is a
--        DEVICE row that survives sign-out by design (20260802100000: the PK is
--        the token alone). Without this, the lost or sold phone that is the
--        whole reason to sign out everywhere would keep receiving this person's
--        sighting, message and money pushes — plates, places, names — until
--        someone else signed in on it. unregister_push_token only removes the
--        ONE token the calling device knows.
--
--        Own rows only (user_id = auth.uid()), no RETURNING and no count, the
--        same no-oracle shape as unregister_push_token. Each device registers
--        again when someone next signs in on it.
-- LINKS: supabase/migrations/20260802100000_push_infrastructure.sql
--          (push_tokens, unregister_push_token — the one-device version);
--        src/features/profile/api/profileApi.ts (signOut, everywhere);
--        supabase/tests/sign_out_everywhere_verification.sql.
-- =============================================================================

create or replace function public.forget_my_push_tokens()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- No session -> silent no-op, as unregister_push_token: nothing to delete
  -- without a caller identity, and an error mid-sign-out helps nobody.
  if v_uid is null then
    return;
  end if;

  delete from public.push_tokens
   where user_id = v_uid;
end;
$$;

comment on function public.forget_my_push_tokens() is
  'Deletes every push token the CALLER owns, on all their devices ("Sign out on all devices", 20261023130000). SECURITY DEFINER; only where user_id = auth.uid(). Silent no-op with no session. No count returned. Grants: authenticated + service_role only.';

-- SAFETY: revoke PUBLIC *and* anon (default privileges grant anon EXECUTE at
-- create time); forgetting devices is an account action.
revoke execute on function public.forget_my_push_tokens() from public, anon;
grant  execute on function public.forget_my_push_tokens() to authenticated, service_role;
