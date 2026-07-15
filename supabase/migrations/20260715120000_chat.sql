-- =============================================================================
-- WHAT:  Chat feature database layer. Creates public.threads (one owner<->spotter
--        conversation per post), public.messages (its messages, incl. the
--        automatic system safety message), and public.flags (the minimal generic
--        flag row the later moderation feature builds its queue on); adds
--        public.messages to the supabase_realtime publication (postgres_changes
--        respects the SELECT RLS); and six SECURITY DEFINER RPCs:
--          * open_thread              — the ONLY way a thread is created. Gated
--                                       on the spotter having >=1 sighting on
--                                       the post ("no cold DMs") and the post
--                                       being active to CREATE; idempotent per
--                                       (post, spotter); atomically inserts the
--                                       system safety message. Returning an
--                                       existing thread is ungated (history).
--          * open_thread_for_sighting — the OWNER's entry point: resolves a
--                                       sighting id to its (post, spotter) pair
--                                       SERVER-side (the owner's client never
--                                       holds spotter ids — §1) and delegates
--                                       to open_thread.
--          * send_message             — the ONLY client write of a message.
--                                       Participant + active-post + per-sender
--                                       rolling-window rate-limit gates;
--                                       denormalises the thread's
--                                       last_message_at / last_message_preview.
--          * mark_thread_read         — stamps the CALLER's side read marker.
--          * get_inbox                — the caller's threads, newest activity
--                                       first, with unread counts, a first-name-
--                                       ONLY view of the other participant, and
--                                       the post (plate to the owner only).
--          * flag_message             — two-tap flagging of a message (§7);
--                                       idempotent per (reporter, target).
-- WHY:   DOMAIN.md "Chat": a thread opens between owner and a spotter ONLY after
--        that spotter reported a sighting on the owner's post — no cold DMs —
--        and carries an automatic first message reminding both parties of the
--        safety rules (meetups discouraged; recovery is for the owner and
--        police). SECURITY_AND_TRUST §1 (report, don't approach; participant
--        identity minimisation — get_post_sightings strips spotter ids from the
--        owner's payload, which is why the owner-side open is sighting-id
--        based, and why the inbox never returns avatar_path, which embeds a
--        uid), §6 ("messages: only the two thread participants"; RLS
--        deny-by-default; server-only writes), §7 (any user can flag a message
--        in two taps; the moderator queue is service-role). Raw thread/message
--        rows are participant-only, so ALL client writes go through the RPCs —
--        no client INSERT/UPDATE/DELETE policy or grant exists on any of the
--        three tables.
-- LINKS: docs/DOMAIN.md (Chat; lifecycle; Reputation v1),
--        docs/SECURITY_AND_TRUST.md §1 (safety line; identity minimisation),
--          §6 (messages participant-only; deny-by-default; SECURITY DEFINER),
--          §7 (flagging in two taps; moderator queue + audit later),
--        supabase/migrations/20260714100000_sightings.sql (sightings gating
--          rows; get_post_sightings exposing sighting ids but never spotter
--          ids; grants posture, error-token style, advisory-lock rolling-window
--          rate limit, and the "no anon grants — 20260713191000 incident"
--          convention all mirrored),
--        supabase/migrations/20260713190000_post_a_car.sql (posts shape),
--        supabase/migrations/20260713170000_post_detail_owner_no_avatar_path.sql
--          (the SAME no-avatar-path-because-it-embeds-owner_id call made here
--          for the inbox other-participant block),
--        supabase/migrations/20260713140000_post_detail.sql (post_photos
--          url/position used for the inbox cover photo),
--        supabase/migrations/20260710120000_profile_fields_and_avatars.sql
--          (profiles.first_name / avatar_path — avatar_path CHECK-pinned to
--          '<uid>/avatar.jpg', hence deliberately NOT returned by the inbox).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: NONE. Fully additive — three new
--        tables + indexes + RLS + grants, one guarded ALTER PUBLICATION ...
--        ADD TABLE (idempotent, additive), and six new functions + grants.
--        No drop / rename / truncate of any existing object.
-- =============================================================================


-- =============================================================================
-- 1. TABLE: threads
-- One conversation per (post, spotter) pair. The owner is implied by the post
-- but denormalized onto the row for cheap RLS (no posts join per policy check);
-- open_thread PINS it from the post row, never from caller input.
-- =============================================================================
create table public.threads (
  id          uuid primary key default gen_random_uuid(),

  -- The post this conversation is about. ON DELETE CASCADE: a thread is
  -- conversation ABOUT a post and carries no independent value once the post
  -- row is gone; a post cannot be deleted while money is in flight anyway
  -- (payments' ON DELETE RESTRICT blocks the cascade).
  post_id     uuid not null references public.posts (id) on delete cascade,

  -- The post's owner, DENORMALIZED from posts for cheap RLS and inbox queries.
  -- Pinned by open_thread from the post row — never client input. ON DELETE
  -- CASCADE: UK GDPR erasure of either participant removes the conversation
  -- (SECURITY_AND_TRUST §3) — a one-sided chat has no value.
  owner_id    uuid not null references public.profiles (id) on delete cascade,

  -- The spotter side of the pair. ON DELETE CASCADE: same erasure reasoning.
  spotter_id  uuid not null references public.profiles (id) on delete cascade,

  -- One thread per (post, spotter) pair — the owner is implied by the post.
  -- open_thread leans on this as the concurrency backstop.
  constraint threads_post_spotter_uniq unique (post_id, spotter_id),

  -- An owner can never thread with themselves (own-post sightings are already
  -- rejected by create_sighting, so this is belt-and-braces).
  constraint threads_owner_not_spotter_chk check (owner_id <> spotter_id),

  -- Inbox sort key; bumped by send_message (and set by open_thread's system
  -- message). Denormalized so the inbox never scans messages for ordering.
  last_message_at      timestamptz not null default now(),

  -- Denormalized preview of the latest message (open_thread seeds it from the
  -- system message; send_message overwrites). Bounded to 140 chars.
  last_message_preview text
    constraint threads_preview_len_chk
      check (char_length(last_message_preview) <= 140),

  -- Per-side read markers (unread = messages newer than MY marker not sent by
  -- me). Stamped ONLY by mark_thread_read; default now() so the opening
  -- transaction's system message starts read for both sides.
  owner_last_read_at   timestamptz not null default now(),
  spotter_last_read_at timestamptz not null default now(),

  created_at  timestamptz not null default now()
);

comment on table public.threads is
  'One owner<->spotter conversation per (post, spotter) pair (DOMAIN.md Chat: opens only after a sighting — no cold DMs). Created ONLY by open_thread (SECURITY DEFINER) / service role; read by its two participants via RLS; all client writes (messages, read markers) go through RPCs. SECURITY_AND_TRUST §6.';
comment on column public.threads.owner_id is
  'Denormalized from posts.owner_id by open_thread (never client input) so RLS and the inbox need no posts join.';
comment on column public.threads.last_message_preview is
  'Denormalized left(content, 140) of the latest message; maintained by open_thread (system message) and send_message.';

-- Inbox query + the RLS owner branch: the owner''s threads, newest activity first.
create index threads_owner_last_message_idx
  on public.threads (owner_id, last_message_at);

-- Inbox query + the RLS spotter branch: the spotter''s threads, newest first.
create index threads_spotter_last_message_idx
  on public.threads (spotter_id, last_message_at);

alter table public.threads enable row level security;

-- SAFETY: under this project's config (auto_expose_new_tables unset) a new
-- public table auto-grants NO data privileges, so the SELECT policy below is
-- dead without an explicit table-level grant. SELECT to authenticated ONLY —
-- NEVER anon (chat needs an account; anon stays grant-denied 42501, the
-- 20260713191000 incident convention). NO client insert/update/delete grant —
-- every write goes through open_thread / send_message / mark_thread_read
-- (SECURITY DEFINER, run as owner). service_role bypasses RLS but is not
-- auto-granted, so give it full DML (moderation and retention use it).
grant select on public.threads to authenticated;
grant select, insert, update, delete on public.threads to service_role;

-- SAFETY: a signed-in user may read a thread ONLY when they are one of its two
-- participants (SECURITY_AND_TRUST §6: messages/threads are participant-only).
-- No write policy exists -> client writes denied by default.
create policy threads_select_participant
  on public.threads
  for select
  to authenticated
  using ((select auth.uid()) in (owner_id, spotter_id));


-- =============================================================================
-- 2. TABLE: messages
-- The messages of a thread, including the automatic system safety message.
-- =============================================================================
create table public.messages (
  id         uuid primary key default gen_random_uuid(),

  -- Parent thread. ON DELETE CASCADE: messages are wholly owned by their
  -- thread and die with it.
  thread_id  uuid not null references public.threads (id) on delete cascade,

  -- Who sent it; NULL for system messages (the platform speaks, not a user).
  -- ON DELETE CASCADE: UK GDPR erasure of a sender removes their messages
  -- (their whole threads cascade away via threads' FKs anyway).
  sender_id  uuid references public.profiles (id) on delete cascade,

  -- 'system' = platform-authored (e.g. the opening safety message, sender NULL);
  -- 'user' = participant-authored (sender required). The pairing CHECK makes a
  -- forged "system" message from a user (or an anonymous user message)
  -- unrepresentable at the schema level.
  kind       text not null default 'user'
    constraint messages_kind_chk
      check (kind in ('system', 'user')),
  constraint messages_kind_sender_chk
    check ((kind = 'system' and sender_id is null)
        or (kind = 'user'   and sender_id is not null)),

  -- Bounded so a client cannot pad an unbounded blob into the other
  -- participant's payload.
  content    text not null
    constraint messages_content_len_chk
      check (char_length(content) between 1 and 2000),

  created_at timestamptz not null default now()
);

comment on table public.messages is
  'Messages of a thread (DOMAIN.md Chat). kind=system rows are platform-authored (sender NULL — e.g. the opening safety message); kind=user rows are written ONLY by send_message (SECURITY DEFINER) / service role. Readable by the two thread participants only (SECURITY_AND_TRUST §6); Realtime postgres_changes respects that SELECT RLS.';
comment on column public.messages.kind is
  'system (platform, sender NULL) | user (participant, sender required) — the pairing CHECK makes forged system messages unrepresentable.';

-- Thread history fetch in time order + the unread-count subquery in get_inbox +
-- send_message's rolling-window rate-limit count.
create index messages_thread_created_idx
  on public.messages (thread_id, created_at);

-- GDPR erasure of a sender cascades via this FK; index it so the cascade (and
-- any later by-sender moderation lookup) does not seq-scan the whole table.
create index messages_sender_id_idx
  on public.messages (sender_id);

alter table public.messages enable row level security;

-- SAFETY: same grant posture as threads — SELECT to authenticated only (never
-- anon), no client write grant, full DML for service_role (moderation acts on
-- flagged messages under the service role).
grant select on public.messages to authenticated;
grant select, insert, update, delete on public.messages to service_role;

-- SAFETY: a signed-in user may read a message ONLY when they participate in its
-- thread (SECURITY_AND_TRUST §6: "messages: only the two thread participants").
-- No write policy exists -> client writes denied by default.
create policy messages_select_participant
  on public.messages
  for select
  to authenticated
  using (
    exists (
      select 1 from public.threads t
      where t.id = messages.thread_id
        and (select auth.uid()) in (t.owner_id, t.spotter_id)
    )
  );

-- --- REALTIME ----------------------------------------------------------------
-- SAFETY: Realtime postgres_changes delivers a row only to subscribers whose
-- SELECT RLS passes for that row, so adding messages to the publication exposes
-- each message to its two thread participants ONLY (the policy above). Guarded
-- for idempotence AND for a stack without the standard supabase_realtime
-- publication (hosted projects and the local stack both ship it; a bare
-- Postgres running these migrations should not fail on its absence).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename  = 'messages'
    ) then
      alter publication supabase_realtime add table public.messages;
    end if;
  end if;
end $$;


-- =============================================================================
-- 3. TABLE: flags
-- Minimal generic flag row (SECURITY_AND_TRUST §7: any user can flag a post,
-- sighting, photo, or message in two taps). The moderation feature builds its
-- queue on this later; only flag_message writes it in this migration.
-- =============================================================================
create table public.flags (
  id          uuid primary key default gen_random_uuid(),

  -- Who raised the flag. ON DELETE CASCADE: erasure of the reporter removes
  -- their flags (a flag is the reporter's speech, not evidence we must keep).
  reporter_id uuid not null references public.profiles (id) on delete cascade,

  -- Polymorphic target: no FK on target_id (it points into a different table
  -- per target_type); the writing RPC validates existence + the reporter's
  -- right to see the target before inserting. Kept generic so the moderation
  -- feature reuses one table for all four flaggable types (§7).
  target_type text not null
    constraint flags_target_type_chk
      check (target_type in ('message', 'post', 'sighting', 'photo')),
  target_id   uuid not null,

  -- Optional free-text reason. Bounded.
  reason      text
    constraint flags_reason_len_chk
      check (reason is null or char_length(reason) <= 500),

  created_at  timestamptz not null default now(),

  -- One flag per reporter per target — re-flagging is idempotent, not spam.
  constraint flags_reporter_target_uniq unique (reporter_id, target_type, target_id)
);

comment on table public.flags is
  'Generic user flags (SECURITY_AND_TRUST §7). Written ONLY by flagging RPCs (flag_message here; post/sighting/photo flags arrive with later features) / service role. NO client read: a reporter never browses flags; the moderator queue reads under the service role.';
comment on column public.flags.target_id is
  'Polymorphic — the flagged row''s id in the table named by target_type. No FK; the writing RPC validates the target.';

-- The later moderator queue: fetch all flags on one target / list by type.
-- (Service-role reads bypass RLS but still want the index.)
create index flags_target_idx
  on public.flags (target_type, target_id);

alter table public.flags enable row level security;

-- SAFETY: NO grant to authenticated AT ALL (not even SELECT): a reporter never
-- browses flags, and the moderator queue is service-role (§7). flag_message is
-- SECURITY DEFINER (runs as owner), so it needs no client table grant. NEVER
-- anon. service_role gets full DML for the moderation queue; no RLS policy
-- exists for any client role -> deny by default even if a grant ever appears.
grant select, insert, update, delete on public.flags to service_role;


-- =============================================================================
-- 4. RPC: open_thread(post_id, spotter_id?) -> jsonb  (the ONLY thread creator)
-- =============================================================================
-- Opens (or returns) THE thread for a (post, spotter) pair and returns
-- { "thread_id": <uuid>, "created": <bool> }.
--
-- SAFETY (Tier 1 — read before editing anything below):
--   * SECURITY DEFINER: bypasses RLS/grants so this one trusted path can insert
--     threads + the system message (no client write grant exists) — while
--     PINNING owner_id from the POST row (never caller input) and gating on the
--     sighting requirement (DOMAIN.md Chat: no cold DMs).
--   * Caller roles: the post's OWNER may open toward a named spotter
--     (p_spotter_id required — in practice the owner's CLIENT never holds a
--     spotter id (§1), so owners arrive via open_thread_for_sighting below,
--     which resolves the spotter server-side and delegates here), or the
--     SPOTTER opens toward the owner (p_spotter_id null or their own uid).
--     Anyone else -> NOT_PARTICIPANT.
--   * A missing post and a sighting-less pair raise the SAME 'NO_SIGHTING'
--     token, so this RPC is not an existence oracle for hidden posts.
--   * CREATING a thread requires the post be 'active' (POST_CLOSED otherwise) —
--     so no unsolicited opening system message can appear in a spotter's inbox
--     on a long-closed post. RETURNING an existing thread is UNGATED, so chat
--     history survives recovery/closure (a thread can only pre-exist if it was
--     created while the post was active). send_message likewise enforces active
--     on every message.
--   * Idempotent: an existing (post, spotter) thread is returned with
--     created=false. An advisory xact lock on the pair serialises concurrent
--     opens (same idiom as create_sighting's rate-limit lock); the UNIQUE
--     constraint is the backstop.
--   * Machine-token errors: NOT_AUTHENTICATED / INVALID_INPUT / NOT_PARTICIPANT
--     / NO_SIGHTING / OWN_POST / POST_CLOSED — 'TOKEN' or 'TOKEN: detail', as
--     create_sighting.
create or replace function public.open_thread(
  p_post_id    uuid,
  p_spotter_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_caller      uuid := auth.uid();
  v_owner       uuid;
  v_spotter     uuid;
  v_post_status public.post_status;
  v_thread_id   uuid;
  -- SAFETY: the EXACT automatic first message (DOMAIN.md Chat: reminds both
  -- parties of the safety rules; meetups/recovery attempts are discouraged —
  -- SECURITY_AND_TRUST §1 "report, don't approach"). Do not reword casually:
  -- the client and tests assert this text.
  v_system_msg constant text :=
    'Safety first: report from a distance and never arrange to meet or attempt a recovery yourselves — recovery is for the owner and police. If a crime is in progress, call 999.';
begin
  -- SAFETY: must be signed in (execute is granted to authenticated +
  -- service_role only, never anon — this is a belt-and-braces backstop).
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- --- Resolve the pair --------------------------------------------------------
  -- Missing post: fall through with v_owner NULL — the caller can never match a
  -- NULL owner, so the spotter branch runs and the sighting gate below raises
  -- NO_SIGHTING (the SAME token as a real post with no sighting — no existence
  -- oracle for hidden/deleted posts).
  select p.owner_id, p.status into v_owner, v_post_status
  from public.posts p
  where p.id = p_post_id;

  if v_owner is not null and v_caller = v_owner then
    -- OWNER opening toward a spotter: the spotter must be named.
    if p_spotter_id is null then
      raise exception 'INVALID_INPUT: spotter_id required when the owner opens';
    end if;
    v_spotter := p_spotter_id;
  elsif p_spotter_id is null or p_spotter_id = v_caller then
    -- SPOTTER opening toward the owner (p_spotter_id omitted or their own uid).
    v_spotter := v_caller;
  else
    -- A non-owner naming somebody else: never allowed (no third-party opens).
    raise exception 'NOT_PARTICIPANT';
  end if;

  -- SAFETY: an owner can never thread with themselves (belt-and-braces — an
  -- own-post sighting cannot exist, so the gate below would catch it anyway;
  -- kept so the invariant does not silently rest on create_sighting).
  if v_owner is not null and v_owner = v_spotter then
    raise exception 'OWN_POST';
  end if;

  -- --- NO_SIGHTING gate (DOMAIN.md Chat: no cold DMs) ----------------------------
  -- The pair must have at least one sighting: the spotter earned the contact
  -- path by reporting on THIS post. Also (deliberately) the failure mode for a
  -- missing post — same token, no existence oracle.
  if not exists (
    select 1 from public.sightings s
    where s.post_id = p_post_id
      and s.spotter_id = v_spotter
  ) then
    raise exception 'NO_SIGHTING';
  end if;

  -- --- Idempotent open -----------------------------------------------------------
  -- Advisory xact lock on the (post, spotter) pair serialises concurrent opens
  -- so two parallel calls cannot both miss the SELECT and race the insert (the
  -- UNIQUE constraint would stop the second anyway; the lock turns that raw
  -- error into the clean created=false path). Releases at transaction end.
  perform pg_advisory_xact_lock(
    hashtextextended('open_thread:' || p_post_id::text || ':' || v_spotter::text, 0));

  select t.id into v_thread_id
  from public.threads t
  where t.post_id = p_post_id
    and t.spotter_id = v_spotter;
  if v_thread_id is not null then
    -- SAFETY: returning an EXISTING thread is UNGATED by post status — chat
    -- history must stay reachable after the post closes.
    return jsonb_build_object('thread_id', v_thread_id, 'created', false);
  end if;

  -- --- POST_CLOSED: a NEW thread may be created only on an ACTIVE post ----------
  -- (Returning an existing thread already happened above, ungated.) This blocks
  -- an unsolicited opening system message landing in a spotter's inbox on a
  -- long-closed post; mirrors send_message's active gate.
  if v_post_status is distinct from 'active' then
    raise exception 'POST_CLOSED';
  end if;

  -- --- Atomic create: thread + THE system safety message --------------------------
  -- SAFETY: owner_id pinned from the POST row (v_owner), never caller input.
  -- The system message and the thread land in ONE transaction; the preview is
  -- seeded from the system message (truncated to the 140-char bound) and
  -- last_message_at from the same clock, so a freshly opened thread sorts and
  -- previews correctly in both inboxes.
  insert into public.threads (
    post_id, owner_id, spotter_id, last_message_at, last_message_preview
  )
  values (
    p_post_id, v_owner, v_spotter, now(), left(v_system_msg, 140)
  )
  returning id into v_thread_id;

  insert into public.messages (thread_id, sender_id, kind, content)
  values (v_thread_id, null, 'system', v_system_msg);

  -- AUDIT: a thread-opened audit-log insert belongs here once the audit_log
  -- table exists (SECURITY_AND_TRUST §7). Deferred with the moderation feature.

  return jsonb_build_object('thread_id', v_thread_id, 'created', true);
end;
$$;

comment on function public.open_thread(uuid, uuid) is
  'The ONLY thread creator. SECURITY DEFINER: gates on the (post, spotter) pair having >=1 sighting (DOMAIN.md Chat: no cold DMs; missing posts raise the SAME NO_SIGHTING token — no existence oracle), pins owner_id from the post row, and atomically inserts the thread + the automatic system safety message (seeding last_message_preview/last_message_at). Idempotent per (post, spotter) via advisory lock + UNIQUE: an existing thread returns created=false. CREATING a new thread requires the post be active (POST_CLOSED); RETURNING an existing thread is ungated so history stays reachable (send_message also enforces active). Owners in practice arrive via open_thread_for_sighting (their client never holds spotter ids — §1). Raises: NOT_AUTHENTICATED, INVALID_INPUT, NOT_PARTICIPANT, NO_SIGHTING, OWN_POST, POST_CLOSED.';

-- SAFETY: functions default to EXECUTE for PUBLIC, and this project's default
-- privileges ALSO auto-grant EXECUTE to anon at CREATE time (the 20260713191000
-- incident) — revoke BOTH explicitly, then grant to authenticated +
-- service_role only. Chat requires an account.
revoke execute on function public.open_thread(uuid, uuid) from public, anon;
grant  execute on function public.open_thread(uuid, uuid) to authenticated, service_role;


-- =============================================================================
-- 5. RPC: open_thread_for_sighting(sighting_id) -> jsonb  (the OWNER's entry)
-- =============================================================================
-- Opens (or returns) the thread for the pair behind ONE sighting and returns
-- the same { "thread_id": <uuid>, "created": <bool> } shape as open_thread.
--
-- WHY THIS RPC EXISTS (SECURITY_AND_TRUST §1): the owner's client legitimately
-- holds SIGHTING ids (get_post_sightings returns them) but must NEVER hold
-- SPOTTER ids (get_post_sightings strips them — spotter identity reaches the
-- owner as first name + reputation only). So the owner cannot call
-- open_thread(post_id, spotter_id) directly; this RPC resolves sighting ->
-- (post, spotter) SERVER-side and delegates, keeping the spotter uid on the
-- server for its whole journey.
--
-- SAFETY:
--   * The CALLER must be the OWNER of the sighting's post. A missing sighting
--     and a sighting on somebody else's post raise the SAME 'NOT_PARTICIPANT'
--     token — this RPC is not an existence oracle for sighting ids (which are
--     otherwise visible only to the sighting's spotter and the post's owner).
--   * DELEGATES to open_thread for the actual creation, so there is exactly ONE
--     creation path: the sighting gate, owner pinning, the active-post CREATE
--     gate, idempotence lock, and the system safety message all live in one
--     place. The caller IS the post's owner here, so open_thread's owner branch
--     runs with the resolved spotter — the spotter uid never transits the
--     client. POST_CLOSED therefore propagates when the owner tries to CREATE a
--     new thread on a closed post (an existing thread still returns).
create or replace function public.open_thread_for_sighting(p_sighting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_caller  uuid := auth.uid();
  v_post_id uuid;
  v_spotter uuid;
  v_owner   uuid;
begin
  -- SAFETY: must be signed in (grant below excludes anon; this is the backstop).
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: missing sighting -> the SAME token as "not the owner" below, so a
  -- probe learns nothing about which sighting ids exist.
  select s.post_id, s.spotter_id into v_post_id, v_spotter
  from public.sightings s
  where s.id = p_sighting_id;
  if not found then
    raise exception 'NOT_PARTICIPANT';
  end if;

  -- SAFETY: only the OWNER of the sighting's post may use this entry (the
  -- spotter side already knows the post id and uses open_thread; a third party
  -- gets the same token as a missing sighting).
  select p.owner_id into v_owner
  from public.posts p
  where p.id = v_post_id;
  if v_owner is null or v_owner <> v_caller then
    raise exception 'NOT_PARTICIPANT';
  end if;

  -- Delegate: one creation path. The caller is the owner, so open_thread's
  -- owner branch runs with the server-resolved spotter (idempotence, the
  -- sighting gate, the active-post CREATE gate, and the system safety message
  -- all happen there).
  return public.open_thread(v_post_id, v_spotter);
end;
$$;

comment on function public.open_thread_for_sighting(uuid) is
  'The OWNER''s thread entry point: resolves a sighting id to its (post, spotter) pair SERVER-side — the owner''s client holds sighting ids (get_post_sightings) but never spotter ids (SECURITY_AND_TRUST §1) — verifies the caller owns the sighting''s post, and DELEGATES to open_thread (single creation path: sighting gate, owner pinning, active-post CREATE gate, idempotence, system safety message). Returns the same { thread_id, created } shape. Raises: NOT_AUTHENTICATED, NOT_PARTICIPANT (same token for missing sightings and non-owners), and POST_CLOSED when creating on a non-active post (an existing thread still returns).';

-- SAFETY: same lockdown as open_thread — no PUBLIC, no anon.
revoke execute on function public.open_thread_for_sighting(uuid) from public, anon;
grant  execute on function public.open_thread_for_sighting(uuid) to authenticated, service_role;


-- =============================================================================
-- 6. RPC: send_message(thread_id, content) -> jsonb  (the ONLY message writer)
-- =============================================================================
-- Sends one user message into a thread the caller participates in and returns
-- the inserted row as jsonb { id, thread_id, sender_id, kind, content,
-- created_at }.
--
-- SAFETY:
--   * sender_id PINNED to the caller; kind HARD-CODED 'user' (system messages
--     are platform-only — the schema CHECK makes a forged one unrepresentable).
--   * A missing thread and a thread the caller does not participate in raise
--     the SAME 'NOT_PARTICIPANT' token — no existence oracle for threads.
--   * The post must be 'active': once a post closes (recovered / cancelled /
--     expired / ...) the conversation freezes read-only ('POST_CLOSED') — chat
--     exists to relay sighting context, not to arrange post-recovery meetups
--     (SECURITY_AND_TRUST §1).
--   * RATE_LIMITED: at most 20 messages per sender per thread per rolling 60s
--     (advisory-lock + rolling-window, mirroring create_sighting) — caps
--     harassment/flood and the DB/Realtime growth an unbounded loop would cause.
--   * Denormalises threads.last_message_at / last_message_preview in the same
--     transaction, so inbox ordering can never drift from message history.
create or replace function public.send_message(
  p_thread_id uuid,
  p_content   text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_caller      uuid := auth.uid();
  v_owner       uuid;
  v_spotter     uuid;
  v_post_id     uuid;
  v_post_status public.post_status;
  v_content     text;
  v_recent      int;
  v_msg_id      uuid;
  v_created_at  timestamptz;
begin
  -- SAFETY: backstop; the grant below already excludes anon.
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- --- NOT_PARTICIPANT: missing thread and foreign thread give the SAME token --
  select t.owner_id, t.spotter_id, t.post_id
    into v_owner, v_spotter, v_post_id
  from public.threads t
  where t.id = p_thread_id;
  if not found or v_caller not in (v_owner, v_spotter) then
    raise exception 'NOT_PARTICIPANT';
  end if;

  -- --- POST_CLOSED: messages only while the post is live ------------------------
  -- (open_thread deliberately does NOT require active to RETURN an existing
  -- thread — history stays readable; THIS is the write-side enforcement.)
  select p.status into v_post_status
  from public.posts p
  where p.id = v_post_id;
  if v_post_status <> 'active' then
    raise exception 'POST_CLOSED';
  end if;

  -- --- INVALID_INPUT: trimmed non-empty, bounded --------------------------------
  -- Same bound as the messages CHECK; re-checked here so the client gets a
  -- clean mappable token instead of a raw constraint violation.
  v_content := trim(coalesce(p_content, ''));
  if v_content = '' then
    raise exception 'INVALID_INPUT: content is empty';
  end if;
  if char_length(v_content) > 2000 then
    raise exception 'INVALID_INPUT: content too long';
  end if;

  -- --- RATE_LIMITED: max 20 per sender per thread per ROLLING 60s ---------------
  -- Mirrors create_sighting's advisory-lock + rolling-window idiom. The xact
  -- advisory lock on (thread, sender) serialises a sender's concurrent sends so
  -- parallel requests cannot both pass the count and both insert; it releases
  -- automatically at transaction end.
  perform pg_advisory_xact_lock(
    hashtextextended('send_message:' || p_thread_id::text || ':' || v_caller::text, 0));
  select count(*) into v_recent
  from public.messages m
  where m.thread_id = p_thread_id
    and m.sender_id = v_caller
    and m.created_at > now() - interval '60 seconds';
  if v_recent >= 20 then
    raise exception 'RATE_LIMITED';
  end if;

  -- --- Atomic insert + inbox denormalisation ------------------------------------
  -- SAFETY: sender pinned to the caller; kind hard-coded 'user'.
  insert into public.messages (thread_id, sender_id, kind, content)
  values (p_thread_id, v_caller, 'user', v_content)
  returning id, created_at into v_msg_id, v_created_at;

  update public.threads
  set last_message_at      = now(),
      last_message_preview = left(v_content, 140)
  where id = p_thread_id;

  return jsonb_build_object(
    'id',         v_msg_id,
    'thread_id',  p_thread_id,
    'sender_id',  v_caller,
    'kind',       'user',
    'content',    v_content,
    'created_at', v_created_at);
end;
$$;

comment on function public.send_message(uuid, text) is
  'The ONLY client message writer. SECURITY DEFINER: pins sender_id to the caller, HARD-CODES kind=user, requires the caller to be a thread participant (missing threads raise the SAME NOT_PARTICIPANT token) and the post to be active (closed posts freeze the chat read-only), bounds content to trimmed 1..2000 chars, rate-limits to 20 per sender per thread per rolling 60s (advisory-lock + window), and atomically inserts the message + denormalises threads.last_message_at/last_message_preview. Raises: NOT_AUTHENTICATED, NOT_PARTICIPANT, POST_CLOSED, INVALID_INPUT, RATE_LIMITED.';

-- SAFETY: same lockdown as open_thread — no PUBLIC, no anon.
revoke execute on function public.send_message(uuid, text) from public, anon;
grant  execute on function public.send_message(uuid, text) to authenticated, service_role;


-- =============================================================================
-- 7. RPC: mark_thread_read(thread_id) -> void
-- =============================================================================
-- Stamps the CALLER's side read marker (owner_last_read_at or
-- spotter_last_read_at) to now(). A participant can only ever move their OWN
-- marker — the column is chosen by which side the caller is, never by input.
create or replace function public.mark_thread_read(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_caller  uuid := auth.uid();
  v_owner   uuid;
  v_spotter uuid;
begin
  -- SAFETY: backstop; the grant below already excludes anon.
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: missing thread and foreign thread give the SAME token.
  select t.owner_id, t.spotter_id into v_owner, v_spotter
  from public.threads t
  where t.id = p_thread_id;
  if not found or v_caller not in (v_owner, v_spotter) then
    raise exception 'NOT_PARTICIPANT';
  end if;

  if v_caller = v_owner then
    update public.threads set owner_last_read_at = now() where id = p_thread_id;
  else
    update public.threads set spotter_last_read_at = now() where id = p_thread_id;
  end if;
end;
$$;

comment on function public.mark_thread_read(uuid) is
  'Stamps the CALLER''s side read marker (owner_last_read_at or spotter_last_read_at — picked by which participant the caller is, never by input) to now(). Raises NOT_AUTHENTICATED, NOT_PARTICIPANT (same token for missing threads).';

-- SAFETY: same lockdown — no PUBLIC, no anon.
revoke execute on function public.mark_thread_read(uuid) from public, anon;
grant  execute on function public.mark_thread_read(uuid) to authenticated, service_role;


-- =============================================================================
-- 8. RPC: get_inbox() -> jsonb
-- =============================================================================
-- The caller's threads, newest activity first, as a jsonb array of inbox rows:
--   { thread_id, post_id, role, last_message_at, last_message_preview,
--     unread_count, post: { make, model, colour, plate?, status,
--     cover_photo_url }, other: { first_name } }
--
-- SAFETY (Tier 1 — PRIVACY, SECURITY_AND_TRUST §1):
--   The 'other' participant block is first_name ONLY. avatar_path is
--   DELIBERATELY excluded: it is CHECK-pinned to '<uid>/avatar.jpg', so
--   returning it would ship the other party's uid to the client — reversing the
--   very boundary open_thread_for_sighting exists to protect, and chaining to a
--   surname via the permissive profiles read policy (using (true)). This is the
--   SAME call post-detail made in 20260713170000_post_detail_owner_no_avatar_path;
--   restoring an avatar needs the profiles read path hardened first. The payload
--   must NEVER contain the other participant's uid, avatar path, display_name /
--   surname, or email. The plate is delivered to the OWNER only (L1
--   defence-in-depth — a spotter's client already hides it, and a closed post
--   must not keep shipping it to a spotter). If you add a field here, re-read
--   SECURITY_AND_TRUST §1 first. unread_count counts messages newer than the
--   CALLER's own read marker that the caller did not send (IS DISTINCT FROM, so
--   system messages with sender NULL count as unread).
create or replace function public.get_inbox()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_caller uuid := auth.uid();
  v_out    jsonb;
begin
  -- SAFETY: backstop; the grant below already excludes anon.
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'thread_id',            t.id,
               'post_id',              t.post_id,
               'role',                 case when t.owner_id = v_caller
                                            then 'owner' else 'spotter' end,
               'last_message_at',      t.last_message_at,
               'last_message_preview', t.last_message_preview,

               -- Unread = newer than MY marker and not sent by me. IS DISTINCT
               -- FROM keeps system messages (sender NULL) counted for both
               -- sides — a safety notice is worth surfacing as unread.
               'unread_count', (
                 select count(*)
                 from public.messages m
                 where m.thread_id = t.id
                   and m.created_at > case when t.owner_id = v_caller
                                           then t.owner_last_read_at
                                           else t.spotter_last_read_at end
                   and m.sender_id is distinct from v_caller),

               -- What an inbox row needs of the post — identity chips + state
               -- + the carousel's first photo. Nothing location- or money-
               -- bearing belongs here.
               'post', jsonb_build_object(
                 'make',   p.make,
                 'model',  p.model,
                 'colour', p.colour,
                 -- SAFETY (L1 defence-in-depth): the plate goes to the OWNER
                 -- only. A spotter's client already suppresses it; a closed
                 -- post must not keep shipping the plate to a spotter. NULL for
                 -- the spotter role.
                 'plate',  case when t.owner_id = v_caller then p.plate end,
                 'status', p.status,
                 'cover_photo_url', (
                   select ph.url
                   from public.post_photos ph
                   where ph.post_id = p.id
                   order by ph.position
                   limit 1)),

               -- SAFETY (Tier 1, §1): the participant exposure boundary is
               -- first_name ONLY. avatar_path is CHECK-pinned to '<uid>/...',
               -- so returning it would leak the other party's uid (and, via the
               -- permissive profiles read policy, chain to a surname) — the same
               -- call post-detail made in 20260713170000. NO avatar_path, NO
               -- uid, NO display_name/surname, NO email.
               'other', jsonb_build_object(
                 'first_name', o.first_name)
             )
             order by t.last_message_at desc),
           '[]'::jsonb)
    into v_out
  from public.threads t
  join public.posts p on p.id = t.post_id
  join public.profiles o
    on o.id = case when t.owner_id = v_caller then t.spotter_id else t.owner_id end
  where v_caller in (t.owner_id, t.spotter_id);

  return v_out;
end;
$$;

comment on function public.get_inbox() is
  'The caller''s chat inbox: their threads newest-activity-first with unread counts (messages newer than the caller''s own read marker not sent by them; system messages count), an inbox-sized post block (make/model/colour/status/cover photo; PLATE to the owner only — L1 defence-in-depth), and a first_name-ONLY other-participant block (NO avatar_path — it embeds the uid, §1; NO display_name/email). Raises NOT_AUTHENTICATED.';

-- SAFETY: same lockdown — no PUBLIC, no anon.
revoke execute on function public.get_inbox() from public, anon;
grant  execute on function public.get_inbox() to authenticated, service_role;


-- =============================================================================
-- 9. RPC: flag_message(message_id, reason?) -> jsonb
-- =============================================================================
-- Flags one message for moderation (§7: two taps) and returns
-- { "flag_id": <uuid> }. Idempotent-ish: re-flagging the same message returns
-- the EXISTING flag id (not an error) via the (reporter, target) UNIQUE.
--
-- SAFETY:
--   * The caller must PARTICIPATE in the message's thread — you can only flag
--     what you can see. A missing message and a foreign message raise the SAME
--     'NOT_PARTICIPANT' token (no existence oracle for message ids).
--   * reporter_id pinned to the caller; target_type hard-coded 'message'.
--   * flags has NO client grant at all — this SECURITY DEFINER body is the only
--     client-reachable write, and nothing client-reachable reads it back.
create or replace function public.flag_message(
  p_message_id uuid,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_caller  uuid := auth.uid();
  v_owner   uuid;
  v_spotter uuid;
  v_flag_id uuid;
begin
  -- SAFETY: backstop; the grant below already excludes anon.
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: participant-of-the-message's-thread gate; missing message = SAME token.
  select t.owner_id, t.spotter_id into v_owner, v_spotter
  from public.messages m
  join public.threads t on t.id = m.thread_id
  where m.id = p_message_id;
  if not found or v_caller not in (v_owner, v_spotter) then
    raise exception 'NOT_PARTICIPANT';
  end if;

  -- Same bound as the flags CHECK; re-checked for a clean mappable token.
  if p_reason is not null and char_length(p_reason) > 500 then
    raise exception 'INVALID_INPUT: reason too long';
  end if;

  -- SAFETY: reporter pinned to the caller; target_type hard-coded. ON CONFLICT
  -- DO NOTHING + re-select: re-flagging returns the EXISTING flag id (the
  -- original reason is kept — first report wins; moderators see it either way).
  insert into public.flags (reporter_id, target_type, target_id, reason)
  values (v_caller, 'message', p_message_id, p_reason)
  on conflict on constraint flags_reporter_target_uniq do nothing
  returning id into v_flag_id;

  if v_flag_id is null then
    select f.id into v_flag_id
    from public.flags f
    where f.reporter_id = v_caller
      and f.target_type = 'message'
      and f.target_id   = p_message_id;
  end if;

  -- AUDIT: moderator ACTIONS on flags get audit-log rows with the moderation
  -- feature (SECURITY_AND_TRUST §7); the flag row itself is the user-side record.

  return jsonb_build_object('flag_id', v_flag_id);
end;
$$;

comment on function public.flag_message(uuid, text) is
  'Flags one message for moderation (SECURITY_AND_TRUST §7). SECURITY DEFINER: caller must participate in the message''s thread (missing messages raise the SAME NOT_PARTICIPANT token), reporter_id pinned to the caller, target_type hard-coded ''message'', reason bounded to 500 chars. Idempotent per (reporter, message): re-flagging returns the existing flag id. Raises: NOT_AUTHENTICATED, NOT_PARTICIPANT, INVALID_INPUT.';

-- SAFETY: same lockdown — no PUBLIC, no anon.
revoke execute on function public.flag_message(uuid, text) from public, anon;
grant  execute on function public.flag_message(uuid, text) to authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
