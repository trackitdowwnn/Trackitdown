-- =============================================================================
-- ⚠️ NO DESTRUCTIVE STATEMENTS, AND THAT IS DELIBERATE. This replaces one
--    function body. It DELETES NO ROWS: every thread that already carries the
--    'Safety first…' system message keeps it, and its conversation history is
--    untouched. Only threads created from now on differ.
--
-- WHAT:  `open_thread` stops writing the automatic system safety message.
--        A new thread is created empty, with a NULL last_message_preview.
--
-- WHY:   Owner decision, 2026-08-29. Every conversation opened with a paragraph
--        of rules, and the same rules were pinned above the thread as a banner;
--        the owner asked for both to go from chat.
--
--        ⚠️ THIS RELAXES A DOCUMENTED SAFETY CONTROL, and the doc changes with
--        it rather than being left to contradict the code: SECURITY_AND_TRUST
--        §1 named the chat thread specifically, and is amended the same day so
--        the decision is legible rather than looking like drift. The rule still
--        holds everywhere else — the SafetyNotice remains on sighting detail,
--        post detail, the sighting wizard, post sightings and onboarding, which
--        are the surfaces where someone is deciding whether to go and look.
--
--        The safety register on quick replies is NOT relaxed: no reply may
--        suggest meeting, following, waiting, watching or approaching, and the
--        lexicon test enforcing that is untouched.
--
-- ⚠️ EVERYTHING ELSE IS THE ORIGINAL, COPIED. The owner/spotter resolution
--    (three branches, including the owner-opens case that requires a named
--    spotter and the third-party case that raises NOT_PARTICIPANT), the shared
--    NO_SIGHTING token that keeps this from being an existence oracle, the
--    OWN_POST backstop, the namespaced advisory-lock key, the ungated return of
--    an EXISTING thread, the POST_CLOSED gate on creation, the
--    `search_path = public, extensions` posture and the grants are reproduced
--    exactly. Only the two statements that wrote the message change: the
--    preview becomes NULL and the messages insert is gone.
--
-- ⚠️ CONSEQUENCE THE CLIENT HANDLES: a brand-new thread now has ZERO messages,
--    where before it always had exactly one. The thread screen had no empty
--    state because it could never be empty; it gains one with this change.
--
-- LINKS: 20260715120000_chat.sql (the original this is derived from);
--        docs/SECURITY_AND_TRUST.md §1;
--        src/features/chat/screens/ChatThreadScreen.tsx.
-- =============================================================================

create or replace function public.open_thread(
  p_post_id    uuid,
  p_spotter_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_caller      uuid := auth.uid();
  v_owner       uuid;
  v_spotter     uuid;
  v_post_status public.post_status;
  v_thread_id   uuid;
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
  -- (Returning an existing thread already happened above, ungated.) Mirrors
  -- send_message's active gate.
  if v_post_status is distinct from 'active' then
    raise exception 'POST_CLOSED';
  end if;

  -- --- Create the thread ---------------------------------------------------------
  -- ⚠️ NO SYSTEM MESSAGE, AND THEREFORE NO PREVIEW. `last_message_preview` is
  -- NULL until somebody actually says something: the column is nullable and the
  -- client already renders "No messages yet" for it (inboxModel.previewText).
  -- `last_message_at` still takes now(), so a freshly opened thread sorts to the
  -- top of both inboxes rather than falling to the bottom as a NULL.
  --
  -- SAFETY: owner_id pinned from the POST row (v_owner), never caller input.
  insert into public.threads (
    post_id, owner_id, spotter_id, last_message_at, last_message_preview
  )
  values (
    p_post_id, v_owner, v_spotter, now(), null
  )
  returning id into v_thread_id;

  -- AUDIT: a thread-opened audit-log insert belongs here once the audit_log
  -- table exists (SECURITY_AND_TRUST §7). Deferred with the moderation feature.

  return jsonb_build_object('thread_id', v_thread_id, 'created', true);
end;
$fn$;

comment on function public.open_thread(uuid, uuid) is
  'The ONLY thread creator. SECURITY DEFINER: gates on the (post, spotter) pair having >=1 sighting (DOMAIN.md Chat: no cold DMs; missing posts raise the SAME NO_SIGHTING token — no existence oracle), pins owner_id from the post row, and inserts the thread. ⚠️ As of 2026-08-29 it NO LONGER writes the automatic system safety message (owner decision; SECURITY_AND_TRUST §1 amended the same day) — a new thread is empty and last_message_preview is NULL until someone speaks. Threads created before that date keep the message they already have. Idempotent per (post, spotter) via advisory lock + UNIQUE: an existing thread returns created=false. CREATING a new thread requires the post be active (POST_CLOSED); RETURNING an existing thread is ungated so history stays reachable (send_message also enforces active). Raises: NOT_AUTHENTICATED, INVALID_INPUT, NOT_PARTICIPANT, NO_SIGHTING, OWN_POST, POST_CLOSED.';

-- SAFETY: functions default to EXECUTE for PUBLIC, and this project's default
-- privileges ALSO auto-grant EXECUTE to anon at CREATE time (the 20260713191000
-- incident) — revoke BOTH explicitly, then grant to authenticated +
-- service_role only. Chat requires an account.
revoke execute on function public.open_thread(uuid, uuid) from public, anon;
grant  execute on function public.open_thread(uuid, uuid) to authenticated, service_role;
