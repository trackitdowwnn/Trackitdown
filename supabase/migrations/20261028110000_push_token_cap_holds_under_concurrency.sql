-- =============================================================================
-- WHAT: register_push_token takes a per-user lock, so the ten-device cap holds
--       even when one account registers many tokens at the same moment
--       (security audit run 3, lead 4).
--
-- WHY:  The cap (20261026160000) upserts first, then deletes every row outside
--       the caller's ten newest. Nothing serialised one user's calls: under
--       READ COMMITTED, N overlapping calls each saw only committed rows plus
--       their own insert, all chose the same "oldest" row, and one deleted it —
--       leaving 9+N. The send path looks tokens up 100 users at a time precisely
--       because ten per user keeps a batch at 1000 rows (PostgREST's max_rows);
--       an account past the cap could push a batch over it and silently drop
--       OTHER users' tokens from a stolen-car alert.
--
-- HOW:  pg_advisory_xact_lock keyed on the user, taken before the first read
--       (the idiom delete_account and the alert fan-out use). Two registrations
--       by the same user now run one after the other; different users never
--       wait on each other. The lock ends with the transaction.
--       RESTATED IN FULL from 20261026160000; the lock (marked NEW) is the only
--       change. Grants restated as they have always been.
-- =============================================================================

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
  -- SAFETY (AUDIT 2026-10-26, lead 7): an Expo token or nothing. The send path
  -- batches 100 users' tokens per Expo request, so one planted non-Expo
  -- string could fail the whole request for everyone in it.
  if v_token = ''
     or char_length(v_token) > 255
     or v_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$'
     or v_platform not in ('ios', 'android') then
    raise exception 'INVALID_INPUT';
  end if;

  -- NEW 20261028110000 (audit run 3, lead 4): one registration per user at a
  -- time, so the ten-device cap below cannot be raced past.
  perform pg_advisory_xact_lock(hashtextextended('register_push_token:' || v_uid::text, 0));

  -- ADDED 2026-08-03: read the current owner BEFORE the upsert re-points it.
  select user_id into v_previous
    from public.push_tokens
   where token = v_token;

  -- AUDIT 2026-10-26 (lead 15): a device signed out by ANOTHER account still
  -- counts as theirs — sign-out deletes the token row, so without this the
  -- one-phone-two-accounts edge below vanished on Log out.
  if v_previous is null then
    select r.user_id into v_previous
      from public.push_token_releases r
     where r.token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
       and r.user_id <> v_uid;
  end if;

  -- Upsert keyed on the token (the device). ON CONFLICT re-points user_id to the
  -- caller and refreshes the platform (a token cannot change OS, but a
  -- re-registration is the honest moment to re-assert it) and updated_at.
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

  -- SAFETY (AUDIT 2026-10-26, lead 7): a user keeps their ten newest devices,
  -- so nobody can stuff the shared fan-out with tokens. Held by the lock above.
  delete from public.push_tokens t
   where t.user_id = v_uid
     and t.token not in (select k.token
                           from public.push_tokens k
                          where k.user_id = v_uid
                          order by k.updated_at desc, k.token
                          limit 10);
end;
$$;

revoke execute on function public.register_push_token(text, text) from public, anon;
grant  execute on function public.register_push_token(text, text) to authenticated, service_role;
