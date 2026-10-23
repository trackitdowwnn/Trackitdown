-- =============================================================================
-- WHAT:  forget_my_push_tokens() — deletes EVERY push token the caller owns,
--        on every device. Called by the app's "Log out of all devices" just
--        before supabase.auth.signOut({ scope: 'global' }). And
--        register_push_token refuses (silently) a JWT whose session was
--        revoked, so a signed-out phone can't put its token back (below).
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


-- -----------------------------------------------------------------------------
-- register_push_token: a REVOKED session can't put its device back.
-- -----------------------------------------------------------------------------
-- A global sign-out deletes every auth.sessions row, but another phone's access
-- token stays valid until it expires (up to an hour). Opened in that window, the
-- lost phone's app re-registers its push token — after forget_my_push_tokens has
-- run — and once its refresh fails it is signed out with no session left to
-- unregister with, so it keeps this person's pushes until someone else signs in
-- there (code review of #261). So: a JWT naming a session that no longer exists
-- registers nothing. Silent, like the no-session paths: the device is on its
-- way out anyway.
--
-- ⚠️ The body is 20260803140000's EXACTLY (checked against prod's
-- pg_get_functiondef, 2026-10-23) plus the block marked NEW. A JWT with no
-- session_id claim (service role, tests) skips the check.
create or replace function public.register_push_token(
  p_token    text,
  p_platform text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  -- Normalised once, then used everywhere: validating one value and storing
  -- another is how whitelists get bypassed.
  v_token    text := btrim(coalesce(p_token, ''));
  v_platform text := lower(btrim(coalesce(p_platform, '')));
  -- ADDED 2026-08-03: who held this device before this call, for device_links.
  v_previous uuid;
  -- NEW 20261023130000: the session this JWT was issued for.
  v_session  uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  -- A token must belong to an account: no owner, no audience row.
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- NEW 20261023130000: signed out everywhere — this JWT's session is gone.
  if v_session is not null
     and not exists (select 1 from auth.sessions where id = v_session) then
    return;
  end if;

  -- Bounds the token defensively (Expo tokens are ~40-50 chars; 255 is generous
  -- headroom) so a client cannot pad an unbounded blob into a PRIMARY KEY, and
  -- rejects any platform outside the CHECK whitelist with a stable token rather
  -- than a raw constraint-violation error.
  if v_token = ''
     or char_length(v_token) > 255
     or v_platform not in ('ios', 'android') then
    raise exception 'INVALID_INPUT';
  end if;

  -- ADDED 2026-08-03: read the current owner BEFORE the upsert re-points it.
  select user_id into v_previous
    from public.push_tokens
   where token = v_token;

  -- Upsert keyed on the token (the device). ON CONFLICT re-points user_id to the
  -- caller — see DEVICE MIGRATION above — and refreshes the platform (a token
  -- cannot change OS, but a re-registration is the honest moment to re-assert
  -- it) and updated_at.
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (v_token, v_uid, v_platform, now())
  on conflict (token) do update
    set user_id    = excluded.user_id,
        platform   = excluded.platform,
        updated_at = now();

  -- ADDED 2026-08-03: the handover is THE one-phone-two-accounts collusion
  -- signal (SECURITY_AND_TRUST §5), recorded only when the token actually
  -- moved. Same-user refreshes — every app start — write nothing. Hashed so
  -- the ledger never holds a live push credential.
  if v_previous is not null and v_previous <> v_uid then
    insert into public.device_links (token_hash, from_user_id, to_user_id)
    values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_previous, v_uid);
  end if;
end;
$$;

comment on function public.register_push_token(text, text) is
  'Registers the CALLER''s Expo push token. SECURITY DEFINER; user_id is pinned to auth.uid() and is not a parameter, so a token can never be registered on another user''s behalf. Upserts on the TOKEN (the device): if the token already exists under a DIFFERENT user, the row MOVES to the caller — a device that changes hands stops delivering the previous user''s pushes to the new holder. Idempotent; refreshes platform + updated_at. Raises NOT_AUTHENTICATED (guest) and INVALID_INPUT (empty/>255-char token, or platform not ios|android). Redefined 2026-08-03: a cross-user move now also records a device_links edge (hashed token) — the same-handset collusion signal. Redefined 20261023130000: a JWT whose session no longer exists in auth.sessions (signed out everywhere) registers nothing, silently. Grants: authenticated + service_role only.';

revoke execute on function public.register_push_token(text, text) from public, anon;
grant  execute on function public.register_push_token(text, text) to authenticated, service_role;
