-- =============================================================================
-- Chat safety / validation verification (NOT a migration — do not place in
-- migrations/).
--
-- SELF-ASSERTING: every check is a DO block that RAISES EXCEPTION on failure, so
-- the whole file aborts non-zero the moment a property is violated. "Threads
-- open only after a sighting (no cold DMs), NEW threads open only on active
-- posts, the owner opens via SIGHTING ids (never spotter ids — §1), the inbox
-- leaks NO uid (no avatar_path) and no plate to spotters, messages reach ONLY
-- the two participants, sends are rate-limited, all chat writes are
-- server-boundary RPCs, and flags are invisible to every client" are Tier 1
-- properties (docs/DOMAIN.md Chat; docs/SECURITY_AND_TRUST.md §1/§6/§7) — this
-- file GATES CI, it is not for eyeballing. On success each block emits a NOTICE.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset            # applies migrations + seed
--     psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/chat_verification.sql
--
-- (ON_ERROR_STOP=1 makes psql exit non-zero on the first RAISE.)
--
-- Fixtures used (from supabase/seed.sql), all owned by 11111111 (Alex):
--   ACTIVE    post 0001 ('MA19 XKL') — its thread is SPOTTER-created (CHECK 1).
--   ACTIVE    post 0006 ('AK19 TRV') — its thread is OWNER-created via
--                                       open_thread_for_sighting (CHECK 5), and
--                                       is the rate-limit target (CHECK 13).
--   RECOVERED post 0017 ('MA18 RCV') — its thread is PRE-SEEDED as postgres in
--                                       SETUP (models "created while active,
--                                       then the post closed"): proves history
--                                       opens return ungated + POST_CLOSED sends.
--   RECOVERED post 0021 ('MA99 OLD') — NO thread; proves POST_CLOSED on CREATE
--                                       (a new thread cannot open on a closed
--                                       post) via both entry points.
--   Spotter:    22222222 (Beth Sanders) — gets CHAT-TEST sightings on all four
--               posts in setup, so threads may open for her pair.
--   Third user: 33333333 (Carl Thomas)  — NO sightings, NO threads; every
--               absence assertion runs as Carl.
--
-- auth.uid() reads the request.jwt.claims GUC; write-path blocks set it to the
-- caller's sub for the transaction and run as postgres (RLS bypassed for the
-- direct-table assertions). The RLS/grant checks additionally SET LOCAL ROLE
-- authenticated / anon so the GRANT layer applies for real (the technique from
-- anon_role_verification.sql).
--
-- ORDER IS LOAD-BEARING: CHECK 4 must precede CHECK 5 (so the active-post thread
-- is not the newest activity when CHECK 7 asserts ordering); CHECK 13's
-- rate-limit flood runs LAST (after the RLS/inbox counts) so its 20 extra
-- messages on 0006 do not perturb the count assertions — housekeeping then drops
-- every thread anyway.
--
-- IDEMPOTENCY: all chat rows on the fixture posts (threads cascade their
-- messages), this file's flags, and its marker sightings ('CHAT-TEST%') are
-- deleted up-front AND at the end, so re-runs and other test files see the
-- seed state unchanged.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- SETUP — clean leftovers, plant the four sighting fixtures that gate opens
-- (inserted directly as postgres: create_sighting would refuse the recovered
-- posts, but a real sighting reported while active is exactly this history),
-- and PRE-SEED the recovered post 0017's thread + its system message (modelling
-- a thread created while the post was active, before it closed).
-- -----------------------------------------------------------------------------
do $$
declare
  v_sys constant text :=
    'Safety first: report from a distance and never arrange to meet or attempt a recovery yourselves — recovery is for the owner and police. If a crime is in progress, call 999.';
  v_tid uuid;
begin
  delete from public.flags
  where target_type = 'message'
    and reporter_id in ('11111111-1111-1111-1111-111111111111',
                        '22222222-2222-2222-2222-222222222222',
                        '33333333-3333-3333-3333-333333333333');

  delete from public.threads
  where post_id in ('a1a1a1a1-0000-0000-0000-000000000001',
                    'a1a1a1a1-0000-0000-0000-000000000006',
                    'a1a1a1a1-0000-0000-0000-000000000017',
                    'a1a1a1a1-0000-0000-0000-000000000021');

  delete from public.sightings where note like 'CHAT-TEST%';

  insert into public.sightings (post_id, spotter_id, note, location_unavailable)
  values
    ('a1a1a1a1-0000-0000-0000-000000000001',
     '22222222-2222-2222-2222-222222222222', 'CHAT-TEST s0001', true),
    ('a1a1a1a1-0000-0000-0000-000000000006',
     '22222222-2222-2222-2222-222222222222', 'CHAT-TEST s0006', true),
    ('a1a1a1a1-0000-0000-0000-000000000017',
     '22222222-2222-2222-2222-222222222222', 'CHAT-TEST s0017', true),
    ('a1a1a1a1-0000-0000-0000-000000000021',
     '22222222-2222-2222-2222-222222222222', 'CHAT-TEST s0021', true);

  -- Pre-seed the recovered-post thread as if opened while 0017 was still active.
  insert into public.threads
    (post_id, owner_id, spotter_id, last_message_at, last_message_preview, created_at)
  values
    ('a1a1a1a1-0000-0000-0000-000000000017',
     '11111111-1111-1111-1111-111111111111',
     '22222222-2222-2222-2222-222222222222',
     now() - interval '10 days', left(v_sys, 140), now() - interval '10 days')
  returning id into v_tid;
  insert into public.messages (thread_id, sender_id, kind, content, created_at)
  values (v_tid, null, 'system', v_sys, now() - interval '10 days');

  raise notice 'SETUP done: 4 sightings planted, recovered-post thread pre-seeded, leftovers removed';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 1 — happy path. The SPOTTER (Beth) opens a thread on the ACTIVE post
-- 0001 via open_thread: created=true; owner_id PINNED from the post row (Alex,
-- not caller input); EXACTLY ONE message — kind='system', sender_id NULL,
-- content EXACTLY the safety line; preview = its 140-char truncation.
-- -----------------------------------------------------------------------------
do $$
declare
  v_sys constant text :=
    'Safety first: report from a distance and never arrange to meet or attempt a recovery yourselves — recovery is for the owner and police. If a crime is in progress, call 999.';
  v_doc jsonb;
  v_tid uuid;
  v_t   public.threads%rowtype;
  v_n   int;
  v_m   public.messages%rowtype;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  v_doc := public.open_thread('a1a1a1a1-0000-0000-0000-000000000001');
  v_tid := (v_doc ->> 'thread_id')::uuid;
  if v_tid is null or not (v_doc ->> 'created')::boolean then
    raise exception 'CHECK 1 FAILED: expected { thread_id, created:true }, got %', v_doc;
  end if;

  select * into v_t from public.threads where id = v_tid;
  if v_t.owner_id <> '11111111-1111-1111-1111-111111111111' then
    raise exception 'CHECK 1 FAILED: owner_id not pinned from the post row: %', v_t.owner_id;
  end if;
  if v_t.spotter_id <> '22222222-2222-2222-2222-222222222222' then
    raise exception 'CHECK 1 FAILED: spotter_id wrong: %', v_t.spotter_id;
  end if;
  if v_t.last_message_preview <> left(v_sys, 140) then
    raise exception 'CHECK 1 FAILED: preview not the 140-char truncation of the safety line: %', v_t.last_message_preview;
  end if;

  select count(*) into v_n from public.messages where thread_id = v_tid;
  if v_n <> 1 then
    raise exception 'CHECK 1 FAILED: expected exactly 1 (system) message, got %', v_n;
  end if;
  select * into v_m from public.messages where thread_id = v_tid;
  if v_m.kind <> 'system' or v_m.sender_id is not null then
    raise exception 'CHECK 1 FAILED: first message must be kind=system with NULL sender (kind=%, sender=%)', v_m.kind, v_m.sender_id;
  end if;
  if v_m.content <> v_sys then
    raise exception 'CHECK 1 FAILED: system message text drifted from the safety line: %', v_m.content;
  end if;

  raise notice 'CHECK 1 passed: spotter open -> pinned thread + exactly one exact system safety message';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 2 — idempotent open. Re-opening the SAME (0001, Beth) pair — spotter
-- (implicit AND explicit self id) and OWNER naming the spotter — returns the
-- SAME thread with created=false, and the system message count stays at ONE.
-- -----------------------------------------------------------------------------
do $$
declare
  v_tid uuid;
  v_doc jsonb;
  v_n   int;
begin
  select id into v_tid from public.threads
  where post_id = 'a1a1a1a1-0000-0000-0000-000000000001'
    and spotter_id = '22222222-2222-2222-2222-222222222222';

  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  v_doc := public.open_thread('a1a1a1a1-0000-0000-0000-000000000001');
  if (v_doc ->> 'thread_id')::uuid <> v_tid or (v_doc ->> 'created')::boolean then
    raise exception 'CHECK 2 FAILED (spotter re-open): expected same id + created=false, got %', v_doc;
  end if;

  v_doc := public.open_thread('a1a1a1a1-0000-0000-0000-000000000001',
                              '22222222-2222-2222-2222-222222222222');
  if (v_doc ->> 'thread_id')::uuid <> v_tid or (v_doc ->> 'created')::boolean then
    raise exception 'CHECK 2 FAILED (spotter explicit self): expected same id + created=false, got %', v_doc;
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true);
  v_doc := public.open_thread('a1a1a1a1-0000-0000-0000-000000000001',
                              '22222222-2222-2222-2222-222222222222');
  if (v_doc ->> 'thread_id')::uuid <> v_tid or (v_doc ->> 'created')::boolean then
    raise exception 'CHECK 2 FAILED (owner open): expected same id + created=false, got %', v_doc;
  end if;

  select count(*) into v_n from public.messages
  where thread_id = v_tid and kind = 'system';
  if v_n <> 1 then
    raise exception 'CHECK 2 FAILED: duplicate opens multiplied the system message (count=%)', v_n;
  end if;

  raise notice 'CHECK 2 passed: duplicate opens return the same thread, created=false, one system message';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 3 — open_thread refusals. (a) owner with NULL spotter -> INVALID_INPUT;
-- (b) owner naming a sighting-less spotter (Carl) -> NO_SIGHTING; (c) a
-- sighting-less caller (Carl) -> NO_SIGHTING; (d) a MISSING post -> the SAME
-- NO_SIGHTING (no existence oracle); (e) a third user naming somebody else ->
-- NOT_PARTICIPANT; (f) NEW L2 — a spotter opening a NEW thread on a CLOSED post
-- (0021, recovered, she has a sighting, no thread) -> POST_CLOSED.
-- -----------------------------------------------------------------------------
do $$
declare
  v_hits int := 0;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true);
  begin
    perform public.open_thread('a1a1a1a1-0000-0000-0000-000000000001');
    raise exception 'CHECK 3 FAILED: owner open without spotter_id was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 3 FAILED (a): expected INVALID_INPUT, got: %', sqlerrm; end if;
  end;

  begin
    perform public.open_thread('a1a1a1a1-0000-0000-0000-000000000001',
                               '33333333-3333-3333-3333-333333333333');
    raise exception 'CHECK 3 FAILED: owner opened toward a sighting-less spotter';
  exception when others then
    if sqlerrm like 'NO_SIGHTING%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 3 FAILED (b): expected NO_SIGHTING, got: %', sqlerrm; end if;
  end;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
    true);
  begin
    perform public.open_thread('a1a1a1a1-0000-0000-0000-000000000001');
    raise exception 'CHECK 3 FAILED: a cold DM (no sighting) was accepted';
  exception when others then
    if sqlerrm like 'NO_SIGHTING%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 3 FAILED (c): expected NO_SIGHTING, got: %', sqlerrm; end if;
  end;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  begin
    perform public.open_thread('deaddead-dead-dead-dead-deaddeaddead');
    raise exception 'CHECK 3 FAILED: a missing post was accepted';
  exception when others then
    if sqlerrm like 'NO_SIGHTING%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 3 FAILED (d): expected NO_SIGHTING for a missing post, got: %', sqlerrm; end if;
  end;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
    true);
  begin
    perform public.open_thread('a1a1a1a1-0000-0000-0000-000000000001',
                               '22222222-2222-2222-2222-222222222222');
    raise exception 'CHECK 3 FAILED: a third user opened another pair''s thread';
  exception when others then
    if sqlerrm like 'NOT_PARTICIPANT%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 3 FAILED (e): expected NOT_PARTICIPANT, got: %', sqlerrm; end if;
  end;

  -- (f) L2: spotter creating a NEW thread on a CLOSED post -> POST_CLOSED.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  begin
    perform public.open_thread('a1a1a1a1-0000-0000-0000-000000000021');
    raise exception 'CHECK 3 FAILED: a NEW thread opened on a closed post';
  exception when others then
    if sqlerrm like 'POST_CLOSED%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 3 FAILED (f): expected POST_CLOSED on create-on-closed, got: %', sqlerrm; end if;
  end;

  if v_hits <> 6 then
    raise exception 'CHECK 3 FAILED: expected 6 refusals, got %', v_hits;
  end if;
  raise notice 'CHECK 3 passed: INVALID_INPUT / NO_SIGHTING (x3) / NOT_PARTICIPANT / POST_CLOSED-on-create all enforced';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 4 — send_message happy path on 0001. Beth sends (whitespace-padded is
-- TRIMMED; sender pinned; kind=user), Alex replies; the thread's preview and
-- last_message_at track the LATEST message; message count = 3 (system + 2).
-- -----------------------------------------------------------------------------
do $$
declare
  v_tid  uuid;
  v_doc  jsonb;
  v_t    public.threads%rowtype;
  v_n    int;
begin
  select id into v_tid from public.threads
  where post_id = 'a1a1a1a1-0000-0000-0000-000000000001'
    and spotter_id = '22222222-2222-2222-2222-222222222222';

  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  v_doc := public.send_message(v_tid, '  Seen it again this morning near the retail park.  ');
  if (v_doc ->> 'sender_id')::uuid <> '22222222-2222-2222-2222-222222222222'
     or (v_doc ->> 'kind') <> 'user'
     or (v_doc ->> 'content') <> 'Seen it again this morning near the retail park.'
     or (v_doc ->> 'id') is null
     or (v_doc ->> 'created_at') is null then
    raise exception 'CHECK 4 FAILED: sent-message payload wrong (pin/trim/kind): %', v_doc;
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true);
  v_doc := public.send_message(v_tid, 'Thank you — I''ve passed the location to the police.');
  if (v_doc ->> 'sender_id')::uuid <> '11111111-1111-1111-1111-111111111111' then
    raise exception 'CHECK 4 FAILED: owner reply sender not pinned: %', v_doc;
  end if;

  select * into v_t from public.threads where id = v_tid;
  if v_t.last_message_preview <> 'Thank you — I''ve passed the location to the police.' then
    raise exception 'CHECK 4 FAILED: preview did not track the latest message: %', v_t.last_message_preview;
  end if;
  if v_t.last_message_at < v_t.created_at then
    raise exception 'CHECK 4 FAILED: last_message_at was not bumped';
  end if;

  select count(*) into v_n from public.messages where thread_id = v_tid;
  if v_n <> 3 then
    raise exception 'CHECK 4 FAILED: expected 3 messages (system + 2 user), got %', v_n;
  end if;

  raise notice 'CHECK 4 passed: both participants send; content trimmed, sender pinned, preview denormalised';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 5 — open_thread_for_sighting: the OWNER's entry point. Alex holds only
-- Beth's SIGHTING ids (never her uid — §1). (1) He CREATES the ACTIVE post
-- 0006's thread with a sighting id: created=true, spotter resolved server-side,
-- one system message. (2) Idempotent within the path (re-call -> created=false).
-- (3) Cross-path idempotence: Beth's open_thread on 0006, and Alex's
-- for_sighting on 0001's ALREADY-OPEN thread, both return the existing ids
-- created=false. (4) History return on a CLOSED post: for_sighting/open_thread
-- on 0017 (pre-seeded) both return that thread ungated. (5) L2: for_sighting on
-- 0021 (recovered, no thread) -> POST_CLOSED. (6) NOT_PARTICIPANT (all same
-- token): the SPOTTER on her own sighting, a THIRD user, a MISSING sighting id.
-- -----------------------------------------------------------------------------
do $$
declare
  v_sig_0006 uuid;
  v_sig_0001 uuid;
  v_sig_0017 uuid;
  v_sig_0021 uuid;
  v_doc  jsonb;
  v_tid  uuid;
  v_t    public.threads%rowtype;
  v_n    int;
  v_hits int := 0;
begin
  -- The harness (postgres) fetches sighting ids; a real owner client receives
  -- them from get_post_sightings.
  select id into v_sig_0006 from public.sightings where note = 'CHAT-TEST s0006';
  select id into v_sig_0001 from public.sightings where note = 'CHAT-TEST s0001';
  select id into v_sig_0017 from public.sightings where note = 'CHAT-TEST s0017';
  select id into v_sig_0021 from public.sightings where note = 'CHAT-TEST s0021';

  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true);

  -- (1) CREATE on active 0006 via sighting id — no spotter uid in the call.
  v_doc := public.open_thread_for_sighting(v_sig_0006);
  v_tid := (v_doc ->> 'thread_id')::uuid;
  if v_tid is null or not (v_doc ->> 'created')::boolean then
    raise exception 'CHECK 5 FAILED: owner open via sighting should CREATE on the active post, got %', v_doc;
  end if;
  select * into v_t from public.threads where id = v_tid;
  if v_t.post_id <> 'a1a1a1a1-0000-0000-0000-000000000006'
     or v_t.owner_id <> '11111111-1111-1111-1111-111111111111'
     or v_t.spotter_id <> '22222222-2222-2222-2222-222222222222' then
    raise exception 'CHECK 5 FAILED: resolved pair wrong (post=%, owner=%, spotter=%)', v_t.post_id, v_t.owner_id, v_t.spotter_id;
  end if;
  select count(*) into v_n from public.messages where thread_id = v_tid;
  if v_n <> 1 then
    raise exception 'CHECK 5 FAILED: expected exactly 1 system message on the new thread, got %', v_n;
  end if;

  -- (2) Idempotent within the path.
  v_doc := public.open_thread_for_sighting(v_sig_0006);
  if (v_doc ->> 'thread_id')::uuid <> v_tid or (v_doc ->> 'created')::boolean then
    raise exception 'CHECK 5 FAILED: re-open via sighting should return same id + created=false, got %', v_doc;
  end if;

  -- (3a) Cross-path: the spotter's open_thread on 0006 lands on the same thread.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  v_doc := public.open_thread('a1a1a1a1-0000-0000-0000-000000000006');
  if (v_doc ->> 'thread_id')::uuid <> v_tid or (v_doc ->> 'created')::boolean then
    raise exception 'CHECK 5 FAILED: cross-path re-open (spotter on 0006) should return same id + created=false, got %', v_doc;
  end if;

  -- (3b) Cross-path: owner for_sighting on 0001 returns CHECK 1's thread.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true);
  v_doc := public.open_thread_for_sighting(v_sig_0001);
  if (v_doc ->> 'created')::boolean
     or (v_doc ->> 'thread_id')::uuid <> (select id from public.threads
                                          where post_id = 'a1a1a1a1-0000-0000-0000-000000000001'
                                            and spotter_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 5 FAILED: cross-path re-open (owner via 0001 sighting) wrong: %', v_doc;
  end if;

  -- (4) History return on the CLOSED post 0017 (pre-seeded) — ungated, both paths.
  v_doc := public.open_thread_for_sighting(v_sig_0017);
  if (v_doc ->> 'created')::boolean
     or (v_doc ->> 'thread_id')::uuid <> (select id from public.threads
                                          where post_id = 'a1a1a1a1-0000-0000-0000-000000000017'
                                            and spotter_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 5 FAILED: owner history-return on the closed post 0017 wrong: %', v_doc;
  end if;
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  v_doc := public.open_thread('a1a1a1a1-0000-0000-0000-000000000017');
  if (v_doc ->> 'created')::boolean then
    raise exception 'CHECK 5 FAILED: spotter history-return on the closed post 0017 should be created=false, got %', v_doc;
  end if;

  -- (5) L2: owner CREATE via sighting on a closed post with no thread -> POST_CLOSED.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true);
  begin
    perform public.open_thread_for_sighting(v_sig_0021);
    raise exception 'CHECK 5 FAILED: owner created a NEW thread on a closed post via sighting entry';
  exception when others then
    if sqlerrm like 'POST_CLOSED%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 5 FAILED (L2 create-on-closed): expected POST_CLOSED, got: %', sqlerrm; end if;
  end;

  -- (6a) The SPOTTER on her own sighting — she is not the owner.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  begin
    perform public.open_thread_for_sighting(v_sig_0001);
    raise exception 'CHECK 5 FAILED: the spotter used the owner entry point';
  exception when others then
    if sqlerrm like 'NOT_PARTICIPANT%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 5 FAILED (spotter): expected NOT_PARTICIPANT, got: %', sqlerrm; end if;
  end;

  -- (6b) A THIRD user with a valid sighting id.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
    true);
  begin
    perform public.open_thread_for_sighting(v_sig_0001);
    raise exception 'CHECK 5 FAILED: a third user used the owner entry point';
  exception when others then
    if sqlerrm like 'NOT_PARTICIPANT%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 5 FAILED (third): expected NOT_PARTICIPANT, got: %', sqlerrm; end if;
  end;

  -- (6c) A MISSING sighting id — SAME token (no existence oracle).
  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true);
  begin
    perform public.open_thread_for_sighting('deaddead-dead-dead-dead-deaddeaddead');
    raise exception 'CHECK 5 FAILED: a missing sighting id was accepted';
  exception when others then
    if sqlerrm like 'NOT_PARTICIPANT%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 5 FAILED (missing): expected NOT_PARTICIPANT, got: %', sqlerrm; end if;
  end;

  if v_hits <> 4 then
    raise exception 'CHECK 5 FAILED: expected 4 refusals (1 POST_CLOSED + 3 NOT_PARTICIPANT), got %', v_hits;
  end if;
  raise notice 'CHECK 5 passed: owner creates via sighting id (no spotter uid); idempotent within + across paths; history returns ungated; POST_CLOSED on create; spotter/third/missing all NOT_PARTICIPANT';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 6 — send_message refusals. (a) non-participant Carl -> NOT_PARTICIPANT;
-- (b) MISSING thread -> the SAME NOT_PARTICIPANT; (c) whitespace-only ->
-- INVALID_INPUT; (d) 2001 chars -> INVALID_INPUT; (e) POST_CLOSED on the
-- pre-seeded 0017 thread from BOTH sides (history is read-only).
-- -----------------------------------------------------------------------------
do $$
declare
  v_tid    uuid;
  v_closed uuid;
  v_hits   int := 0;
begin
  select id into v_tid from public.threads
  where post_id = 'a1a1a1a1-0000-0000-0000-000000000001'
    and spotter_id = '22222222-2222-2222-2222-222222222222';
  select id into v_closed from public.threads
  where post_id = 'a1a1a1a1-0000-0000-0000-000000000017'
    and spotter_id = '22222222-2222-2222-2222-222222222222';

  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
    true);
  begin
    perform public.send_message(v_tid, 'let me in');
    raise exception 'CHECK 6 FAILED: a non-participant sent a message';
  exception when others then
    if sqlerrm like 'NOT_PARTICIPANT%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6 FAILED (a): expected NOT_PARTICIPANT, got: %', sqlerrm; end if;
  end;

  begin
    perform public.send_message('deaddead-dead-dead-dead-deaddeaddead', 'hello?');
    raise exception 'CHECK 6 FAILED: a missing thread accepted a message';
  exception when others then
    if sqlerrm like 'NOT_PARTICIPANT%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6 FAILED (b): expected NOT_PARTICIPANT for a missing thread, got: %', sqlerrm; end if;
  end;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  begin
    perform public.send_message(v_tid, '   ');
    raise exception 'CHECK 6 FAILED: whitespace-only content was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6 FAILED (c): expected INVALID_INPUT, got: %', sqlerrm; end if;
  end;

  begin
    perform public.send_message(v_tid, repeat('x', 2001));
    raise exception 'CHECK 6 FAILED: 2001-char content was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6 FAILED (d): expected INVALID_INPUT, got: %', sqlerrm; end if;
  end;

  begin
    perform public.send_message(v_closed, 'fancy meeting up?');
    raise exception 'CHECK 6 FAILED: a message landed on a closed post (spotter)';
  exception when others then
    if sqlerrm like 'POST_CLOSED%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6 FAILED (e-spotter): expected POST_CLOSED, got: %', sqlerrm; end if;
  end;
  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true);
  begin
    perform public.send_message(v_closed, 'sure');
    raise exception 'CHECK 6 FAILED: a message landed on a closed post (owner)';
  exception when others then
    if sqlerrm like 'POST_CLOSED%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6 FAILED (e-owner): expected POST_CLOSED, got: %', sqlerrm; end if;
  end;

  if v_hits <> 6 then
    raise exception 'CHECK 6 FAILED: expected 6 refusals, got %', v_hits;
  end if;
  raise notice 'CHECK 6 passed: NOT_PARTICIPANT (x2) / INVALID_INPUT (x2) / POST_CLOSED (both sides)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 7 — get_inbox + unread + mark_thread_read + PRIVACY (H1 + L1). Alex has
-- 3 threads (0001 active, 0006 active, 0017 recovered) newest-activity-first.
-- His 0001 row: role='owner', unread=1 (Beth's message; his reply + the
-- read-at-open system message don't count), a correct post block WITH plate
-- (owner sees it — L1), and an OTHER block that is EXACTLY {first_name} — NO
-- avatar_path key (H1). The whole payload leaks NEITHER participant's uid.
-- mark_thread_read zeroes HIS count. Beth's 0001 row: role='spotter', unread=1
-- (Alex's reply), plate NULL (spotter — L1). Carl's inbox is EMPTY.
-- -----------------------------------------------------------------------------
do $$
declare
  v_tid_active    uuid;
  v_tid_recovered uuid;
  v_doc   jsonb;
  v_row   jsonb;
  v_txt   text;
begin
  select id into v_tid_active from public.threads
  where post_id = 'a1a1a1a1-0000-0000-0000-000000000001'
    and spotter_id = '22222222-2222-2222-2222-222222222222';
  select id into v_tid_recovered from public.threads
  where post_id = 'a1a1a1a1-0000-0000-0000-000000000017'
    and spotter_id = '22222222-2222-2222-2222-222222222222';

  -- ---- Alex (owner) ----
  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true);
  v_doc := public.get_inbox();
  if jsonb_typeof(v_doc) <> 'array' or jsonb_array_length(v_doc) <> 3 then
    raise exception 'CHECK 7 FAILED: Alex should have 3 inbox rows, got %', v_doc;
  end if;
  if (v_doc -> 0 ->> 'last_message_at')::timestamptz
       < (v_doc -> (jsonb_array_length(v_doc) - 1) ->> 'last_message_at')::timestamptz then
    raise exception 'CHECK 7 FAILED: inbox not ordered newest-activity-first';
  end if;

  select e into v_row from jsonb_array_elements(v_doc) e
  where e ->> 'thread_id' = v_tid_active::text;
  if v_row is null then
    raise exception 'CHECK 7 FAILED: the active-post thread is missing from Alex''s inbox';
  end if;
  if (v_row ->> 'role') <> 'owner' then
    raise exception 'CHECK 7 FAILED: Alex''s role should be owner, got %', v_row ->> 'role';
  end if;
  if (v_row ->> 'unread_count')::int <> 1 then
    raise exception 'CHECK 7 FAILED: Alex''s unread should be 1 (Beth''s message), got %', v_row ->> 'unread_count';
  end if;
  -- L1: the OWNER sees the plate.
  if (v_row -> 'post' ->> 'make') <> 'Ford'
     or (v_row -> 'post' ->> 'model') <> 'Fiesta'
     or (v_row -> 'post' ->> 'plate') <> 'MA19 XKL'
     or (v_row -> 'post' ->> 'status') <> 'active'
     or (v_row -> 'post' ->> 'cover_photo_url') is null then
    raise exception 'CHECK 7 FAILED: owner post block wrong (plate must be present): %', v_row -> 'post';
  end if;
  -- H1: OTHER block is EXACTLY { first_name } — no avatar_path, nothing else.
  if (v_row -> 'other' ->> 'first_name') <> 'Beth' then
    raise exception 'CHECK 7 FAILED: other.first_name should be Beth: %', v_row -> 'other';
  end if;
  if (v_row -> 'other') ? 'avatar_path' then
    raise exception 'CHECK 7 FAILED (H1): other block still ships avatar_path (embeds the uid): %', v_row -> 'other';
  end if;
  if (v_row -> 'other') - 'first_name' <> '{}'::jsonb then
    raise exception 'CHECK 7 FAILED: other block has keys beyond first_name: %', v_row -> 'other';
  end if;

  -- The recovered post's row surfaces with its closed status.
  select e into v_row from jsonb_array_elements(v_doc) e
  where e ->> 'thread_id' = v_tid_recovered::text;
  if (v_row -> 'post' ->> 'status') <> 'recovered' then
    raise exception 'CHECK 7 FAILED: closed thread''s post.status should be recovered: %', v_row -> 'post';
  end if;

  -- H1 uid-absence: neither participant's uid may appear anywhere in the payload.
  v_txt := v_doc::text;
  if v_txt like '%11111111-1111%' or v_txt like '%22222222-2222%' then
    raise exception 'CHECK 7 FAILED (H1): inbox payload leaks a participant uid';
  end if;
  if v_txt like '%display_name%' or v_txt like '%Sanders%' or v_txt like '%Mercer%' then
    raise exception 'CHECK 7 FAILED: inbox payload leaks a display_name/surname';
  end if;
  if v_txt like '%trackitdown.test%' or v_txt like '%email%' then
    raise exception 'CHECK 7 FAILED: inbox payload leaks an email';
  end if;

  -- mark_thread_read: Alex's count zeroes.
  perform public.mark_thread_read(v_tid_active);
  v_doc := public.get_inbox();
  select e into v_row from jsonb_array_elements(v_doc) e
  where e ->> 'thread_id' = v_tid_active::text;
  if (v_row ->> 'unread_count')::int <> 0 then
    raise exception 'CHECK 7 FAILED: unread should be 0 after mark_thread_read, got %', v_row ->> 'unread_count';
  end if;

  -- ---- Beth (spotter): her side untouched; L1 plate must be NULL ----
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  v_doc := public.get_inbox();
  if jsonb_array_length(v_doc) <> 3 then
    raise exception 'CHECK 7 FAILED: Beth should have 3 inbox rows, got %', v_doc;
  end if;
  select e into v_row from jsonb_array_elements(v_doc) e
  where e ->> 'thread_id' = v_tid_active::text;
  if (v_row ->> 'role') <> 'spotter' then
    raise exception 'CHECK 7 FAILED: Beth''s role should be spotter, got %', v_row ->> 'role';
  end if;
  if (v_row ->> 'unread_count')::int <> 1 then
    raise exception 'CHECK 7 FAILED: Beth''s unread should be 1 (Alex''s reply), got %', v_row ->> 'unread_count';
  end if;
  -- L1: a spotter must NOT receive the plate.
  if (v_row -> 'post' -> 'plate') is distinct from 'null'::jsonb then
    raise exception 'CHECK 7 FAILED (L1): spotter''s inbox row must have null plate, got %', v_row -> 'post' -> 'plate';
  end if;
  if (v_row -> 'other' ->> 'first_name') <> 'Alex' then
    raise exception 'CHECK 7 FAILED: Beth''s other.first_name should be Alex: %', v_row -> 'other';
  end if;

  -- ---- Carl: EMPTY inbox (absence) ----
  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
    true);
  v_doc := public.get_inbox();
  if v_doc <> '[]'::jsonb then
    raise exception 'CHECK 7 FAILED: Carl''s inbox should be empty, got %', v_doc;
  end if;

  raise notice 'CHECK 7 passed: inbox roles/ordering/unread/read-marker; H1 no avatar_path/uid; L1 plate owner-only; Carl empty';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 8 — mark_thread_read refusals: a non-participant (Carl) and a MISSING
-- thread both raise the SAME NOT_PARTICIPANT.
-- -----------------------------------------------------------------------------
do $$
declare
  v_tid  uuid;
  v_hits int := 0;
begin
  select id into v_tid from public.threads
  where post_id = 'a1a1a1a1-0000-0000-0000-000000000001'
    and spotter_id = '22222222-2222-2222-2222-222222222222';

  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
    true);
  begin
    perform public.mark_thread_read(v_tid);
    raise exception 'CHECK 8 FAILED: a non-participant marked a thread read';
  exception when others then
    if sqlerrm like 'NOT_PARTICIPANT%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 8 FAILED (carl): expected NOT_PARTICIPANT, got: %', sqlerrm; end if;
  end;

  begin
    perform public.mark_thread_read('deaddead-dead-dead-dead-deaddeaddead');
    raise exception 'CHECK 8 FAILED: a missing thread was marked read';
  exception when others then
    if sqlerrm like 'NOT_PARTICIPANT%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 8 FAILED (missing): expected NOT_PARTICIPANT, got: %', sqlerrm; end if;
  end;

  if v_hits <> 2 then
    raise exception 'CHECK 8 FAILED: expected 2 refusals, got %', v_hits;
  end if;
  raise notice 'CHECK 8 passed: mark_thread_read refuses non-participants and missing threads alike';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 9 — flag_message. Beth flags Alex's reply: reporter PINNED, target_type
-- 'message', reason stored. RE-flagging returns the SAME flag id and keeps ONE
-- row (original reason kept). Alex flagging the same message is a SEPARATE flag
-- (uniqueness is per reporter). Refusals: Carl -> NOT_PARTICIPANT; missing
-- message -> the SAME NOT_PARTICIPANT; 501-char reason -> INVALID_INPUT.
-- -----------------------------------------------------------------------------
do $$
declare
  v_tid  uuid;
  v_mid  uuid;
  v_doc  jsonb;
  v_fid  uuid;
  v_f    public.flags%rowtype;
  v_n    int;
  v_hits int := 0;
begin
  select id into v_tid from public.threads
  where post_id = 'a1a1a1a1-0000-0000-0000-000000000001'
    and spotter_id = '22222222-2222-2222-2222-222222222222';
  select id into v_mid from public.messages
  where thread_id = v_tid
    and sender_id = '11111111-1111-1111-1111-111111111111';

  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  v_doc := public.flag_message(v_mid, 'Testing the flag path.');
  v_fid := (v_doc ->> 'flag_id')::uuid;
  if v_fid is null then
    raise exception 'CHECK 9 FAILED: no flag_id returned: %', v_doc;
  end if;
  select * into v_f from public.flags where id = v_fid;
  if v_f.reporter_id <> '22222222-2222-2222-2222-222222222222'
     or v_f.target_type <> 'message'
     or v_f.target_id <> v_mid
     or v_f.reason <> 'Testing the flag path.' then
    raise exception 'CHECK 9 FAILED: flag row wrong (reporter/type/target/reason)';
  end if;

  v_doc := public.flag_message(v_mid, 'a different reason');
  if (v_doc ->> 'flag_id')::uuid <> v_fid then
    raise exception 'CHECK 9 FAILED: re-flag returned a different id: %', v_doc;
  end if;
  select count(*) into v_n from public.flags
  where reporter_id = '22222222-2222-2222-2222-222222222222' and target_id = v_mid;
  if v_n <> 1 then
    raise exception 'CHECK 9 FAILED: re-flag created a duplicate row (count=%)', v_n;
  end if;
  select reason into v_f.reason from public.flags where id = v_fid;
  if v_f.reason <> 'Testing the flag path.' then
    raise exception 'CHECK 9 FAILED: re-flag overwrote the original reason: %', v_f.reason;
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true);
  v_doc := public.flag_message(v_mid);
  if (v_doc ->> 'flag_id')::uuid = v_fid then
    raise exception 'CHECK 9 FAILED: a second reporter received the first reporter''s flag id';
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
    true);
  begin
    perform public.flag_message(v_mid);
    raise exception 'CHECK 9 FAILED: a non-participant flagged a message';
  exception when others then
    if sqlerrm like 'NOT_PARTICIPANT%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 9 FAILED (carl): expected NOT_PARTICIPANT, got: %', sqlerrm; end if;
  end;
  begin
    perform public.flag_message('deaddead-dead-dead-dead-deaddeaddead');
    raise exception 'CHECK 9 FAILED: a missing message was flagged';
  exception when others then
    if sqlerrm like 'NOT_PARTICIPANT%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 9 FAILED (missing): expected NOT_PARTICIPANT, got: %', sqlerrm; end if;
  end;
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  begin
    perform public.flag_message(v_mid, repeat('r', 501));
    raise exception 'CHECK 9 FAILED: a 501-char reason was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 9 FAILED (long reason): expected INVALID_INPUT, got: %', sqlerrm; end if;
  end;

  if v_hits <> 3 then
    raise exception 'CHECK 9 FAILED: expected 3 refusals, got %', v_hits;
  end if;
  raise notice 'CHECK 9 passed: flag pinned + idempotent per reporter; NOT_PARTICIPANT/INVALID_INPUT enforced';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 10 — RLS + grants under the REAL authenticated role. Participants
-- (Alex, Beth) each see exactly their 3 threads / 5 messages (0001: system+2;
-- 0006: system; 0017: system); the THIRD user (Carl) sees ZERO of both. Direct
-- writes (insert thread, insert message, update thread, delete message) are
-- grant-denied 42501 even for a participant, and flags is invisible EVEN TO ITS
-- OWN REPORTER (no client SELECT path).
-- -----------------------------------------------------------------------------
do $$
declare
  v_t int; v_m int;
  v_denied int := 0;
  v_tid uuid;
begin
  select id into v_tid from public.threads
  where post_id = 'a1a1a1a1-0000-0000-0000-000000000001'
    and spotter_id = '22222222-2222-2222-2222-222222222222';

  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  set local role authenticated;
  select count(*) into v_t from public.threads;
  select count(*) into v_m from public.messages;
  reset role;
  if v_t <> 3 or v_m <> 5 then
    raise exception 'CHECK 10 FAILED: Beth should see 3 threads / 5 messages, saw % / %', v_t, v_m;
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true);
  set local role authenticated;
  select count(*) into v_t from public.threads;
  select count(*) into v_m from public.messages;
  reset role;
  if v_t <> 3 or v_m <> 5 then
    raise exception 'CHECK 10 FAILED: Alex should see 3 threads / 5 messages, saw % / %', v_t, v_m;
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
    true);
  set local role authenticated;
  select count(*) into v_t from public.threads;
  select count(*) into v_m from public.messages;
  reset role;
  if v_t <> 0 or v_m <> 0 then
    raise exception 'CHECK 10 FAILED: Carl should see 0 rows, saw % threads / % messages', v_t, v_m;
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  begin
    set local role authenticated;
    insert into public.threads (post_id, owner_id, spotter_id)
    values ('a1a1a1a1-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111',
            '33333333-3333-3333-3333-333333333333');
    reset role;
    raise exception 'CHECK 10 FAILED: direct INSERT into threads was NOT denied';
  exception when insufficient_privilege then
    v_denied := v_denied + 1;  -- 42501; sub-block rollback also reverts the role
  end;
  begin
    set local role authenticated;
    insert into public.messages (thread_id, sender_id, kind, content)
    values (v_tid, '22222222-2222-2222-2222-222222222222', 'user', 'backdoor');
    reset role;
    raise exception 'CHECK 10 FAILED: direct INSERT into messages was NOT denied';
  exception when insufficient_privilege then
    v_denied := v_denied + 1;
  end;
  begin
    set local role authenticated;
    update public.threads set last_message_preview = 'forged' where id = v_tid;
    reset role;
    raise exception 'CHECK 10 FAILED: direct UPDATE of threads was NOT denied';
  exception when insufficient_privilege then
    v_denied := v_denied + 1;
  end;
  begin
    set local role authenticated;
    delete from public.messages where thread_id = v_tid;
    reset role;
    raise exception 'CHECK 10 FAILED: direct DELETE of messages was NOT denied';
  exception when insufficient_privilege then
    v_denied := v_denied + 1;
  end;

  begin
    set local role authenticated;
    select count(*) into v_t from public.flags;
    reset role;
    raise exception 'CHECK 10 FAILED: a reporter can SELECT flags (saw % row(s))', v_t;
  exception when insufficient_privilege then
    v_denied := v_denied + 1;
  end;

  if v_denied <> 5 then
    raise exception 'CHECK 10 FAILED: expected 5 grant denials, got %', v_denied;
  end if;
  raise notice 'CHECK 10 passed: participants see only their rows, Carl sees zero, all direct writes + flags reads denied';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 11 — DENY-BY-DEFAULT for the REAL anon role: SELECT on all three tables
-- and EXECUTE on all six RPCs are denied at the GRANT layer (42501). Any error
-- OTHER than 42501 on an RPC means its body ran — i.e. anon holds EXECUTE —
-- and fails the check (the 20260713191000 incident class).
-- -----------------------------------------------------------------------------
do $$
declare
  v_denied int := 0;
  v_rows   int;
begin
  perform set_config('request.jwt.claims', null, true);

  begin
    set local role anon;
    select count(*) into v_rows from public.threads;
    reset role;
    raise exception 'CHECK 11 FAILED: anon SELECT on threads was NOT grant-denied (saw % row(s))', v_rows;
  exception when insufficient_privilege then
    v_denied := v_denied + 1;
  end;
  begin
    set local role anon;
    select count(*) into v_rows from public.messages;
    reset role;
    raise exception 'CHECK 11 FAILED: anon SELECT on messages was NOT grant-denied (saw % row(s))', v_rows;
  exception when insufficient_privilege then
    v_denied := v_denied + 1;
  end;
  begin
    set local role anon;
    select count(*) into v_rows from public.flags;
    reset role;
    raise exception 'CHECK 11 FAILED: anon SELECT on flags was NOT grant-denied (saw % row(s))', v_rows;
  exception when insufficient_privilege then
    v_denied := v_denied + 1;
  end;

  begin
    set local role anon;
    perform public.open_thread('a1a1a1a1-0000-0000-0000-000000000001');
    reset role;
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
    when others then
      raise exception 'CHECK 11 FAILED: open_thread as anon raised "%" (SQLSTATE %) — its body ran, so anon still holds EXECUTE (expected 42501)', sqlerrm, sqlstate;
  end;
  begin
    set local role anon;
    perform public.open_thread_for_sighting('deaddead-dead-dead-dead-deaddeaddead');
    reset role;
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
    when others then
      raise exception 'CHECK 11 FAILED: open_thread_for_sighting as anon raised "%" (SQLSTATE %) — its body ran, so anon still holds EXECUTE (expected 42501)', sqlerrm, sqlstate;
  end;
  begin
    set local role anon;
    perform public.send_message('deaddead-dead-dead-dead-deaddeaddead', 'hi');
    reset role;
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
    when others then
      raise exception 'CHECK 11 FAILED: send_message as anon raised "%" (SQLSTATE %) — its body ran, so anon still holds EXECUTE (expected 42501)', sqlerrm, sqlstate;
  end;
  begin
    set local role anon;
    perform public.mark_thread_read('deaddead-dead-dead-dead-deaddeaddead');
    reset role;
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
    when others then
      raise exception 'CHECK 11 FAILED: mark_thread_read as anon raised "%" (SQLSTATE %) — its body ran, so anon still holds EXECUTE (expected 42501)', sqlerrm, sqlstate;
  end;
  begin
    set local role anon;
    perform public.get_inbox();
    reset role;
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
    when others then
      raise exception 'CHECK 11 FAILED: get_inbox as anon raised "%" (SQLSTATE %) — its body ran, so anon still holds EXECUTE (expected 42501)', sqlerrm, sqlstate;
  end;
  begin
    set local role anon;
    perform public.flag_message('deaddead-dead-dead-dead-deaddeaddead');
    reset role;
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
    when others then
      raise exception 'CHECK 11 FAILED: flag_message as anon raised "%" (SQLSTATE %) — its body ran, so anon still holds EXECUTE (expected 42501)', sqlerrm, sqlstate;
  end;

  if v_denied <> 9 then
    raise exception 'CHECK 11 FAILED: expected 9 grant denials for anon, got %', v_denied;
  end if;
  raise notice 'CHECK 11 passed: anon grant-denied (42501) on all three tables and all six RPCs';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 12 — Realtime: when this stack ships the standard supabase_realtime
-- publication, public.messages must be in it (postgres_changes then delivers
-- each message only to subscribers passing the participant SELECT RLS).
-- Skipped with a NOTICE on a stack without the publication.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename  = 'messages'
    ) then
      raise exception 'CHECK 12 FAILED: public.messages is not in the supabase_realtime publication';
    end if;
    raise notice 'CHECK 12 passed: public.messages is in supabase_realtime (RLS-gated postgres_changes)';
  else
    raise notice 'CHECK 12 skipped: this stack has no supabase_realtime publication';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 13 — send_message rate limit (M2). Beth has sent NOTHING on the 0006
-- thread, so she may send 20 within the rolling 60s window; the 21st in-window
-- send is rejected with RATE_LIMITED. Runs LAST so its 20 extra messages do not
-- perturb the CHECK 10 count assertions; housekeeping drops the thread anyway.
-- -----------------------------------------------------------------------------
do $$
declare
  v_tid uuid;
  v_ok  boolean := false;
  i     int;
begin
  select id into v_tid from public.threads
  where post_id = 'a1a1a1a1-0000-0000-0000-000000000006'
    and spotter_id = '22222222-2222-2222-2222-222222222222';

  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  -- 20 sends inside the window: all allowed.
  for i in 1..20 loop
    perform public.send_message(v_tid, 'flood ' || i::text);
  end loop;

  -- The 21st in-window: rejected.
  begin
    perform public.send_message(v_tid, 'flood 21');
    raise exception 'CHECK 13 FAILED: the 21st send within 60s was NOT rate-limited';
  exception when others then
    if sqlerrm like 'RATE_LIMITED%' then v_ok := true;
    else raise exception 'CHECK 13 FAILED: expected RATE_LIMITED on the 21st send, got: %', sqlerrm; end if;
  end;

  if not v_ok then
    raise exception 'CHECK 13 FAILED: the 21st send within 60s did NOT raise RATE_LIMITED';
  end if;
  raise notice 'CHECK 13 passed: 20 sends/60s allowed, the 21st raises RATE_LIMITED';
end $$;


-- -----------------------------------------------------------------------------
-- Housekeeping: remove this file's flags, threads (cascades their messages),
-- and marker sightings, so the seed state stays as-is for other test files and
-- re-runs.
-- -----------------------------------------------------------------------------
do $$
declare
  v_t int; v_f int; v_s int;
begin
  delete from public.flags
  where target_type = 'message'
    and reporter_id in ('11111111-1111-1111-1111-111111111111',
                        '22222222-2222-2222-2222-222222222222',
                        '33333333-3333-3333-3333-333333333333');
  get diagnostics v_f = row_count;

  delete from public.threads
  where post_id in ('a1a1a1a1-0000-0000-0000-000000000001',
                    'a1a1a1a1-0000-0000-0000-000000000006',
                    'a1a1a1a1-0000-0000-0000-000000000017',
                    'a1a1a1a1-0000-0000-0000-000000000021');
  get diagnostics v_t = row_count;

  delete from public.sightings where note like 'CHAT-TEST%';
  get diagnostics v_s = row_count;

  raise notice 'Housekeeping: removed % flag(s), % thread(s) (+messages via cascade), % marker sighting(s)', v_f, v_t, v_s;
end $$;
