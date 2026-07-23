-- =============================================================================
-- WHAT:  Watchlist safety / RLS verification (NOT a migration — do not place in
--        migrations/).
-- WHY:   "A watch is the watcher's business" is a Tier 1 property: no other
--        user — including the watched post's OWNER — may ever see watcher rows
--        or counts, and closed posts must stop flowing to watchers per the
--        closed_at 30-day / tombstone rules in 20260722100000_watchlist.sql.
-- LINKS: supabase/migrations/20260722100000_watchlist.sql, docs/DOMAIN.md,
--        docs/SECURITY_AND_TRUST.md §2/§6, scripts/test-db.sh.
--
-- SELF-ASSERTING: every check is a DO block that RAISES EXCEPTION on failure,
-- so the whole file aborts non-zero the moment a property is violated
-- (psql -v ON_ERROR_STOP=1). On success each block emits a NOTICE.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset
--     psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/watchlist_verification.sql
--
-- Fixtures used (from supabase/seed.sql; closed rows get closed_at from the
-- posts_set_closed_at INSERT trigger at seed time):
--   ACTIVE       a1a1a1a1-...0001 ('MA19 XKL', £250) owned by 11111111 (Alex).
--   RECOVERED    a1a1a1a1-...0017 ('MA18 RCV'), recovered_at 3 days ago (in window).
--   RECOVERED    a1a1a1a1-...0021 ('MA99 OLD'), recovered_at 45 days ago (PAST window).
--   EXPIRED      a1a1a1a1-...001f ('MA99 EXP'); closed_at = seed time (window open).
--   CANCELLED    a1a1a1a1-...001e ('MA99 CAN'); closed_at = seed time (window open).
--   RECOVERY_CLAIMED a1a1a1a1-...001d ('MA99 RCL') — hidden state.
--   REJECTED     a1a1a1a1-...0020 ('MA99 REJ') — hidden state (never public).
--   DRAFT trap   a1a1a1a1-...001b ('MA99 DRF') — hidden; must be unwatchable.
--   SYNTHETIC    b2b2b2b2-...0001 ('MA97 OLC') — cancelled with a backdated
--                closed_at (40 days), created BY THIS FILE for the tombstone
--                drop-off case; removed in housekeeping.
--   Watcher:     Beth  22222222 (not the owner of any post above).
--   Bystander:   Carl  33333333 (ends with ZERO watches — RLS zero-row case).
--
-- auth.uid() reads the request.jwt.claims GUC; RLS/grant checks additionally
-- SET LOCAL ROLE authenticated / anon so the GRANT layer applies for real
-- (the technique from anon_role_verification.sql).
--
-- IDEMPOTENCY: all watchlist rows for the fixture users and the synthetic
-- post are deleted up-front AND at the end.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Clean up any leftovers from a previous run of this file.
-- -----------------------------------------------------------------------------
delete from public.watchlist_items
where user_id in ('22222222-2222-2222-2222-222222222222',
                  '33333333-3333-3333-3333-333333333333');
delete from public.posts where id = 'b2b2b2b2-0000-0000-0000-000000000001';


-- -----------------------------------------------------------------------------
-- CHECK 1 — closed_at trigger + drift guard. Seed-time closed rows carry
-- closed_at (recovered mirrors recovered_at); an UPDATE on an already-closed
-- post — including one that tries to SET closed_at — must NOT move it.
-- -----------------------------------------------------------------------------
do $$
declare
  v_before timestamptz;
  v_after  timestamptz;
  v_rec_at timestamptz;
begin
  -- Recovered fixture: closed_at mirrors recovered_at.
  select closed_at, recovered_at into v_before, v_rec_at
  from public.posts where id = 'a1a1a1a1-0000-0000-0000-000000000017';
  if v_before is null or v_before <> v_rec_at then
    raise exception 'CHECK 1 FAILED: recovered post closed_at (%) should mirror recovered_at (%)', v_before, v_rec_at;
  end if;

  -- Expired fixture: closed_at set by the INSERT trigger at seed time.
  select closed_at into v_before
  from public.posts where id = 'a1a1a1a1-0000-0000-0000-00000000001f';
  if v_before is null then
    raise exception 'CHECK 1 FAILED: expired seed post has no closed_at';
  end if;

  -- Drift scenario (a): an ordinary post-close write (moderation edit; the
  -- value written is the seed value, so no restore is needed — the point is
  -- that the UPDATE fires the trigger).
  update public.posts set colour = 'Silver'
  where id = 'a1a1a1a1-0000-0000-0000-00000000001f';
  select closed_at into v_after
  from public.posts where id = 'a1a1a1a1-0000-0000-0000-00000000001f';
  if v_after <> v_before then
    raise exception 'CHECK 1 FAILED: an edit to a closed post moved closed_at % -> %', v_before, v_after;
  end if;

  -- Drift scenario (b): a write that explicitly supplies closed_at is frozen
  -- back to the old value by the trigger.
  update public.posts set closed_at = now()
  where id = 'a1a1a1a1-0000-0000-0000-00000000001f';
  select closed_at into v_after
  from public.posts where id = 'a1a1a1a1-0000-0000-0000-00000000001f';
  if v_after <> v_before then
    raise exception 'CHECK 1 FAILED: an explicit closed_at write moved it % -> %', v_before, v_after;
  end if;

  raise notice 'CHECK 1 passed: closed_at seeded (mirrors recovered_at) and FROZEN against post-close writes';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 2 — happy path + unique pair. As Beth (REAL authenticated role): watch
-- the active fixture post -> row exists with user_id pinned to the caller; a
-- SECOND insert of the same (user, post) pair raises unique_violation (the
-- composite PK is the identity).
-- -----------------------------------------------------------------------------
do $$
declare
  v_n  int;
  v_ok boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  set local role authenticated;

  insert into public.watchlist_items (user_id, post_id)
  values ('22222222-2222-2222-2222-222222222222',
          'a1a1a1a1-0000-0000-0000-000000000001');

  select count(*) into v_n from public.watchlist_items
  where user_id = '22222222-2222-2222-2222-222222222222'
    and post_id = 'a1a1a1a1-0000-0000-0000-000000000001';
  if v_n <> 1 then
    raise exception 'CHECK 2 FAILED: expected 1 watch row after insert, got %', v_n;
  end if;

  -- Second insert of the SAME pair -> unique_violation from the composite PK.
  begin
    insert into public.watchlist_items (user_id, post_id)
    values ('22222222-2222-2222-2222-222222222222',
            'a1a1a1a1-0000-0000-0000-000000000001');
    raise exception 'CHECK 2 FAILED: duplicate (user, post) watch was accepted';
  exception when unique_violation then
    v_ok := true;
  end;
  reset role;

  if not v_ok then
    raise exception 'CHECK 2 FAILED: duplicate insert did not raise unique_violation';
  end if;
  raise notice 'CHECK 2 passed: own watch inserted once; duplicate pair raises unique_violation';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 3 — insert forces own user_id. As Beth, inserting a watch with
-- user_id = Carl (spoofed) is REJECTED by the with-check (RLS violation
-- 42501), and no row lands for Carl.
-- -----------------------------------------------------------------------------
do $$
declare
  v_ok boolean := false;
  v_n  int;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  begin
    set local role authenticated;
    insert into public.watchlist_items (user_id, post_id)
    values ('33333333-3333-3333-3333-333333333333',   -- spoofed: not the caller
            'a1a1a1a1-0000-0000-0000-000000000001');
    reset role;
    raise exception 'CHECK 3 FAILED: a spoofed user_id was accepted';
  exception when insufficient_privilege then
    v_ok := true;  -- 42501; sub-block rollback also reverts the role
  end;

  select count(*) into v_n from public.watchlist_items
  where user_id = '33333333-3333-3333-3333-333333333333';
  if not v_ok or v_n <> 0 then
    raise exception 'CHECK 3 FAILED: spoof rejected=% carl_rows=%', v_ok, v_n;
  end if;
  raise notice 'CHECK 3 passed: insert with a spoofed user_id is RLS-rejected (42501)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 4 — see-before-watch. As Beth: watching the DRAFT trap post and the
-- EXPIRED post are both RLS-rejected (hidden/closed posts are unwatchable —
-- no status oracle); watching the in-window RECOVERED post succeeds (it is
-- still publicly visible per the 30-day social-proof window).
-- -----------------------------------------------------------------------------
do $$
declare
  v_draft   boolean := false;
  v_expired boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  begin
    set local role authenticated;
    insert into public.watchlist_items (user_id, post_id)
    values ('22222222-2222-2222-2222-222222222222',
            'a1a1a1a1-0000-0000-0000-00000000001b');   -- DRAFT trap
    reset role;
    raise exception 'CHECK 4 FAILED: a DRAFT post was watchable';
  exception when insufficient_privilege then
    v_draft := true;
  end;

  begin
    set local role authenticated;
    insert into public.watchlist_items (user_id, post_id)
    values ('22222222-2222-2222-2222-222222222222',
            'a1a1a1a1-0000-0000-0000-00000000001f');   -- EXPIRED
    reset role;
    raise exception 'CHECK 4 FAILED: an EXPIRED post was watchable';
  exception when insufficient_privilege then
    v_expired := true;
  end;

  -- Recovered within its 30-day public window: allowed.
  set local role authenticated;
  insert into public.watchlist_items (user_id, post_id)
  values ('22222222-2222-2222-2222-222222222222',
          'a1a1a1a1-0000-0000-0000-000000000017');
  reset role;

  if not (v_draft and v_expired) then
    raise exception 'CHECK 4 FAILED: draft=% expired=% not both rejected', v_draft, v_expired;
  end if;
  raise notice 'CHECK 4 passed: draft/expired posts unwatchable; in-window recovered post watchable';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 5 — RLS zero-row cases. Carl (another authenticated user) sees ZERO
-- watch rows; anon SELECT and INSERT are grant-denied (42501); and the watched
-- post's OWNER (Alex) also sees ZERO raw rows — a watch is never owner-facing.
-- -----------------------------------------------------------------------------
do $$
declare
  v_n      int;
  v_denied int := 0;
begin
  -- Carl: zero rows (Beth has 2 by now).
  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
    true);
  set local role authenticated;
  select count(*) into v_n from public.watchlist_items;
  reset role;
  if v_n <> 0 then
    raise exception 'CHECK 5 FAILED: another user can see % watch row(s)', v_n;
  end if;

  -- The OWNER of the watched posts (Alex, 11111111): zero rows too.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true);
  set local role authenticated;
  select count(*) into v_n from public.watchlist_items;
  reset role;
  if v_n <> 0 then
    raise exception 'CHECK 5 FAILED: the post OWNER can see % watcher row(s) — watches must never be owner-facing', v_n;
  end if;

  -- anon: SELECT and INSERT both grant-denied (42501).
  perform set_config('request.jwt.claims', null, true);
  begin
    set local role anon;
    select count(*) into v_n from public.watchlist_items;
    reset role;
    raise exception 'CHECK 5 FAILED: anon SELECT was NOT grant-denied (saw % row(s))', v_n;
  exception when insufficient_privilege then
    v_denied := v_denied + 1;
  end;
  begin
    set local role anon;
    insert into public.watchlist_items (user_id, post_id)
    values ('22222222-2222-2222-2222-222222222222',
            'a1a1a1a1-0000-0000-0000-000000000001');
    reset role;
    raise exception 'CHECK 5 FAILED: anon INSERT was NOT grant-denied';
  exception when insufficient_privilege then
    v_denied := v_denied + 1;
  end;
  if v_denied <> 2 then
    raise exception 'CHECK 5 FAILED: expected 2 anon grant denials, got %', v_denied;
  end if;

  raise notice 'CHECK 5 passed: other users / the post owner see zero rows; anon is grant-denied';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 6 — get_my_watchlist visibility matrix. Setup (as postgres, bypassing
-- RLS — simulating watches created while those posts were still watchable):
-- Beth also watches
--   * the EXPIRED post ...1f                    (tombstone case),
--   * the CANCELLED post ...1e                  (tombstone case — cancelled),
--   * the 45-day-old RECOVERED post ...21       (past-window: ABSENT),
--   * a synthetic CANCELLED post closed 40 days ago (tombstone drop-off: ABSENT),
--   * the RECOVERY_CLAIMED post ...1d           (hidden state: ABSENT),
--   * the REJECTED post ...20                   (hidden state: ABSENT),
--   * the DRAFT trap ...1b                      (hidden state: ABSENT).
-- Then, as Beth under the REAL authenticated role, exactly 4 items return:
--   active (full, resolved_at null), recovered<30d (full, resolved_at set),
--   expired<30d + cancelled<30d (NULLed tombstones), newest watch first.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc  jsonb;
  v_item jsonb;
begin
  -- Synthetic long-closed cancelled post (backdated closed_at honoured on
  -- INSERT by the trigger — a server-side-only path; clients hold no grant on
  -- closed_at and can only insert drafts).
  insert into public.posts (id, owner_id, status, bounty_amount_pence,
                            plate, make, model, colour, closed_at)
  values ('b2b2b2b2-0000-0000-0000-000000000001',
          '44444444-4444-4444-4444-444444444444', 'cancelled', 20000,
          'MA97 OLC', 'Seat', 'Ibiza', 'Green', now() - interval '40 days');

  insert into public.watchlist_items (user_id, post_id, created_at)
  values
    ('22222222-2222-2222-2222-222222222222',
     'a1a1a1a1-0000-0000-0000-00000000001f', now() - interval '40 days'),
    ('22222222-2222-2222-2222-222222222222',
     'a1a1a1a1-0000-0000-0000-00000000001e', now()),
    ('22222222-2222-2222-2222-222222222222',
     'a1a1a1a1-0000-0000-0000-000000000021', now() - interval '50 days'),
    ('22222222-2222-2222-2222-222222222222',
     'b2b2b2b2-0000-0000-0000-000000000001', now() - interval '41 days'),
    ('22222222-2222-2222-2222-222222222222',
     'a1a1a1a1-0000-0000-0000-00000000001d', now()),
    ('22222222-2222-2222-2222-222222222222',
     'a1a1a1a1-0000-0000-0000-000000000020', now()),
    ('22222222-2222-2222-2222-222222222222',
     'a1a1a1a1-0000-0000-0000-00000000001b', now());

  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  set local role authenticated;
  v_doc := public.get_my_watchlist();
  reset role;

  if jsonb_typeof(v_doc) <> 'array' or jsonb_array_length(v_doc) <> 4 then
    raise exception 'CHECK 6 FAILED: expected 4 items (active, recovered<30d, expired+cancelled tombstones), got %', v_doc;
  end if;

  -- ABSENCE: past-window recovered, past-window cancelled, and every hidden
  -- state (recovery_claimed / rejected / draft) must not appear at all.
  if v_doc::text like '%000000000021%' or v_doc::text like '%MA99 OLD%' then
    raise exception 'CHECK 6 FAILED: 45-day-old recovered post leaked into the payload';
  end if;
  if v_doc::text like '%b2b2b2b2%' or v_doc::text like '%MA97 OLC%' then
    raise exception 'CHECK 6 FAILED: a cancelled post closed 40 days ago leaked (tombstone must drop off at +30d)';
  end if;
  if v_doc::text like '%00000000001d%' or v_doc::text like '%MA99 RCL%'
     or v_doc::text like '%000000000020%' or v_doc::text like '%MA99 REJ%'
     or v_doc::text like '%00000000001b%' or v_doc::text like '%MA99 DRF%' then
    raise exception 'CHECK 6 FAILED: a hidden-state post (recovery_claimed/rejected/draft) leaked: %', v_doc;
  end if;

  -- Ordering: newest watch first; the 40-day-old watch (expired tombstone)
  -- must be last.
  if (v_doc -> 0 ->> 'watched_at')::timestamptz < (v_doc -> 3 ->> 'watched_at')::timestamptz then
    raise exception 'CHECK 6 FAILED: items not ordered newest watch first';
  end if;
  if (v_doc -> 3 ->> 'id') <> 'a1a1a1a1-0000-0000-0000-00000000001f' then
    raise exception 'CHECK 6 FAILED: oldest watch (the expired tombstone) is not last: %', v_doc -> 3;
  end if;

  -- ACTIVE post: full payload, resolved_at null.
  select item into v_item
  from jsonb_array_elements(v_doc) as item
  where item ->> 'id' = 'a1a1a1a1-0000-0000-0000-000000000001';
  if v_item is null
     or (v_item ->> 'plate') <> 'MA19 XKL'
     or (v_item ->> 'bounty_amount_pence')::int <> 25000
     or (v_item ->> 'status') <> 'active'
     or (v_item -> 'resolved_at') <> 'null'::jsonb
     or (v_item ->> 'watched_at') is null then
    raise exception 'CHECK 6 FAILED: active item wrong: %', v_item;
  end if;

  -- RECOVERED within 30 days: full payload + resolved_at = closed_at.
  select item into v_item
  from jsonb_array_elements(v_doc) as item
  where item ->> 'id' = 'a1a1a1a1-0000-0000-0000-000000000017';
  if v_item is null
     or (v_item ->> 'plate') <> 'MA18 RCV'
     or (v_item ->> 'status') <> 'recovered'
     or (v_item ->> 'resolved_at') is null then
    raise exception 'CHECK 6 FAILED: in-window recovered item wrong: %', v_item;
  end if;

  -- EXPIRED within 30 days of closed_at: TOMBSTONE with the sensitive fields
  -- explicitly NULLed.
  select item into v_item
  from jsonb_array_elements(v_doc) as item
  where item ->> 'id' = 'a1a1a1a1-0000-0000-0000-00000000001f';
  if v_item is null
     or (v_item ->> 'status') <> 'expired'
     or (v_item ->> 'make')   <> 'Ford'
     or (v_item ->> 'model')  <> 'Ka'
     or (v_item ->> 'resolved_at') is null
     or (v_item ->> 'watched_at')  is null then
    raise exception 'CHECK 6 FAILED: expired tombstone identity fields wrong: %', v_item;
  end if;
  if (v_item -> 'plate')                  <> 'null'::jsonb
     or (v_item -> 'bounty_amount_pence') <> 'null'::jsonb
     or (v_item -> 'last_seen_at')        <> 'null'::jsonb
     or (v_item -> 'last_seen_area')      <> 'null'::jsonb then
    raise exception 'CHECK 6 FAILED: expired tombstone leaks a sensitive field: %', v_item;
  end if;
  if v_item::text like '%MA99 EXP%' then
    raise exception 'CHECK 6 FAILED: expired tombstone payload text contains the plate';
  end if;

  -- CANCELLED within 30 days of closed_at: same tombstone rules.
  select item into v_item
  from jsonb_array_elements(v_doc) as item
  where item ->> 'id' = 'a1a1a1a1-0000-0000-0000-00000000001e';
  if v_item is null
     or (v_item ->> 'status') <> 'cancelled'
     or (v_item ->> 'make')   <> 'Toyota'
     or (v_item ->> 'model')  <> 'Yaris'
     or (v_item ->> 'resolved_at') is null then
    raise exception 'CHECK 6 FAILED: cancelled tombstone identity fields wrong: %', v_item;
  end if;
  if (v_item -> 'plate')                  <> 'null'::jsonb
     or (v_item -> 'bounty_amount_pence') <> 'null'::jsonb
     or (v_item -> 'last_seen_at')        <> 'null'::jsonb
     or (v_item -> 'last_seen_area')      <> 'null'::jsonb
     or v_item::text like '%MA99 CAN%' then
    raise exception 'CHECK 6 FAILED: cancelled tombstone leaks a sensitive field: %', v_item;
  end if;

  raise notice 'CHECK 6 passed: 4 items — full active/recovered, NULLed expired+cancelled tombstones; past-window and hidden states absent; newest-first';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 7 — get_my_watchlist isolation + anon. Carl gets [] (never Beth's
-- rows); anon EXECUTE is grant-denied (42501 — any OTHER error means the body
-- ran, the 20260713191000 incident class).
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
    true);
  set local role authenticated;
  v_doc := public.get_my_watchlist();
  reset role;
  if v_doc <> '[]'::jsonb then
    raise exception 'CHECK 7 FAILED: another user''s call returned %', v_doc;
  end if;

  perform set_config('request.jwt.claims', null, true);
  begin
    set local role anon;
    perform public.get_my_watchlist();
    reset role;
    raise exception 'CHECK 7 FAILED: anon EXECUTE on get_my_watchlist was NOT grant-denied';
  exception
    when insufficient_privilege then null;  -- expected 42501
    when others then
      raise exception 'CHECK 7 FAILED: get_my_watchlist as anon raised "%" (SQLSTATE %) — its body ran, so anon holds EXECUTE (expected 42501)', sqlerrm, sqlstate;
  end;

  raise notice 'CHECK 7 passed: other users get []; anon is grant-denied on the RPC';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 8 — ABSENCE: no owner-facing query path to watcher rows/counts exists.
-- Proven from the catalogs:
--   (a) anon holds NO privilege on watchlist_items; authenticated holds only
--       SELECT/INSERT/DELETE (no UPDATE);
--   (b) the table's ONLY policies are the three own-row policies, and every
--       one of them predicates on user_id (there is no owner-of-post policy);
--   (c) no view and no function other than get_my_watchlist references
--       watchlist_items anywhere in schema public — so the RPC (which filters
--       to auth.uid()) is the single non-raw read path.
-- -----------------------------------------------------------------------------
do $$
declare
  v_n int;
begin
  -- (a) grant surface.
  if has_table_privilege('anon', 'public.watchlist_items', 'SELECT')
     or has_table_privilege('anon', 'public.watchlist_items', 'INSERT')
     or has_table_privilege('anon', 'public.watchlist_items', 'UPDATE')
     or has_table_privilege('anon', 'public.watchlist_items', 'DELETE') then
    raise exception 'CHECK 8 FAILED: anon holds a privilege on watchlist_items';
  end if;
  if has_table_privilege('authenticated', 'public.watchlist_items', 'UPDATE') then
    raise exception 'CHECK 8 FAILED: authenticated holds UPDATE on watchlist_items (nothing to update)';
  end if;

  -- (b) policy surface: exactly 3 policies, all predicated on user_id.
  select count(*) into v_n
  from pg_policies
  where schemaname = 'public' and tablename = 'watchlist_items';
  if v_n <> 3 then
    raise exception 'CHECK 8 FAILED: expected exactly 3 policies on watchlist_items, found %', v_n;
  end if;
  select count(*) into v_n
  from pg_policies
  where schemaname = 'public' and tablename = 'watchlist_items'
    and coalesce(qual, with_check) not like '%user_id%';
  if v_n <> 0 then
    raise exception 'CHECK 8 FAILED: % policy(ies) on watchlist_items do not pin user_id', v_n;
  end if;

  -- (c) no other read path: no view mentions the table; the only function in
  -- schema public whose body mentions it is get_my_watchlist.
  select count(*) into v_n
  from pg_views
  where definition ilike '%watchlist_items%';
  if v_n <> 0 then
    raise exception 'CHECK 8 FAILED: % view(s) reference watchlist_items', v_n;
  end if;
  select count(*) into v_n
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosrc ilike '%watchlist_items%'
    and p.proname <> 'get_my_watchlist';
  if v_n <> 0 then
    raise exception 'CHECK 8 FAILED: % other function(s) reference watchlist_items — a second query path exists', v_n;
  end if;

  raise notice 'CHECK 8 passed: no grant, policy, view, or function gives anyone but the watcher a path to watch rows/counts';
end $$;


-- -----------------------------------------------------------------------------
-- Housekeeping: remove this file's watches and the synthetic post so the seed
-- state stays as-is for other test files and re-runs.
-- -----------------------------------------------------------------------------
delete from public.watchlist_items
where user_id in ('22222222-2222-2222-2222-222222222222',
                  '33333333-3333-3333-3333-333333333333');
delete from public.posts where id = 'b2b2b2b2-0000-0000-0000-000000000001';
