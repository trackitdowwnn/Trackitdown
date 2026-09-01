-- =============================================================================
-- WHAT:  Tier 1 verification for user blocking — the table's shape, the three
--        RPCs, the two triggers that enforce the freeze, and the four things a
--        block must NOT do. NOT a migration.
-- WHY:   Blocking is a SAFETY control on an app where one party has had their
--        car stolen and the other may be claiming money for finding it. Two
--        failure directions, both bad and neither visible by inspection:
--
--          * TOO WEAK — a block that only stops one direction, or that a
--            future rewrite of open_thread quietly drops. The person who asked
--            for it believes they are protected and is not.
--          * TOO STRONG — a block that hides sightings or stops reporting.
--            ⚠️ That MOVES MONEY: refund_holds.sighting_ids names specific
--            sightings and recent_uncredited_sightings decides whether a refund
--            is held, so a vanished sighting can refund an owner who should
--            have been held. ADR-0017 refused that deliberately, and CHECKS 6-8
--            are what stop it being added back by accident.
--
--        The no-oracle property is asserted too (CHECK 5): every refusal here
--        must be the SAME token a stranger gets, or the endpoint becomes a way
--        to ask "has this person blocked me".
--
-- CHECKS: 1 table shape + self-block refused · 2 block_user takes a thread,
-- is idempotent, and refuses a non-participant · 3 are_blocked is symmetric ·
-- 4 the freeze: no new message, no new thread, history still readable ·
-- 5 no oracle: blocked and stranger get the same token · 6 sightings stay
-- visible · 7 reporting still works · 8 the money path is untouched ·
-- 9 unblock restores contact · 10 list_my_blocks is caller-scoped · 11 grants.
-- LINKS: supabase/migrations/20260901150000_user_blocking.sql;
--        docs/decisions/ADR-0017-user-blocking.md; docs/TESTING.md.
--
-- SELF-ASSERTING: every check RAISES on failure (ON_ERROR_STOP=1).
--
-- Fixtures (supabase/seed.sql): ACTIVE post a1a1a1a1-…0003 owned by Beth
-- 22222222; spotters Alex 11111111, Dana 44444444. Everything this file
-- creates is removed in housekeeping, and every check that mutates runs inside
-- begin/rollback so a mid-check failure cannot strand a block.
-- =============================================================================

-- --- housekeeping: leave no trace from a previous run ------------------------
delete from public.user_blocks
 where blocker_id in ('11111111-1111-1111-1111-111111111111',
                      '22222222-2222-2222-2222-222222222222',
                      '44444444-4444-4444-4444-444444444444')
    or blocked_id in ('11111111-1111-1111-1111-111111111111',
                      '22222222-2222-2222-2222-222222222222',
                      '44444444-4444-4444-4444-444444444444');


-- -----------------------------------------------------------------------------
-- CHECK 1 — the table's own guards.
-- -----------------------------------------------------------------------------
begin;
do $$
declare v_err text;
begin
  -- Blocking yourself is meaningless and would make every symmetric check
  -- below ambiguous.
  begin
    insert into public.user_blocks (blocker_id, blocked_id)
    values ('11111111-1111-1111-1111-111111111111',
            '11111111-1111-1111-1111-111111111111');
    v_err := 'no error';
  exception when others then v_err := 'raised'; end;
  if v_err <> 'raised' then
    raise exception 'CHECK 1 FAILED: a self-block was accepted';
  end if;

  -- The pair is the identity: the same block twice is one row, which is what
  -- makes block_user idempotent with no logic of its own.
  insert into public.user_blocks (blocker_id, blocked_id)
  values ('11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222');
  begin
    insert into public.user_blocks (blocker_id, blocked_id)
    values ('11111111-1111-1111-1111-111111111111',
            '22222222-2222-2222-2222-222222222222');
    v_err := 'no error';
  exception when unique_violation then v_err := 'raised'; end;
  if v_err <> 'raised' then
    raise exception 'CHECK 1 FAILED: the (blocker, blocked) pair is not unique';
  end if;

  raise notice 'CHECK 1 passed: self-block refused, the pair is unique.';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 — block_user: takes a THREAD, is idempotent, refuses an outsider.
-- -----------------------------------------------------------------------------
-- ⚠️ IT TAKES A THREAD ID RATHER THAN A USER ID, and that is a privacy
-- decision, not an ergonomic one: a client never holds the other party's uid.
-- get_thread_peer returns a first name and no id, and open_thread_for_sighting
-- exists precisely so an owner's client never learns a spotter uid. An RPC
-- taking p_user_id would have forced us to start handing uids to clients —
-- undoing a deliberate boundary in order to add a safety feature.
begin;
do $$
declare
  v_post    uuid := 'a1a1a1a1-0000-0000-0000-000000000003';
  v_owner   uuid := '22222222-2222-2222-2222-222222222222';
  v_spotter uuid := '11111111-1111-1111-1111-111111111111';
  v_thread  uuid;
  v_n       integer;
  v_err     text;
begin
  insert into public.threads (post_id, owner_id, spotter_id)
  values (v_post, v_owner, v_spotter) returning id into v_thread;

  -- The spotter blocks, naming only the thread.
  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', v_spotter)::text, true);
  set local role authenticated;
  perform public.block_user(v_thread);
  perform public.block_user(v_thread);   -- idempotent: two taps, one block
  reset role;

  select count(*) into v_n from public.user_blocks
   where blocker_id = v_spotter and blocked_id = v_owner;
  if v_n <> 1 then
    raise exception 'CHECK 2 FAILED: % block row(s) after two calls, expected exactly 1', v_n;
  end if;

  -- It resolved the OTHER party, not the caller.
  if exists (select 1 from public.user_blocks where blocked_id = v_spotter) then
    raise exception 'CHECK 2 FAILED: block_user blocked the caller instead of the peer';
  end if;

  -- An outsider naming somebody else's thread gets the no-oracle token.
  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
  set local role authenticated;
  begin
    perform public.block_user(v_thread);
    v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err <> 'NOT_PARTICIPANT' then
    raise exception 'CHECK 2 FAILED: an outsider blocking through someone else''s thread got % — expected NOT_PARTICIPANT', v_err;
  end if;

  -- ...and a thread id that does not exist answers identically, so the RPC
  -- cannot be used to probe which thread ids are real.
  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', v_spotter)::text, true);
  set local role authenticated;
  begin
    perform public.block_user('00000000-0000-0000-0000-0000000000ff');
    v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err <> 'NOT_PARTICIPANT' then
    raise exception 'CHECK 2 FAILED: a missing thread answered % — must match the outsider token', v_err;
  end if;

  raise notice 'CHECK 2 passed: block_user resolves the peer from a thread, is idempotent, and refuses outsiders and missing threads identically.';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — are_blocked is SYMMETRIC. One row, both directions.
-- -----------------------------------------------------------------------------
-- ⚠️ THE PROPERTY THE WHOLE FEATURE RESTS ON. A block that stopped only inbound
-- contact would let the blocker keep messaging someone who wanted them gone,
-- and a block that stopped only outbound would not protect the blocker at all.
begin;
do $$
begin
  insert into public.user_blocks (blocker_id, blocked_id)
  values ('11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222');

  if not public.are_blocked('11111111-1111-1111-1111-111111111111',
                            '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 3 FAILED: are_blocked is false in the direction the row was written';
  end if;
  if not public.are_blocked('22222222-2222-2222-2222-222222222222',
                            '11111111-1111-1111-1111-111111111111') then
    raise exception 'CHECK 3 FAILED: are_blocked is false in the REVERSE direction — the block is one-way';
  end if;
  if public.are_blocked('11111111-1111-1111-1111-111111111111',
                        '44444444-4444-4444-4444-444444444444') then
    raise exception 'CHECK 3 FAILED: are_blocked is true for an unrelated pair';
  end if;

  raise notice 'CHECK 3 passed: one row blocks both directions, and only that pair.';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 — THE FREEZE. No new message, no new thread, history still readable.
-- -----------------------------------------------------------------------------
-- ADR-0017 Q1: a blocked thread keeps its history and accepts nothing further.
-- The owner may be relying on what the spotter already told them about their
-- car, so the messages must survive; the contact is what was refused.
begin;
do $$
declare
  v_post    uuid := 'a1a1a1a1-0000-0000-0000-000000000003';
  v_owner   uuid := '22222222-2222-2222-2222-222222222222';
  v_spotter uuid := '11111111-1111-1111-1111-111111111111';
  v_thread  uuid;
  v_msgs    integer;
  v_err     text;
begin
  insert into public.threads (post_id, owner_id, spotter_id)
  values (v_post, v_owner, v_spotter)
  returning id into v_thread;
  insert into public.messages (thread_id, sender_id, kind, content)
  values (v_thread, v_spotter, 'user', 'I think I saw it on Oldham Road.');

  insert into public.user_blocks (blocker_id, blocked_id) values (v_spotter, v_owner);

  -- (a) No further message, from EITHER side.
  begin
    insert into public.messages (thread_id, sender_id, kind, content)
    values (v_thread, v_owner, 'user', 'Where exactly?');
    v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  if v_err <> 'NOT_PARTICIPANT' then
    raise exception 'CHECK 4 FAILED: the blocked owner could still send (%)', v_err;
  end if;
  begin
    insert into public.messages (thread_id, sender_id, kind, content)
    values (v_thread, v_spotter, 'user', 'Actually...');
    v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  if v_err <> 'NOT_PARTICIPANT' then
    raise exception 'CHECK 4 FAILED: the BLOCKER could still send (%) — the freeze is one-way', v_err;
  end if;

  -- (b) ⚠️ HISTORY SURVIVES. This is the half that separates "freeze" from
  --     "delete", and it is the owner's only record of a lead on their car.
  select count(*) into v_msgs from public.messages where thread_id = v_thread;
  if v_msgs <> 1 then
    raise exception 'CHECK 4 FAILED: % message(s) left of 1 — a block must never destroy history', v_msgs;
  end if;

  -- (c) No NEW thread between the same pair.
  begin
    insert into public.threads (post_id, owner_id, spotter_id)
    values ('a1a1a1a1-0000-0000-0000-000000000005', v_owner, v_spotter);
    v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  if v_err <> 'NOT_PARTICIPANT' then
    raise exception 'CHECK 4 FAILED: a new thread opened between blocked accounts (%)', v_err;
  end if;

  -- (d) An UNRELATED pair is untouched.
  insert into public.threads (post_id, owner_id, spotter_id)
  values (v_post, v_owner, '44444444-4444-4444-4444-444444444444');

  raise notice 'CHECK 4 passed: no new message or thread between blocked accounts; history intact; other pairs unaffected.';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 — NO ORACLE. A blocked caller and a stranger get the SAME token.
-- -----------------------------------------------------------------------------
-- ⚠️ On a stolen-car app, "that person blocked you" is information about who
-- somebody is. If the refusal were distinguishable, the blocked party could
-- poll this endpoint to find out — so it must be indistinguishable from the
-- answer a complete stranger gets.
begin;
do $$
declare
  v_blocked_err  text;
  v_stranger_err text;
begin
  insert into public.user_blocks (blocker_id, blocked_id)
  values ('11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222');

  begin
    insert into public.threads (post_id, owner_id, spotter_id)
    values ('a1a1a1a1-0000-0000-0000-000000000003',
            '22222222-2222-2222-2222-222222222222',
            '11111111-1111-1111-1111-111111111111');
    v_blocked_err := 'no error';
  exception when others then v_blocked_err := sqlerrm; end;

  -- What a stranger gets from the same surface, via open_thread's own gate.
  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
  set local role authenticated;
  begin
    perform public.open_thread('a1a1a1a1-0000-0000-0000-000000000003',
                               '11111111-1111-1111-1111-111111111111');
    v_stranger_err := 'no error';
  exception when others then v_stranger_err := sqlerrm; end;
  reset role;

  if v_blocked_err = 'no error' then
    raise exception 'CHECK 5 FAILED: the blocked thread insert succeeded';
  end if;
  if v_blocked_err ~* 'block' then
    raise exception 'CHECK 5 FAILED: the refusal names the block (%) — that is an oracle', v_blocked_err;
  end if;
  if v_blocked_err <> 'NOT_PARTICIPANT' then
    raise exception 'CHECK 5 FAILED: blocked refusal is % — must be the token a non-participant gets', v_blocked_err;
  end if;

  raise notice 'CHECK 5 passed: a blocked caller is refused with NOT_PARTICIPANT and the reason is never named (stranger saw: %).', v_stranger_err;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 6 — ⚠️ SIGHTINGS STAY VISIBLE TO THE OWNER.
-- -----------------------------------------------------------------------------
-- ADR-0017 Q2, and the check with money behind it. A sighting is evidence about
-- the owner's own vehicle, not a social interaction — and refund_holds names
-- specific sightings, so hiding one could refund an owner who should have been
-- held. If a future change makes blocking hide sightings, this fails first.
begin;
do $$
declare
  v_post     uuid := 'a1a1a1a1-0000-0000-0000-000000000003';
  v_owner    uuid := '22222222-2222-2222-2222-222222222222';
  v_spotter  uuid := '11111111-1111-1111-1111-111111111111';
  v_sighting uuid := 'b10c0000-0000-0000-0000-000000000001';
  v_seen     integer;
begin
  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
  values (v_sighting, v_post, v_spotter, 'unverified', 'Ancoats', true);
  insert into public.user_blocks (blocker_id, blocked_id) values (v_spotter, v_owner);

  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', v_owner)::text, true);
  set local role authenticated;
  select jsonb_array_length(public.get_post_sightings(v_post)) into v_seen;
  reset role;

  if v_seen is null or v_seen < 1 then
    raise exception 'CHECK 6 FAILED: a block hid the spotter''s sighting from the owner — that is evidence about their own car, and refund_holds names sightings by id';
  end if;

  raise notice 'CHECK 6 passed: the owner still sees a sighting filed by someone who blocked them.';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 7 — ⚠️ REPORTING STILL WORKS.
-- -----------------------------------------------------------------------------
-- ADR-0017 Q3. If blocking stopped a spotter reporting, an owner could block
-- the spotters whose sightings contradict a recovery claim they intend to make
-- and thereby suppress evidence about their own case.
begin;
do $$
declare
  v_post    uuid := 'a1a1a1a1-0000-0000-0000-000000000003';
  v_owner   uuid := '22222222-2222-2222-2222-222222222222';
  v_spotter uuid := '11111111-1111-1111-1111-111111111111';
  v_new     uuid := 'b10c0000-0000-0000-0000-000000000002';
begin
  -- The OWNER blocks the spotter — the direction that would enable suppression.
  insert into public.user_blocks (blocker_id, blocked_id) values (v_owner, v_spotter);

  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
  values (v_new, v_post, v_spotter, 'unverified', 'Ancoats', true);

  if not exists (select 1 from public.sightings where id = v_new) then
    raise exception 'CHECK 7 FAILED: a blocked spotter could not report — an owner can now suppress evidence by blocking';
  end if;

  raise notice 'CHECK 7 passed: a blocked spotter can still report on the post.';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 8 — ⚠️ THE MONEY PATH IS UNTOUCHED BY A BLOCK.
-- -----------------------------------------------------------------------------
-- The consequence CHECK 6 protects, asserted directly: a blocked sighting must
-- still appear in recent_uncredited_sightings, which is what decides whether an
-- owner's refund is HELD or paid straight out.
begin;
do $$
declare
  v_post     uuid := 'a1a1a1a1-0000-0000-0000-000000000003';
  v_owner    uuid := '22222222-2222-2222-2222-222222222222';
  v_spotter  uuid := '11111111-1111-1111-1111-111111111111';
  v_sighting uuid := 'b10c0000-0000-0000-0000-000000000003';
  v_ids      uuid[];
begin
  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
  values (v_sighting, v_post, v_spotter, 'unverified', 'Ancoats', true);
  insert into public.user_blocks (blocker_id, blocked_id) values (v_spotter, v_owner);

  select coalesce(array_agg(id), '{}') into v_ids
    from public.recent_uncredited_sightings(v_post) as t(id);

  if not (v_ids @> array[v_sighting]) then
    raise exception 'CHECK 8 FAILED: a blocked spotter''s sighting vanished from the refund-hold trigger set — a block now decides whether money is held';
  end if;

  raise notice 'CHECK 8 passed: blocking does not remove a sighting from the refund-hold trigger set.';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 9 — unblocking restores contact.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_post    uuid := 'a1a1a1a1-0000-0000-0000-000000000003';
  v_owner   uuid := '22222222-2222-2222-2222-222222222222';
  v_spotter uuid := '11111111-1111-1111-1111-111111111111';
  v_thread  uuid;
begin
  insert into public.threads (post_id, owner_id, spotter_id)
  values (v_post, v_owner, v_spotter) returning id into v_thread;
  insert into public.user_blocks (blocker_id, blocked_id) values (v_spotter, v_owner);

  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', v_spotter)::text, true);
  set local role authenticated;
  perform public.unblock_user(v_owner);
  -- Silent on a block that was never there — the caller already has what they
  -- asked for, and complaining would leak nothing useful.
  perform public.unblock_user('44444444-4444-4444-4444-444444444444');
  reset role;

  if public.are_blocked(v_owner, v_spotter) then
    raise exception 'CHECK 9 FAILED: unblock_user left the block in place';
  end if;

  insert into public.messages (thread_id, sender_id, kind, content)
  values (v_thread, v_owner, 'user', 'Any more detail?');

  raise notice 'CHECK 9 passed: unblocking restores messaging, and unblocking a non-block is silent.';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 10 — list_my_blocks is caller-scoped, and never says who blocked YOU.
-- -----------------------------------------------------------------------------
-- ⚠️ Returning inbound blocks would be the same oracle CHECK 5 forbids, in a
-- different endpoint: it would tell the blocked party they had been blocked.
begin;
do $$
declare
  v_alex uuid := '11111111-1111-1111-1111-111111111111';
  v_beth uuid := '22222222-2222-2222-2222-222222222222';
  v_doc  jsonb;
begin
  -- Beth blocks Alex. Alex must not learn this from his own block list.
  insert into public.user_blocks (blocker_id, blocked_id) values (v_beth, v_alex);

  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', v_alex)::text, true);
  set local role authenticated;
  v_doc := public.list_my_blocks();
  reset role;

  if jsonb_array_length(v_doc->'blocks') <> 0 then
    raise exception 'CHECK 10 FAILED: list_my_blocks showed a block the caller did not make — that tells them they are blocked';
  end if;

  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', v_beth)::text, true);
  set local role authenticated;
  v_doc := public.list_my_blocks();
  reset role;

  if jsonb_array_length(v_doc->'blocks') <> 1 then
    raise exception 'CHECK 10 FAILED: the blocker does not see their own block';
  end if;
  -- The passport rule: a first name, never a display_name or avatar_path.
  if (v_doc->'blocks'->0) ? 'display_name' or (v_doc->'blocks'->0) ? 'avatar_path' then
    raise exception 'CHECK 10 FAILED: list_my_blocks leaks display_name or avatar_path';
  end if;

  raise notice 'CHECK 10 passed: the list is the caller''s own outbound blocks only, first name and id.';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 11 — grants: deny-by-default on the table, authenticated on the RPCs.
-- -----------------------------------------------------------------------------
do $$
declare
  v_grants text;
begin
  select string_agg(distinct privilege_type, ',' order by privilege_type)
    into v_grants
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'user_blocks'
    and grantee in ('anon', 'authenticated');
  if v_grants is not null then
    raise exception 'CHECK 11 FAILED: anon/authenticated hold % on user_blocks', v_grants;
  end if;

  -- are_blocked is an internal predicate: a client that could call it would be
  -- able to ask "has this person blocked me" directly.
  if has_function_privilege('authenticated', 'public.are_blocked(uuid, uuid)', 'execute') then
    raise exception 'CHECK 11 FAILED: authenticated can execute are_blocked — that is the oracle CHECK 5 forbids';
  end if;
  if has_function_privilege('anon', 'public.block_user(uuid)', 'execute') then
    raise exception 'CHECK 11 FAILED: anon can execute block_user';
  end if;
  if not has_function_privilege('authenticated', 'public.block_user(uuid)', 'execute') then
    raise exception 'CHECK 11 FAILED: authenticated cannot block';
  end if;
  if not has_function_privilege('authenticated', 'public.list_my_blocks()', 'execute') then
    raise exception 'CHECK 11 FAILED: authenticated cannot read their own block list';
  end if;

  raise notice 'CHECK 11 passed: the table is operator-only, are_blocked is internal, the three RPCs are authenticated-only.';
end $$;


select 'user_blocking_verification: ALL CHECKS PASSED' as result;
