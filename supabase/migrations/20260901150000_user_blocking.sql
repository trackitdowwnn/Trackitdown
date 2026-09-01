-- =============================================================================
-- WHAT:  User blocking. Adds public.user_blocks, the three RPCs that manage it
--        (block_user / unblock_user / list_my_blocks), `are_blocked` as the one
--        symmetric predicate, and TWO TRIGGERS that enforce it — no new thread
--        and no new message between blocked accounts. Also widens
--        get_thread_peer with a `blocked` flag so the client can freeze the
--        composer instead of letting someone type into a refusal.
-- WHY:   App Store guideline 1.2 expects an app carrying user-generated content
--        AND private messaging to offer report *and* block. We have had the
--        first since 20260715120000 (`flags`, flag_post, flag_message) and, as
--        of today, nothing whatsoever of the second — no table, no RPC, no UI,
--        anywhere. That is a store rejection, and the last item of ROADMAP's
--        "[~] Flagging … + user blocking".
--
--        Full reasoning, the three decisions and the alternatives rejected:
--        docs/decisions/ADR-0017-user-blocking.md (accepted 2026-09-01).
--
-- ⚠️ A BLOCK MEANS EXACTLY ONE THING HERE: NO CONTACT BETWEEN THESE TWO
--        ACCOUNTS. It does not hide sightings and it does not stop reporting,
--        and both of those are deliberate refusals rather than omissions:
--
--          * HIDING SIGHTINGS WOULD MOVE MONEY. `refund_holds.sighting_ids`
--            names specific sightings and `recent_uncredited_sightings` decides
--            whether a refund is held at all, so a block that hid a sighting
--            could silently refund an owner who should have been held — which
--            hands either party a lever on the other's money.
--          * BLOCKING REPORTING WOULD LET AN OWNER SUPPRESS EVIDENCE. An owner
--            who blocked the spotters whose sightings contradict a recovery
--            claim would remove them from their own case.
--
--        So blocking touches nothing that decides money or evidence. It is the
--        narrowest design that satisfies 1.2, chosen because the narrowest
--        design is the one whose failure modes can be enumerated. It is also
--        WEAKER THAN USERS WILL EXPECT — a blocker still sees the other party's
--        listing in the feed. If that needs fixing it is a separate feature
--        (hide a listing), never a wider block.
--
-- ⚠️ SILENT TO THE BLOCKED PARTY, AND NO NEW REFUSAL TOKEN. Every function
--        touched here already answers a stranger and a non-participant with the
--        same token, on purpose — whether a thread exists is nobody else's
--        business. A blocked caller now joins that set and gets the SAME
--        `NOT_PARTICIPANT`. A distinguishable "you are blocked" would turn the
--        endpoint into an oracle for "has this person blocked me", which on a
--        stolen-car app is information about who someone is.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: one `revoke all … from anon,
--        authenticated` on the NEW table only, removing what this project's
--        ALTER DEFAULT PRIVILEGES hands out at CREATE TABLE (including
--        TRUNCATE — see 20260901130000). No existing table, policy or row is
--        touched. Exactly ONE existing function is replaced — get_thread_peer,
--        restated verbatim from 20260801120000 with one field added — and two
--        triggers are attached to existing tables. `open_thread` and
--        `send_message` are NOT rewritten; §5 explains why that matters.
--
-- LINKS: docs/decisions/ADR-0017-user-blocking.md (the decision record);
--        supabase/migrations/20260715120000_chat.sql (send_message, the `flags`
--          table this parallels, and the threads/messages tables the triggers
--          attach to);
--        supabase/migrations/20260801120000_chat_thread_peer.sql (the
--          get_thread_peer body this replaces — diff against THAT file);
--        supabase/tests/user_blocking_verification.sql;
--        docs/DOMAIN.md (Blocking); docs/SECURITY_AND_TRUST.md §7.
-- =============================================================================


-- =============================================================================
-- 1. TABLE: user_blocks
-- =============================================================================
create table public.user_blocks (
  -- Who asked for the block. Their speech, like a flag — and like a flag, it
  -- dies with them: ON DELETE CASCADE on both sides, so an erased account
  -- leaves no record of who it had blocked or who had blocked it.
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),

  -- The pair IS the identity: blocking twice is the same block, and the
  -- primary key makes block_user idempotent without a single line of logic.
  primary key (blocker_id, blocked_id),

  -- Blocking yourself is meaningless and would make every self-check in the
  -- functions below ambiguous.
  constraint user_blocks_not_self_chk check (blocker_id <> blocked_id)
);

comment on table public.user_blocks is
  'One row per "A has blocked B". Symmetric IN EFFECT — a single row stops contact both ways (see are_blocked) — but one-directional in record, so unblocking is the blocker''s to do. Never shown to the blocked party. Read and written only through block_user / unblock_user / list_my_blocks and the block checks in chat; no client holds any grant on this table.';

-- The lookup every check below performs: "is there a block between these two,
-- in either direction". The PK serves blocker_id; this serves the reverse.
create index user_blocks_blocked_idx on public.user_blocks (blocked_id, blocker_id);

alter table public.user_blocks enable row level security;

-- RLS ENABLED WITH NO CLIENT POLICIES. A block list is not something a client
-- reads directly — list_my_blocks returns it, scoped to the caller — and the
-- blocked party must never be able to read it at all.
--
-- SAFETY: this project ships `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO
-- anon, authenticated`, so CREATE TABLE above has ALREADY handed both roles
-- privileges including TRUNCATE. Per-table grants ADD to that default rather
-- than replacing it, so the revoke must come first and be explicit.
-- anon_role_verification CHECK 13 fails the build if this is forgotten.
revoke all on public.user_blocks from anon, authenticated;

grant select, insert, update, delete on public.user_blocks to service_role;


-- =============================================================================
-- 2. are_blocked(a, b) — the single predicate every check uses
-- =============================================================================
-- ⚠️ ONE DEFINITION, CALLED FROM FOUR PLACES. The alternative — an `exists`
-- subquery repeated in each function — is how the two halves of a symmetric
-- rule drift apart, and a block that works in one direction only is worse than
-- no block because the person who asked for it believes they are protected.
create or replace function public.are_blocked(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.user_blocks b
     where (b.blocker_id = p_a and b.blocked_id = p_b)
        or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;

comment on function public.are_blocked(uuid, uuid) is
  'True when EITHER account has blocked the other. The single symmetric predicate behind every block check; one definition so the two directions cannot drift apart. Server-side only.';

revoke execute on function public.are_blocked(uuid, uuid) from public, anon, authenticated;
grant execute on function public.are_blocked(uuid, uuid) to service_role;


-- =============================================================================
-- 3. block_user / unblock_user / list_my_blocks
-- =============================================================================
-- ⚠️ TAKES A THREAD, NOT A USER ID. The client never holds the other party's
-- uid — that is the whole point of get_thread_peer returning a first name and
-- no id (SECURITY_AND_TRUST §1), and open_thread_for_sighting exists so an
-- owner's client never learns a spotter uid either. An RPC taking p_user_id
-- would either be uncallable or would force us to start handing uids to
-- clients, undoing a deliberate privacy boundary to add a safety feature.
create or replace function public.block_user(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_thread public.threads%rowtype;
  v_other  uuid;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_thread from public.threads where id = p_thread_id;
  -- Same token for a missing thread and someone else's thread, as everywhere
  -- else in chat: no existence oracle.
  if not found or v_caller not in (v_thread.owner_id, v_thread.spotter_id) then
    raise exception 'NOT_PARTICIPANT';
  end if;

  v_other := case when v_caller = v_thread.owner_id
                  then v_thread.spotter_id else v_thread.owner_id end;

  -- Idempotent by the primary key rather than by a check: two taps, one block.
  insert into public.user_blocks (blocker_id, blocked_id)
  values (v_caller, v_other)
  on conflict (blocker_id, blocked_id) do nothing;
end $$;

comment on function public.block_user(uuid) is
  'Blocks the OTHER participant of a thread the caller is in. Takes a thread id because a client never holds the other party''s uid (SECURITY_AND_TRUST §1). Idempotent. Raises NOT_PARTICIPANT for a missing thread or one the caller is not in — the same token, so it is not an existence oracle.';

-- Unblock takes the blocked user's id, which the caller legitimately has:
-- list_my_blocks gave it to them. This is the one direction where holding the
-- uid is fine — it is a person they have already blocked.
create or replace function public.unblock_user(p_blocked_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- No "not found" complaint: unblocking someone who is not blocked is the
  -- state the caller wanted, and telling them otherwise leaks nothing useful.
  delete from public.user_blocks
   where blocker_id = v_caller and blocked_id = p_blocked_id;
end $$;

comment on function public.unblock_user(uuid) is
  'Removes the caller''s block on one account. Silent when no such block exists — that is already the state the caller asked for. Only ever deletes rows the CALLER created, so it cannot lift somebody else''s block.';

-- ⚠️ RETURNS THE BLOCKED PARTY'S FIRST NAME AND ID ONLY. Same passport rule as
-- get_thread_peer: no display_name (may carry a surname), no avatar_path (it
-- embeds the uid). The id is returned because unblock_user needs it and the
-- caller has already demonstrated they know this person.
create or replace function public.list_my_blocks()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_rows   jsonb;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select b.blocked_id as id,
           b.created_at,
           p.first_name
      from public.user_blocks b
      join public.profiles p on p.id = b.blocked_id
     where b.blocker_id = v_caller
  ) as r;

  return jsonb_build_object('blocks', v_rows);
end $$;

comment on function public.list_my_blocks() is
  'The caller''s own block list, newest first: blocked id, first name and when. Never returns who has blocked the CALLER — that is the blocked party''s business and telling them would make this an oracle.';

revoke execute on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated, service_role;
revoke execute on function public.unblock_user(uuid) from public, anon;
grant execute on function public.unblock_user(uuid) to authenticated, service_role;
revoke execute on function public.list_my_blocks() from public, anon;
grant execute on function public.list_my_blocks() to authenticated, service_role;


-- =============================================================================
-- 4. get_thread_peer — now reports whether contact is blocked
-- =============================================================================
-- ⚠️ THE CLIENT HAS TO KNOW, OR "FREEZE READ-ONLY" IS JUST A REFUSAL. ADR-0017
-- Q1 keeps a blocked thread visible with its history intact and no way to send.
-- Without this flag the composer would look live, and a user would type a
-- message and be told no — which reads as the app being broken, and on the
-- blocked party's side would also reveal the block.
--
-- Restated in full rather than diffed: 20260801120000 is the version being
-- replaced, and the peer passport below is unchanged from it.
create or replace function public.get_thread_peer(p_thread_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_caller uuid := auth.uid();
  v_thread public.threads%rowtype;
  v_is_owner boolean;
  v_their_read timestamptz;
  v_peer jsonb;
  v_blocked boolean;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_thread from public.threads where id = p_thread_id;
  -- Missing thread and non-participant raise the SAME token: whether a
  -- thread id exists is nobody else's business (no existence oracle — the
  -- open_thread convention).
  if not found or v_caller not in (v_thread.owner_id, v_thread.spotter_id) then
    raise exception 'NOT_PARTICIPANT';
  end if;

  v_is_owner := v_caller = v_thread.owner_id;
  v_their_read := case
    when v_is_owner then v_thread.spotter_last_read_at
    else v_thread.owner_last_read_at
  end;

  -- ⚠️ SYMMETRIC AND UNATTRIBUTED. True whether the caller blocked them or they
  -- blocked the caller, and it does not say which — the blocked party sees a
  -- frozen thread and cannot tell a block from the other person simply having
  -- stopped replying. That ambiguity is the feature.
  v_blocked := public.are_blocked(v_thread.owner_id, v_thread.spotter_id);

  if v_is_owner then
    -- The spotter's passport: first name + reputation + member-since ONLY.
    -- No display_name (may carry a surname), no avatar_path (embeds the
    -- uid), no id. Widening this select is a privacy decision — update
    -- docs/DOMAIN.md and the client's PublicProfile boundary first.
    select jsonb_build_object(
             'first_name',          p.first_name,
             'created_at',          p.created_at,
             'sightings_reported',  p.sightings_reported,
             'sightings_helpful',   p.sightings_helpful,
             'recoveries_credited', p.recoveries_credited)
      into v_peer
      from public.profiles p
     where p.id = v_thread.spotter_id;
  else
    v_peer := null;
  end if;

  return jsonb_build_object(
    'their_last_read_at', v_their_read,
    'blocked',            v_blocked,
    'peer',               v_peer);
end;
$$;

comment on function public.get_thread_peer(uuid) is
  'Thread header data for a participant: the other side''s last-read time, whether contact is BLOCKED in either direction (unattributed, so the blocked party cannot tell a block from silence), and — for the owner only — the spotter''s passport (first name, member-since, reputation counters). Never a display_name, avatar_path or uid.';

revoke execute on function public.get_thread_peer(uuid) from public, anon;
grant execute on function public.get_thread_peer(uuid) to authenticated, service_role;


-- =============================================================================
-- 5. THE ENFORCEMENT — two triggers, not two rewritten functions
-- =============================================================================
-- ⚠️ THIS WAS DRAFTED AS `create or replace function send_message(...)` WITH A
-- BLOCK CHECK ADDED, AND THAT DRAFT WAS DANGEROUS. `create or replace` needs
-- the WHOLE body, so adding four lines means hand-copying two hundred — and the
-- copy silently dropped `pg_advisory_xact_lock` (the race guard on the rate
-- limit), renamed POST_CLOSED to THREAD_CLOSED (which the client maps), and
-- returned a different payload shape than chatApi parses. Every one of those is
-- invisible in review because the diff looks like "a function was replaced".
--
-- Triggers express the same rule as an INVARIANT instead: no message may exist
-- in a thread between blocked accounts, and no thread may be created between
-- them. That has three advantages over the check-in-a-function version:
--
--   * It touches no existing function body, so nothing can be lost in a copy.
--   * It cannot be bypassed by a FUTURE writer. open_thread has already been
--     replaced twice (20260829120000, and before that), and a check living
--     inside it would have to be carried forward by hand each time — the exact
--     mechanism by which the `kind` filters in ADR-0014 went missing for four
--     days and an hourly cron refunded platform fees.
--   * It covers open_thread AND open_thread_for_sighting from one place,
--     because the second delegates to the first.
--
-- The cost is that a trigger raises from further away than an inline check, so
-- the token is stated explicitly below to keep the no-oracle rule intact.

create or replace function public.reject_blocked_thread()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.are_blocked(new.owner_id, new.spotter_id) then
    -- ⚠️ THE SAME TOKEN open_thread ALREADY RAISES for a stranger. A
    -- distinguishable refusal would tell the blocked party they were blocked,
    -- and thread creation is exactly the endpoint they would poll to find out.
    raise exception 'NOT_PARTICIPANT';
  end if;
  return new;
end $$;

comment on function public.reject_blocked_thread() is
  'BEFORE INSERT on threads: refuses a new thread between two accounts where either has blocked the other, with the same NOT_PARTICIPANT token a stranger gets. A trigger rather than a check inside open_thread, so a future replacement of that function cannot drop it.';

create trigger threads_reject_blocked
  before insert on public.threads
  for each row execute function public.reject_blocked_thread();

create or replace function public.reject_blocked_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner   uuid;
  v_spotter uuid;
begin
  select t.owner_id, t.spotter_id into v_owner, v_spotter
    from public.threads t
   where t.id = new.thread_id;

  if found and public.are_blocked(v_owner, v_spotter) then
    raise exception 'NOT_PARTICIPANT';
  end if;
  return new;
end $$;

comment on function public.reject_blocked_message() is
  'BEFORE INSERT on messages: refuses a message in a thread between two accounts where either has blocked the other — the read-only freeze of ADR-0017 Q1. Raises NOT_PARTICIPANT, the token send_message already uses for a thread the caller is not in, so a blocked sender cannot tell the two apart.';

create trigger messages_reject_blocked
  before insert on public.messages
  for each row execute function public.reject_blocked_message();

revoke execute on function public.reject_blocked_thread() from public, anon, authenticated;
revoke execute on function public.reject_blocked_message() from public, anon, authenticated;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
