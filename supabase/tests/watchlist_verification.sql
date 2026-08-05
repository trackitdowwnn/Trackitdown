-- =============================================================================
-- WHAT:  Watchlist safety / RLS verification (NOT a migration — do not place in
--        migrations/).
-- WHY:   "A watch is the watcher's business" is a Tier 1 property: no other
--        user — including the watched post's OWNER — may ever see watcher rows
--        or counts, and closed posts must stop flowing to watchers per the
--        closed_at 30-day / tombstone rules in 20260722100000_watchlist.sql.
--        COLLECTIONS (2026-07-27) extended that: a collection NAME is private
--        free text under the same rule, and the "move a car between lists"
--        feature required granting UPDATE — which is only safe because the
--        grant is a COLUMN LIST. CHECK 11 is what proves it still is.
-- LINKS: supabase/migrations/20260722100000_watchlist.sql,
--        supabase/migrations/20260801110000_watchlist_collections.sql,
--        docs/DOMAIN.md (watchlist carve-out + collections clause),
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
-- IDEMPOTENCY: all watchlist rows AND collections for the fixture users, plus
-- the synthetic post, are deleted up-front AND at the end.
--
-- CHECKS: 1 closed_at freeze · 2 own watch + unique pair · 2b one collection per
-- post · 3 spoofed user_id · 4 see-before-watch · 5 RLS zero-row · 6 the
-- get_my_watchlist visibility matrix · 7 isolation + anon · 8 ABSENCE (grants,
-- policies, views, functions — for both tables) · 9 no cross-user filing ·
-- 10 deleting a list keeps its cars · 11 the UPDATE grant is not a
-- see-before-act bypass · 12 cap, per-user names, no existence oracle.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Clean up any leftovers from a previous run of this file.
-- -----------------------------------------------------------------------------
delete from public.watchlist_items
where user_id in ('22222222-2222-2222-2222-222222222222',
                  '33333333-3333-3333-3333-333333333333');
-- Collections too (CHECKs 2b/9/10/12 create them). Dropping them cannot orphan
-- a watch — the FK is ON DELETE SET NULL — and the watches go above anyway.
delete from public.watchlist_collections
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
-- CHECK 2b — ONE COLLECTION PER POST. The same post cannot be saved twice into
-- different collections: the (user_id, post_id) primary key already forbids it,
-- which is exactly why collections could be added without touching the key.
-- This asserts the PRODUCT rule so nobody later "fixes" the PK and quietly turns
-- collections into tags — which would also make unwatch ambiguous.
-- -----------------------------------------------------------------------------
do $$
declare
  v_a  uuid;
  v_b  uuid;
  v_ok boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  v_a := (public.create_watchlist_collection('Rule list A') ->> 'collection_id')::uuid;
  v_b := (public.create_watchlist_collection('Rule list B') ->> 'collection_id')::uuid;

  set local role authenticated;
  -- The post is already watched by CHECK 2; file it into A.
  update public.watchlist_items set collection_id = v_a
   where user_id = '22222222-2222-2222-2222-222222222222'
     and post_id = 'a1a1a1a1-0000-0000-0000-000000000001';

  begin
    insert into public.watchlist_items (user_id, post_id, collection_id)
    values ('22222222-2222-2222-2222-222222222222',
            'a1a1a1a1-0000-0000-0000-000000000001', v_b);
    raise exception 'CHECK 2b FAILED: the same post was saved into two collections';
  exception when unique_violation then
    v_ok := true;
  end;
  reset role;

  if not v_ok then
    raise exception 'CHECK 2b FAILED: one-collection-per-post is not enforced';
  end if;

  -- Tidy: return it to Saved so later checks see the original shape.
  update public.watchlist_items set collection_id = null
   where user_id = '22222222-2222-2222-2222-222222222222'
     and post_id = 'a1a1a1a1-0000-0000-0000-000000000001';
  delete from public.watchlist_collections where id in (v_a, v_b);

  raise notice 'CHECK 2b passed: a post lives in at most ONE collection (enforced by the existing PK)';
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
  -- The visibility rule MOVED (20260802180000): the policy no longer contains
  -- the inline EXISTS block that 20260801110000 said must never be paraphrased
  -- — it delegates to post_is_watchable. Pin both halves from the catalogue,
  -- because the rule can now be widened by editing one function body that no
  -- other assertion names.
  if (select with_check from pg_policies
      where tablename = 'watchlist_items'
        and policyname = 'watchlist_items_insert_own_visible_post')
     not like '%post_is_watchable%' then
    raise exception 'CHECK 4 FAILED: the insert gate no longer delegates to post_is_watchable';
  end if;

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'post_is_watchable'
      and (p.prosrc like '%draft%' or p.prosrc like '%expired%'
           or p.prosrc like '%cancelled%' or p.prosrc like '%rejected%'
           or p.prosrc like '%recovery_claimed%' or p.prosrc like '%pending_verification%')
  ) then
    raise exception 'CHECK 4 FAILED: post_is_watchable was widened to a hidden status';
  end if;

  -- SECURITY DEFINER is load-bearing, not incidental: without it the posts
  -- scan reverts to the caller's RLS and the recovered branch dies again.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'post_is_watchable' and p.prosecdef
  ) then
    raise exception 'CHECK 4 FAILED: post_is_watchable is no longer SECURITY DEFINER';
  end if;

  raise notice 'CHECK 4 passed: draft/expired posts unwatchable; in-window recovered post watchable; gate delegates to a SECURITY DEFINER post_is_watchable pinned to two statuses';
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

  -- collection_id must be present on BOTH payload shapes (added 2026-07-27).
  -- The client groups the single response into the grid, each list and the
  -- most-recently-used target, so a missing key on either shape silently files
  -- everything into "Saved" — and on the tombstone shape it would drop a closed
  -- car out of the list it was filed in.
  if not (v_doc -> 0 ? 'collection_id') then
    raise exception 'CHECK 6 FAILED: full payload is missing collection_id';
  end if;
  if not (v_item ? 'collection_id') then
    raise exception 'CHECK 6 FAILED: tombstone payload is missing collection_id';
  end if;

  raise notice 'CHECK 6 passed: 4 items — full active/recovered, NULLed expired+cancelled tombstones; collection_id on both shapes; past-window and hidden states absent; newest-first';
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
--   (a) anon holds NO privilege on watchlist_items; authenticated holds
--       SELECT/INSERT/DELETE plus UPDATE on collection_id ONLY (see below);
--   (b) the table's ONLY policies are the four own-row policies, and every
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
  -- UPDATE exists now (collections need a "move"), but ONLY on collection_id.
  -- This replaced a blanket "no UPDATE at all" assertion when collections
  -- shipped (2026-07-27), and is deliberately STRONGER than what it replaced:
  -- the column list is a security control. A grant covering post_id would be a
  -- complete see-before-act BYPASS — watch a visible post, then repoint the row
  -- at a draft you cannot read, with the insert policy never consulted.
  if not has_column_privilege('authenticated', 'public.watchlist_items', 'collection_id', 'UPDATE') then
    raise exception 'CHECK 8 FAILED: authenticated cannot UPDATE collection_id — moving between collections is broken';
  end if;
  if has_column_privilege('authenticated', 'public.watchlist_items', 'post_id', 'UPDATE') then
    raise exception 'CHECK 8 FAILED: authenticated holds UPDATE on post_id — SEE-BEFORE-ACT BYPASS';
  end if;
  if has_column_privilege('authenticated', 'public.watchlist_items', 'user_id', 'UPDATE') then
    raise exception 'CHECK 8 FAILED: authenticated holds UPDATE on user_id — a watch could be handed to another user';
  end if;
  if has_column_privilege('authenticated', 'public.watchlist_items', 'created_at', 'UPDATE') then
    raise exception 'CHECK 8 FAILED: authenticated holds UPDATE on created_at — the list sort key is client-writable';
  end if;

  -- (b) policy surface: exactly 4 policies, all predicated on user_id.
  select count(*) into v_n
  from pg_policies
  where schemaname = 'public' and tablename = 'watchlist_items';
  if v_n <> 4 then
    raise exception 'CHECK 8 FAILED: expected exactly 4 policies on watchlist_items, found %', v_n;
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
    -- The allowlist. get_my_watchlist is the one CLIENT path.
    -- claim_recovery_notifications (20260806) reads watch rows to build the
    -- "your watched car was recovered" audience — SERVICE ROLE ONLY (grants
    -- asserted in notification_center_verification CHECK 7), so the property
    -- this check protects — no path by which anyone but the watcher reaches
    -- watch rows — still holds. Anything else appearing here is a finding.
    and p.proname not in ('get_my_watchlist', 'claim_recovery_notifications');
  if v_n <> 0 then
    raise exception 'CHECK 8 FAILED: % other function(s) reference watchlist_items — a second query path exists', v_n;
  end if;

  -- (d) the SAME absence proof for watchlist_collections. A collection name is
  -- private free text; nobody but its owner may reach it by any path.
  if has_table_privilege('anon', 'public.watchlist_collections', 'SELECT')
     or has_table_privilege('anon', 'public.watchlist_collections', 'INSERT')
     or has_table_privilege('anon', 'public.watchlist_collections', 'UPDATE')
     or has_table_privilege('anon', 'public.watchlist_collections', 'DELETE') then
    raise exception 'CHECK 8 FAILED: anon holds a privilege on watchlist_collections';
  end if;
  -- Clients read only; every write goes through a SECURITY DEFINER RPC so the
  -- per-user cap can be enforced.
  if has_table_privilege('authenticated', 'public.watchlist_collections', 'INSERT')
     or has_table_privilege('authenticated', 'public.watchlist_collections', 'UPDATE')
     or has_table_privilege('authenticated', 'public.watchlist_collections', 'DELETE') then
    raise exception 'CHECK 8 FAILED: authenticated can write watchlist_collections directly — the 20-cap is bypassable';
  end if;

  select count(*) into v_n
  from pg_policies
  where schemaname = 'public' and tablename = 'watchlist_collections';
  if v_n <> 1 then
    raise exception 'CHECK 8 FAILED: expected exactly 1 policy on watchlist_collections, found %', v_n;
  end if;
  select count(*) into v_n
  from pg_policies
  where schemaname = 'public' and tablename = 'watchlist_collections'
    and coalesce(qual, with_check) not like '%user_id%';
  if v_n <> 0 then
    raise exception 'CHECK 8 FAILED: a policy on watchlist_collections does not pin user_id';
  end if;

  select count(*) into v_n
  from pg_views
  where definition ilike '%watchlist_collections%';
  if v_n <> 0 then
    raise exception 'CHECK 8 FAILED: % view(s) reference watchlist_collections', v_n;
  end if;

  -- post_is_watchable is SECURITY DEFINER (it bypasses posts RLS so the
  -- insert gate's recovered branch can evaluate at all). Both directions are
  -- asserted. anon: this project ships ALTER DEFAULT PRIVILEGES granting
  -- EXECUTE on new functions to anon, so every CREATE re-opens it and only an
  -- explicit REVOKE closes it — the exact incident behind 20260713191000.
  if has_function_privilege('anon', 'public.post_is_watchable(uuid)', 'EXECUTE') then
    raise exception 'CHECK 8 FAILED: anon holds EXECUTE on post_is_watchable';
  end if;
  -- authenticated: a policy expression is evaluated AS THE CALLER, so losing
  -- this grant fails the gate closed and breaks watching entirely.
  if not has_function_privilege('authenticated', 'public.post_is_watchable(uuid)', 'EXECUTE') then
    raise exception 'CHECK 8 FAILED: authenticated lost EXECUTE on post_is_watchable — the insert gate cannot evaluate';
  end if;

  raise notice 'CHECK 8 passed: no grant, policy, view, or function gives anyone but the watcher a path to watch rows/counts or collection names; post_is_watchable is authenticated-only';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 9 — a watch can never be filed into ANOTHER USER'S collection, on
-- either write path. Beth owns the watch; Carl owns the collection.
-- -----------------------------------------------------------------------------
do $$
declare
  v_carl_collection uuid;
  v_ok              boolean;
begin
  -- Carl makes a list.
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  v_carl_collection := (public.create_watchlist_collection('Carls private list') ->> 'collection_id')::uuid;

  -- Beth tries to file a NEW watch into it.
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  v_ok := false;
  begin
    set local role authenticated;
    insert into public.watchlist_items (user_id, post_id, collection_id)
    values ('22222222-2222-2222-2222-222222222222',
            'b2b2b2b2-0000-0000-0000-000000000001',
            v_carl_collection);
    reset role;
  exception when insufficient_privilege or foreign_key_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception 'CHECK 9 FAILED: a watch was inserted into another user''s collection';
  end if;

  -- ...and to MOVE an existing watch into it.
  insert into public.watchlist_items (user_id, post_id)
  values ('22222222-2222-2222-2222-222222222222', 'b2b2b2b2-0000-0000-0000-000000000001')
  on conflict do nothing;

  v_ok := false;
  begin
    set local role authenticated;
    update public.watchlist_items
       set collection_id = v_carl_collection
     where user_id = '22222222-2222-2222-2222-222222222222'
       and post_id = 'b2b2b2b2-0000-0000-0000-000000000001';
    reset role;
  exception when insufficient_privilege or foreign_key_violation then v_ok := true;
  end;
  if not v_ok then
    -- An UPDATE filtered out by RLS affects 0 rows rather than raising, so the
    -- silent-no-op case has to be caught by reading the row back.
    if exists (
      select 1 from public.watchlist_items
      where user_id = '22222222-2222-2222-2222-222222222222'
        and post_id = 'b2b2b2b2-0000-0000-0000-000000000001'
        and collection_id = v_carl_collection
    ) then
      raise exception 'CHECK 9 FAILED: a watch was MOVED into another user''s collection';
    end if;
  end if;

  raise notice 'CHECK 9 passed: neither insert nor move can file a watch into someone else''s collection';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 10 — deleting a collection NEVER deletes the cars in it. They return to
-- the implicit "Saved" bucket (collection_id IS NULL) via the FK's SET NULL.
-- The delete dialog promises exactly this; if it ever stops being true the
-- feature lies about destroying data.
-- -----------------------------------------------------------------------------
do $$
declare
  v_collection uuid;
  v_n          int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

  v_collection := (public.create_watchlist_collection('Doomed list') ->> 'collection_id')::uuid;

  insert into public.watchlist_items (user_id, post_id, collection_id)
  values ('22222222-2222-2222-2222-222222222222',
          'b2b2b2b2-0000-0000-0000-000000000001', v_collection)
  on conflict (user_id, post_id) do update set collection_id = excluded.collection_id;

  perform public.delete_watchlist_collection(v_collection);

  select count(*) into v_n
  from public.watchlist_items
  where user_id = '22222222-2222-2222-2222-222222222222'
    and post_id = 'b2b2b2b2-0000-0000-0000-000000000001';
  if v_n <> 1 then
    raise exception 'CHECK 10 FAILED: deleting a collection DELETED the watch (expected it to survive)';
  end if;

  select count(*) into v_n
  from public.watchlist_items
  where user_id = '22222222-2222-2222-2222-222222222222'
    and post_id = 'b2b2b2b2-0000-0000-0000-000000000001'
    and collection_id is null;
  if v_n <> 1 then
    raise exception 'CHECK 10 FAILED: the watch did not fall back to Saved (collection_id should be NULL)';
  end if;

  raise notice 'CHECK 10 passed: deleting a collection returns its cars to Saved and destroys nothing';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 11 — THE UPDATE GRANT IS NOT A SEE-BEFORE-ACT BYPASS.
-- The highest-value check in this file. `grant update (collection_id)` was added
-- so a car can be moved between lists. If that grant ever widens to post_id, a
-- user could watch any visible post and then repoint the row at a DRAFT they
-- cannot read — watching a hidden post with the insert policy never consulted.
-- -----------------------------------------------------------------------------
do $$
declare
  -- The seed's DRAFT trap ('MA99 DRF') — the same post CHECK 4 proves is
  -- unwatchable through the insert path. If the UPDATE path can reach it, the
  -- insert gate is decorative.
  v_draft uuid := 'a1a1a1a1-0000-0000-0000-00000000001b';
  v_ok    boolean := false;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

  if not exists (select 1 from public.posts where id = v_draft and status = 'draft') then
    raise exception 'CHECK 11 SETUP FAILED: the seeded draft trap is missing or no longer a draft';
  end if;

  insert into public.watchlist_items (user_id, post_id)
  values ('22222222-2222-2222-2222-222222222222', 'b2b2b2b2-0000-0000-0000-000000000001')
  on conflict do nothing;

  begin
    set local role authenticated;
    update public.watchlist_items
       set post_id = v_draft
     where user_id = '22222222-2222-2222-2222-222222222222'
       and post_id = 'b2b2b2b2-0000-0000-0000-000000000001';
    reset role;
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then
    raise exception 'CHECK 11 FAILED: authenticated repointed a watch at another post — SEE-BEFORE-ACT BYPASS';
  end if;

  -- Scoped to the row this check actually touched. A blanket "no row anywhere
  -- points at the draft" is wrong here: CHECK 6 deliberately plants exactly
  -- such a row as postgres (bypassing RLS) to prove get_my_watchlist HIDES
  -- drafts, and it is still present. The property under test is that the
  -- UPDATE did not REPOINT this watch — so assert it still points where it
  -- started. (This assertion never ran until CHECK 4 was fixed.)
  if not exists (
    select 1 from public.watchlist_items
    where user_id = '22222222-2222-2222-2222-222222222222'
      and post_id = 'b2b2b2b2-0000-0000-0000-000000000001'
  ) then
    raise exception 'CHECK 11 FAILED: the watch was repointed away from its original post';
  end if;

  raise notice 'CHECK 11 passed: the UPDATE grant reaches collection_id only — post_id is unreachable';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 12 — collection rules: the cap, per-user (never global) name
-- uniqueness, and no existence oracle for someone else's collection.
-- -----------------------------------------------------------------------------
do $$
declare
  v_i       int;
  v_ok      boolean;
  v_carl_id uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

  -- Clear the decks so the cap arithmetic is exact.
  delete from public.watchlist_collections
  where user_id = '22222222-2222-2222-2222-222222222222';

  for v_i in 1..20 loop
    perform public.create_watchlist_collection('Cap list ' || v_i);
  end loop;

  v_ok := false;
  begin
    perform public.create_watchlist_collection('One too many');
  exception when others then
    if sqlerrm like '%COLLECTION_LIMIT_REACHED%' then v_ok := true;
    else raise exception 'CHECK 12 FAILED: wrong error on the 21st collection: %', sqlerrm; end if;
  end;
  if not v_ok then raise exception 'CHECK 12 FAILED: a 21st collection was created (cap not enforced)'; end if;

  -- Case-insensitive clash within one user. FREE A SLOT FIRST: the cap is
  -- checked BEFORE the name, so attempting this while still at 20 raises
  -- COLLECTION_LIMIT_REACHED and asserts nothing about name uniqueness. (This
  -- line never ran until CHECK 4 was fixed, which is how it survived.)
  delete from public.watchlist_collections
  where user_id = '22222222-2222-2222-2222-222222222222'
    and name = 'Cap list 20';

  v_ok := false;
  begin
    perform public.create_watchlist_collection('cap LIST 1');
  exception when others then
    if sqlerrm like '%COLLECTION_NAME_TAKEN%' then v_ok := true;
    else raise exception 'CHECK 12 FAILED: wrong error on a duplicate name: %', sqlerrm; end if;
  end;
  if not v_ok then raise exception 'CHECK 12 FAILED: one user holds the same collection name twice'; end if;

  -- ...but a DIFFERENT user may hold that same name. A global unique index
  -- would both be wrong and leak the existence of other people's lists.
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  v_carl_id := (public.create_watchlist_collection('Cap list 1') ->> 'collection_id')::uuid;
  if v_carl_id is null then
    raise exception 'CHECK 12 FAILED: a second user could not reuse a collection name';
  end if;

  -- No existence oracle: another user's real id is indistinguishable from a
  -- made-up one.
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  v_ok := false;
  begin
    perform public.rename_watchlist_collection(v_carl_id, 'Mine now');
  exception when others then
    if sqlerrm like '%COLLECTION_NOT_FOUND%' then v_ok := true;
    else raise exception 'CHECK 12 FAILED: wrong error renaming another user''s collection: %', sqlerrm; end if;
  end;
  if not v_ok then raise exception 'CHECK 12 FAILED: another user''s collection was renamed'; end if;

  v_ok := false;
  begin
    perform public.delete_watchlist_collection(v_carl_id);
  exception when others then
    if sqlerrm like '%COLLECTION_NOT_FOUND%' then v_ok := true;
    else raise exception 'CHECK 12 FAILED: wrong error deleting another user''s collection: %', sqlerrm; end if;
  end;
  if not v_ok then raise exception 'CHECK 12 FAILED: another user''s collection was deleted'; end if;

  raise notice 'CHECK 12 passed: cap of 20, per-user case-insensitive names, no cross-user reach and no existence oracle';
end $$;


-- -----------------------------------------------------------------------------
-- Housekeeping: remove this file's watches and the synthetic post so the seed
-- state stays as-is for other test files and re-runs.
-- -----------------------------------------------------------------------------
delete from public.watchlist_items
where user_id in ('22222222-2222-2222-2222-222222222222',
                  '33333333-3333-3333-3333-333333333333');
-- Collections too (CHECKs 2b/9/10/12 create them). Dropping them cannot orphan
-- a watch — the FK is ON DELETE SET NULL — and the watches go above anyway.
delete from public.watchlist_collections
where user_id in ('22222222-2222-2222-2222-222222222222',
                  '33333333-3333-3333-3333-333333333333');
delete from public.posts where id = 'b2b2b2b2-0000-0000-0000-000000000001';
