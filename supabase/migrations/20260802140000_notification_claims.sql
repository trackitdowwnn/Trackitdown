-- =============================================================================
-- WHAT:  The two notification CLAIMS the shipped-but-unpushed features have been
--        waiting on — the database half of `notify-owner-of-sighting` and
--        `notify-message`. Adds two SERVER-ONLY marker columns:
--          * public.sightings.notified_at timestamptz (+ partial index
--            sightings_notify_pending_idx),
--          * public.messages.notified_at  timestamptz (+ partial index
--            messages_notify_pending_idx),
--        and two SERVICE-ROLE-ONLY SECURITY DEFINER functions that atomically
--        AUTHORISE + CLAIM one notification and hand back the exact push copy:
--          * claim_sighting_notification(p_sighting_id, p_actor) -> jsonb
--            — sighting -> the POST OWNER,
--          * claim_message_notification(p_message_id, p_actor)  -> jsonb
--            — message  -> the OTHER thread participant.
--        Both return { "claimed": false } (and nothing else) whenever the send
--        must not happen, or { "claimed": true, ... } exactly ONCE per row.
-- WHY:   There is no pg_net and no pg_cron in this project, so there is no
--        DB-trigger path to an Edge Function: both pushes are triggered by the
--        CLIENT invoking the function right after a successful write. An Edge
--        Function therefore CANNOT trust its caller, and the database has to
--        close the two holes that opens:
--          1. AUTHORISATION — otherwise a caller invokes notify-sighting with
--             somebody else's sighting id and spams that post's owner (or, on
--             the chat side, pushes a stranger's name into a victim's phone).
--             So the claim verifies the ACTOR actually WROTE the row
--             (sightings.spotter_id / messages.sender_id = p_actor) — the id
--             alone is never enough.
--          2. REPLAY — otherwise the same id is invoked in a loop and the
--             recipient is buzzed forever. So the claim is IDEMPOTENT: it sets
--             notified_at with a conditional `where notified_at is null`
--             update, so of two concurrent calls exactly one wins and every
--             later call returns { "claimed": false }.
--        Every rejection shares the IDENTICAL return, so the claim is not an
--        existence oracle for sighting/message ids (the same posture as the
--        repo's shared NOT_OWNER / NOT_PARTICIPANT / POST_NOT_ACTIVE tokens).
--        The copy is BUILT IN SQL, not in TypeScript, so its privacy is
--        assertable under `npm run test:db` rather than resting on a reviewer
--        reading an Edge Function.
-- LINKS: docs/DOMAIN.md (Notifications; Sighting rules — "every sighting screen
--          and notification carries the safety line"; Chat),
--        docs/SECURITY_AND_TRUST.md §1 (report don't approach; spotter identity
--          minimisation), §3 (message CONTENT never transits third-party
--          infrastructure), §6 (RLS deny-by-default; server-only columns;
--          service-role keys only in Edge Function secrets),
--        supabase/migrations/20260802100000_push_infrastructure.sql
--          (push_tokens / push_sends / push_receipts + prune_push_token — the
--          service-role-only grant posture reused verbatim here; push_sends.kind
--          'sighting' | 'message' and its subject_id = post id / THREAD id, which
--          is why these payloads return post_id and thread_id respectively),
--        supabase/migrations/20260802110000_post_alert_columns.sql
--          (posts.alerts_sent_at — the SAME claim idiom, for the spotter-alert
--          fan-out; this migration is that pattern applied per-row),
--        supabase/migrations/20260714100000_sightings.sql (sightings table +
--          create_sighting: the write whose actor is re-verified here),
--        supabase/migrations/20260715120000_chat.sql (threads / messages /
--          send_message; the kind='system' safety first message excluded below),
--        src/features/chat/README.md (the pinned message-push payload contract:
--          sender FIRST NAME + post context, never content),
--        docs/ROADMAP.md ("Deferred from built v1 features" — both pushes).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: NONE. Fully additive — two new nullable
--        columns on existing tables, two new partial indexes, two brand-new
--        functions (+ comments + grants). No table, column, policy, index,
--        constraint, trigger or function is dropped, renamed, truncated or
--        replaced, and no existing row is updated or backfilled. Pre-existing
--        sightings/messages keep notified_at NULL, i.e. they are claimable —
--        deliberately harmless, because a claim only ever fires from a client
--        invocation made moments after ITS OWN write (the actor check), so old
--        rows have nobody left to claim them.
-- =============================================================================


-- =============================================================================
-- 1. SIGHTINGS: the notified_at claim marker
-- =============================================================================

alter table public.sightings
  -- SAFETY (SERVER-ONLY): written ONLY by claim_sighting_notification
  -- (SECURITY DEFINER, service-role-only) or the service role directly. It is
  -- excluded from every client grant by construction: sightings holds NO client
  -- insert/update/delete grant at all (20260714100000 — every write goes through
  -- create_sighting), the same server-controlled posture as posts.recovered_at /
  -- posts.closed_at / posts.alerts_sent_at. A client-writable value here would
  -- let a spotter either suppress the owner's push (set it early) or, by
  -- clearing it, re-fire the same notification at the owner at will.
  add column notified_at timestamptz;

comment on column public.sightings.notified_at is
  'Owner-notification idempotency CLAIM. NULL = this sighting has never been pushed to the post''s owner. Set exactly once by claim_sighting_notification (SECURITY DEFINER, SERVICE ROLE ONLY) via a conditional `update ... where notified_at is null returning id`, so two concurrent calls can never both claim and any replay returns {"claimed": false}. Server-only: sightings carries no client write grant, so no client can set or clear it (same posture as posts.recovered_at / closed_at / alerts_sent_at). Never backfilled — a pre-existing sighting simply stays claimable and, because a claim also requires the ACTOR to be the row''s spotter, nothing re-notifies an old one.';

-- The notify-pending scan and the claim update's WHERE clause. Partial (and
-- index-only on id) keeps it tiny: a row leaves the index the moment it is
-- claimed, so it holds only the sightings that still owe a push. Same partial
-- style as posts_alerts_pending_idx.
create index sightings_notify_pending_idx
  on public.sightings (id)
  where notified_at is null;


-- =============================================================================
-- 2. MESSAGES: the notified_at claim marker
-- =============================================================================

alter table public.messages
  -- SAFETY (SERVER-ONLY): identical posture to sightings.notified_at above.
  -- messages holds NO client insert/update/delete grant either (20260715120000
  -- — send_message is the only client write path), so this column is
  -- server-controlled by construction. A client-writable value would let a
  -- sender re-fire a push into the other participant's phone repeatedly, which
  -- is a harassment vector the 60s send rate limit alone would not stop.
  add column notified_at timestamptz;

comment on column public.messages.notified_at is
  'Recipient-notification idempotency CLAIM. NULL = this message has never been pushed to the other thread participant. Set exactly once by claim_message_notification (SECURITY DEFINER, SERVICE ROLE ONLY) via a conditional `update ... where notified_at is null returning id`. Server-only: messages carries no client write grant (all writes go through send_message), so no client can set or clear it. kind=''system'' rows are never claimed at all — the automatic safety first message must not push (it is written by open_thread inside the recipient''s own action).';

-- Same partial-index reasoning as sightings_notify_pending_idx: only messages
-- that still owe a push are in it.
create index messages_notify_pending_idx
  on public.messages (id)
  where notified_at is null;


-- =============================================================================
-- 3. FUNCTION: claim_sighting_notification(sighting_id, actor)  -- SERVICE ROLE
-- =============================================================================
-- Authorises AND claims the "someone reported a sighting on your post" push for
-- ONE sighting, returning the recipient + the exact copy to send:
--
--   { "claimed": true, "user_id": <post owner>, "post_id": <post id>,
--     "title": "New sighting reported", "body": "<see SAFETY below>" }
--
-- or the shared refusal { "claimed": false }.
--
-- SAFETY (Tier 1 — read before editing anything below):
--   * SERVICE ROLE ONLY. It takes the actor as a PARAMETER rather than reading
--     auth.uid(), because its caller is an Edge Function invoked with the
--     service-role key that has already verified the end-user's JWT and passes
--     the verified sub down. A client grant would hand any user a way to nominate
--     themselves as the actor, which is exactly the check this function exists to
--     perform. Grants below revoke public, anon AND authenticated.
--   * AUTHORISATION: the claim only proceeds when the sighting's spotter_id IS
--     the actor. Holding (or guessing) a sighting id is never sufficient — that
--     is what stops a caller spamming an arbitrary post owner.
--   * ONE SHARED REFUSAL: missing sighting, wrong actor, non-active post,
--     owner-is-the-actor, and already-notified ALL return the identical
--     { "claimed": false }. No message, no code, no timing branch that would
--     turn this into an existence oracle over sighting ids (the same call
--     get_post_sightings / open_thread_for_sighting make with NOT_OWNER /
--     NOT_PARTICIPANT).
--   * IDEMPOTENCE: the marker is set by a CONDITIONAL update
--     (`where notified_at is null returning id`). Under READ COMMITTED the
--     second of two concurrent calls blocks on the row lock, re-evaluates the
--     predicate against the committed row, matches nothing and returns
--     claimed=false — so exactly one caller ever gets a true.
--   * The push is NOT sent here, and this function deliberately does NOT write
--     public.push_sends (20260802100000): the claim is the AUTHORISATION +
--     REPLAY boundary, while volume control (the per-user rolling-24h cap and
--     the same-subject dedup) belongs to the send path, which alone knows
--     whether Expo accepted anything. post_id is returned partly for that
--     ledger — it is the kind='sighting' subject_id.
create or replace function public.claim_sighting_notification(
  p_sighting_id uuid,
  p_actor       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner   uuid;
  v_post_id uuid;
  -- Copy inputs, normalised at read time: blank/NULL make or colour must never
  -- reach the owner's lock screen as the word "null", and neither may push the
  -- safety clause past the 150-char cap (see the SAFETY note on the body).
  v_make    text;
  v_colour  text;
  v_claimed uuid;
begin
  -- Null inputs are simply an unclaimable request — same shared refusal, no
  -- exception, so a malformed invocation cannot be distinguished from a
  -- well-formed one that lost the race.
  if p_sighting_id is null or p_actor is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- Every gate in ONE predicate, so every failure mode exits through the same
  -- `not found` branch below:
  --   s.id = p_sighting_id        -- the sighting must exist
  --   s.spotter_id = p_actor      -- AUTHORISATION: the actor WROTE this row
  --   s.notified_at is null       -- REPLAY: not already pushed
  --   p.status = 'active'         -- a closed post's owner is not chasing a car
  -- The owner-is-the-actor case is checked immediately after (create_sighting's
  -- OWN_POST gate makes it unreachable today; kept so the invariant does not
  -- silently rest on another function).
  -- SAFETY: posts.make / posts.colour are UNBOUNDED text (no length CHECK), and
  -- they are owner-authored. left(..., 32) each keeps the assembled body inside
  -- the 150-char cap, so a 400-character "make" can never truncate the
  -- don't-approach clause off the end of the push (§1: EVERY notification
  -- carries the safety line). Blank -> 'car' / '' so it never reads "your null".
  select p.owner_id,
         p.id,
         left(coalesce(nullif(btrim(p.make),   ''), 'car'), 32),
         left(coalesce(nullif(btrim(p.colour), ''), ''),    32)
    into v_owner, v_post_id, v_make, v_colour
  from public.sightings s
  join public.posts p on p.id = s.post_id
  where s.id = p_sighting_id
    and s.spotter_id = p_actor
    and s.notified_at is null
    and p.status = 'active';

  if not found or v_owner = p_actor then
    return jsonb_build_object('claimed', false);
  end if;

  -- THE CLAIM. Conditional by design: two concurrent invocations for the same
  -- sighting cannot both win (see IDEMPOTENCE above). Zero rows back = somebody
  -- else already claimed it between the select and here -> shared refusal.
  update public.sightings
     set notified_at = now()
   where id = p_sighting_id
     and notified_at is null
  returning id into v_claimed;

  if v_claimed is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- AUDIT: a notification-claimed audit-log row belongs here once the audit_log
  -- table exists (SECURITY_AND_TRUST §7). Deferred with the moderation feature.

  return jsonb_build_object(
    'claimed', true,
    'user_id', v_owner,
    'post_id', v_post_id,
    'title',   'New sighting reported',
    -- SAFETY: make/colour + the fact of a sighting only. NEVER the plate, NEVER
    -- the spotter's identity, NEVER the sighting's location or note — the owner
    -- opens the app for those. The don't-approach clause is not optional: an
    -- owner told their car has been spotted is exactly the person who would drive
    -- over (DOMAIN.md / SECURITY_AND_TRUST.md §1 — every notification carries the
    -- safety line).
    -- regexp_replace collapses the double space a car with no recorded colour
    -- would otherwise leave ("your  car"); the copy itself is unchanged.
    'body', left(regexp_replace(format('Someone reported seeing your %s %s — don''t approach, let the police handle it.', v_colour, v_make), '\s+', ' ', 'g'), 150));
end;
$$;

comment on function public.claim_sighting_notification(uuid, uuid) is
  'Authorises AND claims the sighting -> POST OWNER push exactly once. SERVICE ROLE ONLY (the actor is a parameter, not auth.uid(): the caller is an Edge Function that already verified the end-user JWT — a client grant would let a user nominate themselves as the actor and defeat the whole check). Returns {"claimed": true, user_id (post owner), post_id, title, body} on the single winning call, and the IDENTICAL {"claimed": false} for every refusal — missing sighting, actor is not the sighting''s spotter (AUTHORISATION), post not active, owner is the actor, or already notified — so it is no existence oracle for sighting ids. Idempotent via a conditional `update sightings set notified_at = now() where id = $1 and notified_at is null returning id`, so two concurrent calls cannot both claim (REPLAY). SAFETY: the body carries make/colour + the don''t-approach line ONLY — never the plate, the spotter''s identity, the sighting location or the note (SECURITY_AND_TRUST §1); make/colour fall back to ''car'' so it can never read "your null null", and each is left(...,32)-bounded (both columns are unbounded owner-authored text) so the 150-char cap can never truncate the safety clause away. Does not send, and deliberately does NOT write push_sends: this is the authorisation + replay boundary, while volume control (the rolling-24h cap / same-subject dedup) belongs to the send path. post_id is the kind=''sighting'' subject_id for that ledger.';

-- SAFETY: this function performs NO auth.uid() check — it trusts its caller to
-- have verified the actor — so it is exactly the kind of function no client may
-- execute (same posture as prune_push_token, 20260802100000). Functions default
-- to EXECUTE for PUBLIC and this project's ALTER DEFAULT PRIVILEGES ALSO grant
-- anon and authenticated at CREATE time, so all three must be named explicitly.
revoke execute on function public.claim_sighting_notification(uuid, uuid)
  from public, anon, authenticated;
grant  execute on function public.claim_sighting_notification(uuid, uuid)
  to service_role;


-- =============================================================================
-- 4. FUNCTION: claim_message_notification(message_id, actor)  -- SERVICE ROLE
-- =============================================================================
-- Authorises AND claims the "you have a new message" push for ONE message,
-- returning the recipient + the exact copy to send:
--
--   { "claimed": true, "user_id": <the OTHER participant>, "thread_id": <uuid>,
--     "title": "New message", "body": "<see SAFETY below>" }
--
-- or the shared refusal { "claimed": false }.
--
-- SAFETY (Tier 1 — read before editing anything below):
--   * SERVICE ROLE ONLY, actor-as-parameter — identical reasoning to
--     claim_sighting_notification above.
--   * AUTHORISATION: the claim only proceeds when the message's sender_id IS the
--     actor. A caller holding another thread's message id gets the shared
--     refusal, so this can never be used to push a stranger's first name into
--     somebody's phone (which would also confirm that a thread between them
--     exists — §1).
--   * kind='system' NEVER pushes. The automatic safety first message is written
--     by open_thread inside the recipient's OWN action; buzzing them for it
--     would be noise, and its sender_id is NULL so it has no actor to verify.
--   * ONE SHARED REFUSAL for: missing message, wrong actor, system kind,
--     recipient-is-the-actor, already notified. No existence oracle over message
--     ids (the same call flag_message / send_message make with NOT_PARTICIPANT).
--   * IDEMPOTENCE: same conditional `where notified_at is null` claim.
--   * NOT gated on the post being active: send_message already refuses to write
--     into a closed post's thread, so a claimable message was authored while the
--     post was live; the thread stays readable to both parties afterwards
--     (DOMAIN.md Chat: closed posts freeze threads READ-ONLY, they do not hide
--     them), so a push that lands moments after closure still leads somewhere
--     legitimate.
--   * The push is NOT sent here, and this function deliberately does NOT write
--     public.push_sends — same split as the sighting claim above. thread_id is
--     returned partly for that ledger: it is the kind='message' subject_id.
create or replace function public.claim_message_notification(
  p_message_id uuid,
  p_actor      uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient uuid;
  v_thread_id uuid;
  -- Copy inputs, normalised AND length-bounded at read time (see the SAFETY
  -- block on the body).
  v_first     text;
  v_make      text;
  v_colour    text;
  v_claimed   uuid;
begin
  -- Same shared refusal for malformed input as the sighting claim.
  if p_message_id is null or p_actor is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- Every gate in ONE predicate, so every failure exits through `not found`:
  --   m.id = p_message_id                    -- the message must exist
  --   m.sender_id = p_actor                  -- AUTHORISATION: the actor SENT it
  --   m.notified_at is null                  -- REPLAY: not already pushed
  --   m.kind <> 'system'                     -- the safety message never pushes
  --                                             (belt and braces: a system row's
  --                                             sender_id is NULL, so the actor
  --                                             check already excludes it)
  --   m.sender_id in (t.owner_id, t.spotter_id)
  --                                          -- the sender must BE a participant,
  --                                             so the recipient below is always
  --                                             the genuine other side
  -- RECIPIENT: whichever side of the thread did NOT send the message. Derived
  -- server-side from the thread row — never a parameter, so a caller can never
  -- redirect a push to a third party.
  -- SAFETY: first_name, make and colour are all UNBOUNDED user-authored text.
  -- left(..., 32) each keeps the assembled body inside the 150-char cap, so a
  -- padded first name cannot push the post context out of the notification (and
  -- cannot turn the body into a wall of attacker-chosen text on a lock screen).
  select case when t.owner_id = m.sender_id then t.spotter_id else t.owner_id end,
         t.id,
         left(coalesce(nullif(btrim(pr.first_name), ''), 'Someone'), 32),
         left(coalesce(nullif(btrim(p.make),        ''), 'car'),     32),
         left(coalesce(nullif(btrim(p.colour),      ''), ''),        32)
    into v_recipient, v_thread_id, v_first, v_make, v_colour
  from public.messages m
  join public.threads  t  on t.id  = m.thread_id
  join public.posts    p  on p.id  = t.post_id
  join public.profiles pr on pr.id = m.sender_id
  where m.id = p_message_id
    and m.sender_id = p_actor
    and m.notified_at is null
    and m.kind <> 'system'
    and m.sender_id in (t.owner_id, t.spotter_id);

  -- Never notify someone about their own action (unreachable while the thread
  -- CHECK forbids owner_id = spotter_id; kept so the invariant is local).
  if not found or v_recipient = p_actor then
    return jsonb_build_object('claimed', false);
  end if;

  -- THE CLAIM (conditional — see IDEMPOTENCE above).
  update public.messages
     set notified_at = now()
   where id = p_message_id
     and notified_at is null
  returning id into v_claimed;

  if v_claimed is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- --- VOLUME: one push per thread per MESSAGE_PUSH_COOLDOWN ------------------
  -- SAFETY. send_message allows 20 messages per minute per thread, and this
  -- path has no rolling-24h cap (push_sends is the ALERT ledger). Without a
  -- cooldown a hostile counterpart can fire 20 HIGH-importance pushes a minute
  -- — sound and vibration each time — into a theft victim's phone. Collapsing
  -- (collapseId/tag) replaces the BANNER but not the buzz, so it is not a
  -- volume control on its own.
  --
  -- The message is still claimed above, so this suppresses the PUSH only: the
  -- message itself is delivered, the thread and its unread badge are unaffected,
  -- and the recipient sees everything the moment they open the app.
  if exists (
    select 1
      from public.push_sends s
     where s.user_id = v_recipient
       and s.kind = 'message'
       and s.subject_id = v_thread_id
       and s.created_at > now() - interval '2 minutes'
  ) then
    return jsonb_build_object('claimed', false);
  end if;

  insert into public.push_sends (user_id, kind, subject_id)
  values (v_recipient, 'message', v_thread_id);

  -- AUDIT: as above, a notification-claimed audit-log row lands here with the
  -- moderation feature (SECURITY_AND_TRUST §7).

  return jsonb_build_object(
    'claimed',   true,
    'user_id',   v_recipient,
    'thread_id', v_thread_id,
    'title',     'New message',
    -- SAFETY: sender FIRST NAME + post context ONLY. Message CONTENT NEVER
    -- transits push — it crosses third-party infrastructure (Expo, then FCM/APNs)
    -- and SECURITY_AND_TRUST.md §3 forbids it. No surname, no avatar, no uid.
    -- regexp_replace collapses the double space a car with no recorded colour
    -- would otherwise leave; the pinned copy itself is unchanged.
    'body', left(regexp_replace(format('%s sent you a message about the %s %s', v_first, v_colour, v_make), '\s+', ' ', 'g'), 150));
end;
$$;

comment on function public.claim_message_notification(uuid, uuid) is
  'Authorises AND claims the message -> OTHER PARTICIPANT push exactly once. SERVICE ROLE ONLY (actor is a parameter, not auth.uid(): the caller is an Edge Function that already verified the end-user JWT). Returns {"claimed": true, user_id (the other participant, derived server-side from the thread — never a parameter), thread_id, title, body} on the single winning call, and the IDENTICAL {"claimed": false} for every refusal — missing message, actor is not the sender (AUTHORISATION), kind=''system'' (the automatic safety first message must never push), recipient is the actor, or already notified — so it is no existence oracle for message ids or for whether two users have a thread. Idempotent via a conditional `update messages set notified_at = now() where id = $1 and notified_at is null returning id` (REPLAY). SAFETY: the body is the sender''s FIRST NAME + post make/colour ONLY — message CONTENT never transits push (third-party infrastructure; SECURITY_AND_TRUST §3), and no surname, avatar or uid is ever returned (§1); first_name falls back to ''Someone'' when blank and make/colour to ''car''; all three are left(...,32)-bounded (unbounded user-authored columns) so the 150-char cap never eats the post context. Deliberately NOT gated on the post being active (send_message already blocks writes on closed posts; history stays readable). Does not send. VOLUME: writes a kind=''message'' push_sends row keyed on the thread and returns {"claimed": false} when one exists from the last 2 minutes — send_message allows 20 messages/minute/thread and this path has no rolling-24h cap, so without the cooldown a hostile counterpart could fire 20 HIGH-importance pushes a minute (sound + vibration each) at a theft victim; collapseId replaces the banner but not the buzz. The MESSAGE is still claimed and delivered — only the push is suppressed.';

-- SAFETY: no auth.uid() check inside -> no client may execute. public, anon AND
-- authenticated are all revoked (the project's default privileges grant anon and
-- authenticated EXECUTE at CREATE time), then service_role alone is granted —
-- the prune_push_token posture from 20260802100000.
revoke execute on function public.claim_message_notification(uuid, uuid)
  from public, anon, authenticated;
grant  execute on function public.claim_message_notification(uuid, uuid)
  to service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
