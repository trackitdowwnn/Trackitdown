-- =============================================================================
-- WHAT:  Verification for "archive a listing" — set_post_archived, the
--        posts_clear_archived_at trigger, list_my_posts' new 'archived_at',
--        and the grants that keep posts.archived_at server-only. NOT a
--        migration.
-- WHY:   Archiving is personal filing, so every guard is an ownership or
--        scope guard: owner-only, closed-only, never touches status, and the
--        column is unreachable except through the two RPCs. Each is asserted
--        against the real `authenticated` role, not merely read in the source.
--
-- CHECKS: 1 owner archives a closed post · 2 archive is idempotent (keeps the
-- original time) · 3 list_my_posts returns archived_at · 4 unarchive clears it
-- (and is idempotent) · 5 NOT_OWNER (an archived row stays archived) ·
-- 6 NOT_CLOSED for every open status · 7 all four closed statuses archive ·
-- 8 NOT_AUTHENTICATED / POST_NOT_FOUND · 9 no client column privilege on
-- archived_at · 10 function grants + SECURITY DEFINER + pinned search_path ·
-- 11 a reopen (cancelled -> recovery_claimed) clears archived_at ·
-- 12 list_my_posts keeps users apart (and returns [] with no uid).
-- LINKS: supabase/migrations/20260924130000_archive_listings.sql;
--        supabase/migrations/20260727100000_list_my_posts.sql;
--        docs/DOMAIN.md (lifecycle — the closed four); docs/TESTING.md;
--        scripts/test-db.sh (globs this file).
--
-- SELF-ASSERTING: every check is a DO block that RAISES on failure, so the
-- file aborts non-zero the moment a property is violated (ON_ERROR_STOP=1).
-- Each top-level DO block is its own transaction, so SET LOCAL ROLE and the
-- local JWT claims never leak between checks, and now() differs per block.
--
-- Fixtures (from supabase/seed.sql):
--   Beth 22222222  a1a1a1a1-...0018 recovered_no_spotter  (the main subject)
--                  a1a1a1a1-...0003 active
--                  a1a1a1a1-...001c pending_verification
--   Alex 11111111  a1a1a1a1-...0017 recovered
--                  a1a1a1a1-...001b draft
--   Carl 33333333  a1a1a1a1-...001d recovery_claimed      (also: the stranger)
--   Dana 44444444  a1a1a1a1-...001e cancelled
--   Evan 55555555  a1a1a1a1-...001f expired
--   Farah 6666666  a1a1a1a1-...0020 rejected
-- The only column this file changes on a seeded row is archived_at (and, via
-- posts_set_updated_at, updated_at on the rows it archives), restored to null
-- at the end. CHECKS 5 and 12 archive 0018 and unarchive it again in the same
-- block. CHECK 11 changes status too, but inside a subtransaction it rolls back
-- itself, so closed_at / updated_at / status are untouched there.
-- =============================================================================

-- --- housekeeping: leave no trace from a previous run ------------------------
-- `archived_at is not null` keeps this a no-op on a clean DB (an unconditional
-- UPDATE would still fire posts_set_updated_at on every row it names).
update public.posts set archived_at = null
where archived_at is not null
  and id in ('a1a1a1a1-0000-0000-0000-000000000018',
             'a1a1a1a1-0000-0000-0000-000000000017',
             'a1a1a1a1-0000-0000-0000-00000000001e',
             'a1a1a1a1-0000-0000-0000-00000000001f');


-- -----------------------------------------------------------------------------
-- CHECK 1 — the owner archives their own CLOSED post. archived_at is stamped,
-- the RPC echoes it, and status does not move (archiving is not a transition).
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc      jsonb;
  v_archived timestamptz;
  v_status   public.post_status;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  v_doc := public.set_post_archived('a1a1a1a1-0000-0000-0000-000000000018', true);
  reset role;

  select archived_at, status into v_archived, v_status
  from public.posts where id = 'a1a1a1a1-0000-0000-0000-000000000018';

  if v_archived is null then
    raise exception 'CHECK 1 FAILED: archived_at not set after archiving';
  end if;
  if v_status <> 'recovered_no_spotter' then
    raise exception 'CHECK 1 FAILED: status moved to % — archiving must never change status', v_status;
  end if;
  if (v_doc ->> 'postId')::uuid <> 'a1a1a1a1-0000-0000-0000-000000000018'
     or (v_doc ->> 'archivedAt')::timestamptz <> v_archived then
    raise exception 'CHECK 1 FAILED: RPC returned %, expected postId + archivedAt = %', v_doc, v_archived;
  end if;
  raise notice 'CHECK 1 passed: owner archived a closed post; archived_at stamped, status unchanged, {postId, archivedAt} returned';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 2 — archiving again is idempotent: the ORIGINAL archived_at stands.
-- The stored value is backdated a day first (as postgres) so a re-stamp could
-- not hide behind an equal now().
-- -----------------------------------------------------------------------------
do $$
declare
  v_before timestamptz;
  v_after  timestamptz;
  v_doc    jsonb;
begin
  update public.posts set archived_at = archived_at - interval '1 day'
  where id = 'a1a1a1a1-0000-0000-0000-000000000018'
  returning archived_at into v_before;

  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  v_doc := public.set_post_archived('a1a1a1a1-0000-0000-0000-000000000018', true);
  reset role;

  select archived_at into v_after
  from public.posts where id = 'a1a1a1a1-0000-0000-0000-000000000018';

  if v_after is distinct from v_before then
    raise exception 'CHECK 2 FAILED: re-archiving moved archived_at from % to %', v_before, v_after;
  end if;
  if (v_doc ->> 'archivedAt')::timestamptz is distinct from v_before then
    raise exception 'CHECK 2 FAILED: RPC returned archivedAt %, expected the original %', v_doc ->> 'archivedAt', v_before;
  end if;
  raise notice 'CHECK 2 passed: archiving an archived post keeps its original archived_at';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 3 — list_my_posts carries 'archived_at' on EVERY row: the archived
-- post's stamp, and an explicit JSON null (key present) on an unarchived one.
-- Archived posts stay IN the list — archiving moves a card, it doesn't hide it.
-- -----------------------------------------------------------------------------
do $$
declare
  v_list     jsonb;
  v_row      jsonb;
  v_stored   timestamptz;
  v_missing  int;
begin
  select archived_at into v_stored
  from public.posts where id = 'a1a1a1a1-0000-0000-0000-000000000018';

  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  v_list := public.list_my_posts();
  reset role;

  select count(*) into v_missing
  from jsonb_array_elements(v_list) e
  where not (e ? 'archived_at');
  if v_missing > 0 then
    raise exception 'CHECK 3 FAILED: % list_my_posts rows lack the archived_at key', v_missing;
  end if;

  select e into v_row from jsonb_array_elements(v_list) e
  where e ->> 'id' = 'a1a1a1a1-0000-0000-0000-000000000018';
  if v_row is null then
    raise exception 'CHECK 3 FAILED: the archived post is missing from list_my_posts';
  end if;
  if (v_row ->> 'archived_at')::timestamptz is distinct from v_stored then
    raise exception 'CHECK 3 FAILED: archived_at = %, expected %', v_row ->> 'archived_at', v_stored;
  end if;

  select e into v_row from jsonb_array_elements(v_list) e
  where e ->> 'id' = 'a1a1a1a1-0000-0000-0000-000000000003';
  if v_row is null or jsonb_typeof(v_row -> 'archived_at') <> 'null' then
    raise exception 'CHECK 3 FAILED: the unarchived active post should carry archived_at: null, got %', v_row;
  end if;
  raise notice 'CHECK 3 passed: list_my_posts returns archived_at (stamp when archived, null otherwise)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 4 — unarchive clears archived_at, list_my_posts follows, and a second
-- unarchive is a harmless no-op.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc      jsonb;
  v_doc2     jsonb;
  v_archived timestamptz;
  v_list     jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  v_doc  := public.set_post_archived('a1a1a1a1-0000-0000-0000-000000000018', false);
  v_doc2 := public.set_post_archived('a1a1a1a1-0000-0000-0000-000000000018', false);
  v_list := public.list_my_posts();
  reset role;

  select archived_at into v_archived
  from public.posts where id = 'a1a1a1a1-0000-0000-0000-000000000018';
  if v_archived is not null then
    raise exception 'CHECK 4 FAILED: archived_at still % after unarchive', v_archived;
  end if;
  if jsonb_typeof(v_doc -> 'archivedAt') <> 'null' or jsonb_typeof(v_doc2 -> 'archivedAt') <> 'null' then
    raise exception 'CHECK 4 FAILED: unarchive returned % / %, expected archivedAt null', v_doc, v_doc2;
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_list) e
    where e ->> 'id' = 'a1a1a1a1-0000-0000-0000-000000000018'
      and jsonb_typeof(e -> 'archived_at') <> 'null'
  ) then
    raise exception 'CHECK 4 FAILED: list_my_posts still shows the post as archived';
  end if;
  raise notice 'CHECK 4 passed: unarchive clears archived_at (idempotently) and list_my_posts reflects it';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 5 — SAFETY. Only the OWNER may archive or unarchive. Beth archives 0018
-- first, so Carl's unarchive attempt has something real to (wrongly) clear.
-- Carl names Beth's post: NOT_OWNER both ways, and her archived_at is STILL the
-- exact stamp she set. Beth unarchives at the end, so later checks start from
-- archived_at = null as before.
-- -----------------------------------------------------------------------------
do $$
declare
  v_archive_ok   boolean := false;
  v_unarchive_ok boolean := false;
  v_before       timestamptz;
  v_archived     timestamptz;
begin
  -- Setup: the owner archives her closed post.
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  perform public.set_post_archived('a1a1a1a1-0000-0000-0000-000000000018', true);
  reset role;
  select archived_at into v_before
  from public.posts where id = 'a1a1a1a1-0000-0000-0000-000000000018';
  if v_before is null then
    raise exception 'CHECK 5 FAILED: setup — Beth could not archive 0018';
  end if;

  -- The stranger.
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  begin
    set local role authenticated;
    perform public.set_post_archived('a1a1a1a1-0000-0000-0000-000000000018', true);
  exception when others then
    if sqlerrm like '%NOT_OWNER%' then v_archive_ok := true;
    else raise exception 'CHECK 5 FAILED: wrong error archiving another user''s post: %', sqlerrm; end if;
  end;
  begin
    set local role authenticated;
    perform public.set_post_archived('a1a1a1a1-0000-0000-0000-000000000018', false);
  exception when others then
    if sqlerrm like '%NOT_OWNER%' then v_unarchive_ok := true;
    else raise exception 'CHECK 5 FAILED: wrong error unarchiving another user''s post: %', sqlerrm; end if;
  end;
  reset role;

  if not v_archive_ok then
    raise exception 'CHECK 5 FAILED: a stranger archived someone else''s post';
  end if;
  if not v_unarchive_ok then
    raise exception 'CHECK 5 FAILED: a stranger unarchived someone else''s post';
  end if;
  select archived_at into v_archived
  from public.posts where id = 'a1a1a1a1-0000-0000-0000-000000000018';
  if v_archived is distinct from v_before then
    raise exception 'CHECK 5 FAILED: the stranger''s NOT_OWNER unarchive changed archived_at from % to %', v_before, v_archived;
  end if;

  -- Restore: the owner unarchives, so later checks see archived_at = null.
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  perform public.set_post_archived('a1a1a1a1-0000-0000-0000-000000000018', false);
  reset role;
  if exists (select 1 from public.posts
             where id = 'a1a1a1a1-0000-0000-0000-000000000018' and archived_at is not null) then
    raise exception 'CHECK 5 FAILED: restore — Beth could not unarchive 0018';
  end if;
  raise notice 'CHECK 5 passed: NOT_OWNER for another user (archive and unarchive); the archived row kept its stamp';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 6 — NOT_CLOSED for every open status, each by its OWN owner (so the
-- refusal is the status rule, not ownership): active, draft,
-- pending_verification, recovery_claimed, rejected.
-- -----------------------------------------------------------------------------
do $$
declare
  v_case  record;
  v_ok    boolean;
  v_count int := 0;
begin
  for v_case in
    select * from (values
      ('a1a1a1a1-0000-0000-0000-000000000003'::uuid, '22222222-2222-2222-2222-222222222222', 'active'),
      ('a1a1a1a1-0000-0000-0000-00000000001b'::uuid, '11111111-1111-1111-1111-111111111111', 'draft'),
      ('a1a1a1a1-0000-0000-0000-00000000001c'::uuid, '22222222-2222-2222-2222-222222222222', 'pending_verification'),
      ('a1a1a1a1-0000-0000-0000-00000000001d'::uuid, '33333333-3333-3333-3333-333333333333', 'recovery_claimed'),
      ('a1a1a1a1-0000-0000-0000-000000000020'::uuid, '66666666-6666-6666-6666-666666666666', 'rejected')
    ) as c(post_id, owner_id, label)
  loop
    v_ok := false;
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', v_case.owner_id, 'role', 'authenticated')::text, true);
    begin
      set local role authenticated;
      perform public.set_post_archived(v_case.post_id, true);
    exception when others then
      if sqlerrm like '%NOT_CLOSED%' then v_ok := true;
      else raise exception 'CHECK 6 FAILED: wrong error archiving a % post: %', v_case.label, sqlerrm; end if;
    end;
    reset role;
    if not v_ok then
      raise exception 'CHECK 6 FAILED: a % post was archived', v_case.label;
    end if;
    if exists (select 1 from public.posts where id = v_case.post_id and archived_at is not null) then
      raise exception 'CHECK 6 FAILED: the refused % post has an archived_at', v_case.label;
    end if;
    v_count := v_count + 1;
  end loop;
  raise notice 'CHECK 6 passed: NOT_CLOSED for all % open statuses (active, draft, pending_verification, recovery_claimed, rejected)', v_count;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 7 — the other three closed statuses archive too (recovered_no_spotter
-- was CHECK 1): recovered, cancelled, expired. Each is unarchived again in the
-- same block, so the fixtures leave as they came.
-- -----------------------------------------------------------------------------
do $$
declare
  v_case record;
  v_doc  jsonb;
begin
  for v_case in
    select * from (values
      ('a1a1a1a1-0000-0000-0000-000000000017'::uuid, '11111111-1111-1111-1111-111111111111', 'recovered'),
      ('a1a1a1a1-0000-0000-0000-00000000001e'::uuid, '44444444-4444-4444-4444-444444444444', 'cancelled'),
      ('a1a1a1a1-0000-0000-0000-00000000001f'::uuid, '55555555-5555-5555-5555-555555555555', 'expired')
    ) as c(post_id, owner_id, label)
  loop
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', v_case.owner_id, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_doc := public.set_post_archived(v_case.post_id, true);
    reset role;
    if v_doc ->> 'archivedAt' is null
       or not exists (select 1 from public.posts where id = v_case.post_id and archived_at is not null) then
      raise exception 'CHECK 7 FAILED: a % post was not archived (%)', v_case.label, v_doc;
    end if;

    set local role authenticated;
    perform public.set_post_archived(v_case.post_id, false);
    reset role;
    if exists (select 1 from public.posts where id = v_case.post_id and archived_at is not null) then
      raise exception 'CHECK 7 FAILED: a % post did not unarchive', v_case.label;
    end if;
  end loop;
  raise notice 'CHECK 7 passed: recovered, cancelled and expired posts archive and unarchive';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 8 — NOT_AUTHENTICATED with no uid (even under the authenticated role),
-- POST_NOT_FOUND for an id that does not exist.
-- -----------------------------------------------------------------------------
do $$
declare
  v_unauth_ok  boolean := false;
  v_missing_ok boolean := false;
begin
  perform set_config('request.jwt.claims', null, true);
  begin
    set local role authenticated;
    perform public.set_post_archived('a1a1a1a1-0000-0000-0000-000000000018', true);
  exception when others then
    if sqlerrm like '%NOT_AUTHENTICATED%' then v_unauth_ok := true;
    else raise exception 'CHECK 8 FAILED: wrong error with no uid: %', sqlerrm; end if;
  end;
  reset role;

  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  begin
    set local role authenticated;
    perform public.set_post_archived('a1a1a1a1-0000-0000-0000-0000000000ff', true);
  exception when others then
    if sqlerrm like '%POST_NOT_FOUND%' then v_missing_ok := true;
    else raise exception 'CHECK 8 FAILED: wrong error for a missing post: %', sqlerrm; end if;
  end;
  reset role;

  if not v_unauth_ok then
    raise exception 'CHECK 8 FAILED: a call with no uid was not refused';
  end if;
  if not v_missing_ok then
    raise exception 'CHECK 8 FAILED: a missing post id was not refused';
  end if;
  raise notice 'CHECK 8 passed: NOT_AUTHENTICATED (no uid) and POST_NOT_FOUND (unknown id)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 9 — SAFETY. posts.archived_at is server-only: neither anon nor
-- authenticated holds SELECT, UPDATE or INSERT on it (has_column_privilege is
-- true for a table-level grant too, so this also catches a re-widened table
-- grant). Then behaviourally: a direct owner read and write both hit 42501.
-- -----------------------------------------------------------------------------
do $$
declare
  v_role    text;
  v_priv    text;
  v_read_ok boolean := false;
  v_write_ok boolean := false;
  v_dummy   timestamptz;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_priv in array array['SELECT', 'UPDATE', 'INSERT'] loop
      if has_column_privilege(v_role, 'public.posts', 'archived_at', v_priv) then
        raise exception 'CHECK 9 FAILED: % holds % on posts.archived_at — it must be server-only', v_role, v_priv;
      end if;
    end loop;
  end loop;

  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  begin
    set local role authenticated;
    select archived_at into v_dummy from public.posts
    where id = 'a1a1a1a1-0000-0000-0000-000000000018';
  exception when insufficient_privilege then
    v_read_ok := true;
  end;
  reset role;
  begin
    set local role authenticated;
    update public.posts set archived_at = now()
    where id = 'a1a1a1a1-0000-0000-0000-000000000018';
  exception when insufficient_privilege then
    v_write_ok := true;
  end;
  reset role;

  if not v_read_ok then
    raise exception 'CHECK 9 FAILED: the owner read posts.archived_at directly';
  end if;
  if not v_write_ok then
    raise exception 'CHECK 9 FAILED: the owner wrote posts.archived_at directly (bypassing the closed-only rule)';
  end if;
  raise notice 'CHECK 9 passed: anon/authenticated hold no SELECT/UPDATE/INSERT on posts.archived_at; direct read and write are 42501';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 10 — function grants. set_post_archived: authenticated only (anon and
-- PUBLIC revoked). list_my_posts: authenticated + service_role, anon revoked.
-- Both are SECURITY DEFINER with a pinned search_path (proconfig carries a
-- 'search_path=' entry) — a definer function without one can be hijacked by
-- objects on the caller's search_path.
-- The positive assertions are deliberate: a revoke-everything "fix" would
-- otherwise pass while breaking the feature.
-- -----------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array['public.set_post_archived(uuid, boolean)', 'public.list_my_posts()'] loop
    if to_regprocedure(fn) is null then
      raise exception 'CHECK 10 FAILED: % does not exist — the migration is half-applied or the signature drifted', fn;
    end if;
    if has_function_privilege('anon', fn, 'EXECUTE') then
      raise exception 'CHECK 10 FAILED: anon can EXECUTE % (the revoke must name anon explicitly)', fn;
    end if;
    if not has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'CHECK 10 FAILED: authenticated CANNOT EXECUTE % — My listings is broken', fn;
    end if;
    -- PUBLIC (grantee oid 0) must hold no EXECUTE in the ACL.
    if exists (
      select 1
      from pg_proc pr, aclexplode(coalesce(pr.proacl, acldefault('f', pr.proowner))) a
      where pr.oid = to_regprocedure(fn) and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) then
      raise exception 'CHECK 10 FAILED: PUBLIC holds EXECUTE on %', fn;
    end if;
    if not exists (
      select 1 from pg_proc where oid = to_regprocedure(fn) and prosecdef
    ) then
      raise exception 'CHECK 10 FAILED: % is not SECURITY DEFINER', fn;
    end if;
    if not exists (
      select 1
      from pg_proc pr, unnest(pr.proconfig) c(setting)
      where pr.oid = to_regprocedure(fn) and c.setting like 'search_path=%'
    ) then
      raise exception 'CHECK 10 FAILED: % has no pinned search_path in proconfig', fn;
    end if;
  end loop;

  if not has_function_privilege('service_role', 'public.list_my_posts()', 'EXECUTE') then
    raise exception 'CHECK 10 FAILED: service_role lost EXECUTE on list_my_posts()';
  end if;
  raise notice 'CHECK 10 passed: set_post_archived and list_my_posts — anon/PUBLIC denied, authenticated granted, SECURITY DEFINER with pinned search_path; list_my_posts keeps service_role';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 11 — a reopen clears the archive. resolve_sighting_dispute can move a
-- held post cancelled -> recovery_claimed; the trigger must null archived_at so
-- a listing with money moving again is not left in a collapsed section. Also:
-- even a service-role write cannot park archived_at on an open post.
-- Runs in a subtransaction ended by a sentinel exception, so status, closed_at,
-- activated_at and updated_at all roll back exactly — nothing to restore.
-- -----------------------------------------------------------------------------
do $$
declare
  v_archived timestamptz;
begin
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
    set local role authenticated;
    perform public.set_post_archived('a1a1a1a1-0000-0000-0000-00000000001e', true);
    reset role;

    -- The dispute path's write, as the server (postgres) would make it.
    update public.posts set status = 'recovery_claimed'
    where id = 'a1a1a1a1-0000-0000-0000-00000000001e'
    returning archived_at into v_archived;
    if v_archived is not null then
      raise exception 'CHECK 11 FAILED: archived_at survived cancelled -> recovery_claimed (%)', v_archived;
    end if;

    update public.posts set archived_at = now()
    where id = 'a1a1a1a1-0000-0000-0000-000000000003'
    returning archived_at into v_archived;
    if v_archived is not null then
      raise exception 'CHECK 11 FAILED: a direct write parked archived_at on an ACTIVE post';
    end if;

    raise exception 'CHECK_11_ROLLBACK';
  exception when others then
    if sqlerrm <> 'CHECK_11_ROLLBACK' then
      raise;
    end if;
  end;

  if exists (
    select 1 from public.posts
    where id = 'a1a1a1a1-0000-0000-0000-00000000001e'
      and (status <> 'cancelled' or archived_at is not null)
  ) then
    raise exception 'CHECK 11 FAILED: the cancelled fixture did not roll back';
  end if;
  raise notice 'CHECK 11 passed: a closed -> open move clears archived_at; an open post can never carry one';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 12 — SAFETY. list_my_posts keeps users apart. list_my_posts is SECURITY
-- DEFINER, so RLS does not protect it: `owner_id = auth.uid()` is the only
-- gate. Beth archives 0018 (so her list has an archived row worth leaking),
-- then Carl calls list_my_posts: none of Beth's post ids appear, every row is
-- Carl's by posts.owner_id, and the list is not empty (so the ownership pass is
-- not vacuous). With no uid in the claims — a sub-less claim set, and no claims
-- at all — it returns exactly []. Beth unarchives at the end.
-- -----------------------------------------------------------------------------
do $$
declare
  v_list       jsonb;
  v_leaked     int;
  v_not_carls  int;
  v_rows       int;
begin
  -- Setup: Beth archives 0018.
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  perform public.set_post_archived('a1a1a1a1-0000-0000-0000-000000000018', true);
  reset role;
  if not exists (select 1 from public.posts
                 where id = 'a1a1a1a1-0000-0000-0000-000000000018' and archived_at is not null) then
    raise exception 'CHECK 12 FAILED: setup — Beth could not archive 0018';
  end if;

  -- Carl lists "his" posts.
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  set local role authenticated;
  v_list := public.list_my_posts();
  reset role;

  if jsonb_typeof(v_list) <> 'array' then
    raise exception 'CHECK 12 FAILED: list_my_posts returned a non-array %', v_list;
  end if;
  v_rows := jsonb_array_length(v_list);
  if v_rows = 0 then
    raise exception 'CHECK 12 FAILED: Carl''s list is empty — expected at least 001d, so the isolation checks would be vacuous';
  end if;

  select count(*) into v_leaked
  from jsonb_array_elements(v_list) e
  join public.posts p on p.id = (e ->> 'id')::uuid
  where p.owner_id = '22222222-2222-2222-2222-222222222222';
  if v_leaked > 0 then
    raise exception 'CHECK 12 FAILED: % of Beth''s posts appeared in Carl''s list_my_posts', v_leaked;
  end if;

  -- Every row must map to a post Carl owns (a left join, so an id that matches
  -- no post at all also counts as a failure).
  select count(*) into v_not_carls
  from jsonb_array_elements(v_list) e
  left join public.posts p on p.id = (e ->> 'id')::uuid
  where p.owner_id is distinct from '33333333-3333-3333-3333-333333333333';
  if v_not_carls > 0 then
    raise exception 'CHECK 12 FAILED: % of % rows in Carl''s list_my_posts are not Carl''s posts', v_not_carls, v_rows;
  end if;

  -- No uid in the claims (role present, sub absent) -> exactly [].
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  set local role authenticated;
  v_list := public.list_my_posts();
  reset role;
  if v_list is distinct from '[]'::jsonb then
    raise exception 'CHECK 12 FAILED: list_my_posts with no sub in the claims returned %, expected []', v_list;
  end if;

  -- No claims at all -> exactly [].
  perform set_config('request.jwt.claims', null, true);
  set local role authenticated;
  v_list := public.list_my_posts();
  reset role;
  if v_list is distinct from '[]'::jsonb then
    raise exception 'CHECK 12 FAILED: list_my_posts with no claims returned %, expected []', v_list;
  end if;

  -- Restore: Beth unarchives 0018.
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  perform public.set_post_archived('a1a1a1a1-0000-0000-0000-000000000018', false);
  reset role;

  raise notice 'CHECK 12 passed: Carl''s list_my_posts (% rows) holds only his own posts, none of Beth''s; no uid -> []', v_rows;
end $$;


-- --- housekeeping: restore every fixture this file touched ------------------
update public.posts set archived_at = null
where archived_at is not null
  and id in ('a1a1a1a1-0000-0000-0000-000000000018',
             'a1a1a1a1-0000-0000-0000-000000000017',
             'a1a1a1a1-0000-0000-0000-00000000001e',
             'a1a1a1a1-0000-0000-0000-00000000001f');
