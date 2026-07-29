-- =============================================================================
-- WHAT:  get_thread_peer(p_thread_id) — one SECURITY DEFINER read giving a
--        chat participant the peer's READ MARKER (drives the "Seen" caption,
--        both directions) and, for the OWNER only, the spotter's narrow
--        public profile (first name + reputation + member-since).
-- WHY:   The 2026-07-28 chat design pass added two features that need peer
--        data: "Seen" (the peer's last_read_at) and a tappable header
--        profile. The first client implementation read the thread row
--        directly — legal under threads_select_participant, but it shipped
--        the PEER'S UID into app code, and the profiles table's permissive
--        select policy means any uid-holder can read display_name (which may
--        carry a surname) and avatar_path. The chat feature's own get_inbox
--        deliberately refuses to return even avatar_path BECAUSE it embeds a
--        uid; handing over the uid itself was strictly worse (security
--        review H1). This RPC keeps the uid server-side: the client gets
--        exactly the fields it may render and nothing it could pivot with.
--
--        The profile block is returned ONLY when the caller is the post's
--        OWNER (viewing the spotter — the sanctioned first-name+reputation
--        passport, SECURITY_AND_TRUST §1). A SPOTTER calling gets peer:null:
--        DOMAIN.md says an owner's identity is never exposed, and a face
--        photo or reputation sheet for a theft victim would be exactly that
--        (security review M2). The read marker IS returned to both sides —
--        "Seen" is mutual by design (product call, 2026-07-28).
--
--        No avatar_path in the payload, even for the owner: the storage path
--        embeds the spotter's uid, which is what this RPC exists to withhold.
--        The client renders the initial-letter avatar it already uses
--        everywhere in chat.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. Fully additive — one new
--        function plus its grants. No table, policy, or existing function is
--        touched.
-- LINKS: supabase/migrations/20260715120000_chat.sql (the tables, the raise
--          conventions, and the threads_select_participant policy whose uid
--          exposure this supersedes for app code);
--        src/features/chat/api/chatApi.ts (fetchThreadPeer, the only caller);
--        supabase/tests/chat_verification.sql (CHECK 14 + the anon CHECK);
--        docs/SECURITY_AND_TRUST.md §1.
-- =============================================================================

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
    'peer',               v_peer);
end;
$$;

comment on function public.get_thread_peer(uuid) is
  'One thread participant''s view of the OTHER: their read marker (both directions — "Seen" is mutual), plus the spotter''s narrow public profile (first_name, created_at, reputation counters) when and only when the caller is the post''s owner. A spotter caller gets peer:null — owner identity is never exposed (DOMAIN.md). Never returns a uid, display_name, or avatar_path. Missing-or-not-yours raises one opaque NOT_PARTICIPANT.';

revoke execute on function public.get_thread_peer(uuid) from public;
revoke execute on function public.get_thread_peer(uuid) from anon;
grant  execute on function public.get_thread_peer(uuid) to authenticated, service_role;
