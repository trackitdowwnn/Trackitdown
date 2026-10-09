-- =============================================================================
-- WHAT:  A spotter who takes a sighting back with "Something else" may add a
--        short note, and the post's OWNER can read it — in the app, never in
--        a push.
--          1. sightings.withdraw_note — ≤200 characters, trimmed, and only
--             ever beside withdraw_reason = 'other'.
--          2. withdraw_sighting(p_sighting_id, p_reason, p_note default null)
--             — the same single guarded UPDATE, now also storing the note.
--             Every existing call (one and two arguments) still resolves.
--          3. claim_sighting_withdrawn_notification — restated with ONE new
--             body sentence: "The spotter withdrew it and left you a note."
--             The note itself never enters the copy.
--          4. get_post_withdrawals(p_post_id) — OWNER ONLY: the withdrawals
--             they were told about, newest first, as {withdrawn_at, reason,
--             note}. No sighting id, no spotter, no place.
-- WHY:   Owner request (2026-10-09): "Something else" told the owner nothing.
--        The owner chose to let the spotter say more, read by the owner
--        INSIDE THE APP ONLY, accepting it cannot be moderated yet.
--
--        ⚠️ NEVER IN A PUSH. A push travels through Expo, Apple and Google to
--        a theft victim's lock screen (SECURITY_AND_TRUST §3); a stranger's
--        own words can't be moderated (§7). So the push only says a note
--        EXISTS — a fixed sentence — and the words are fetched in the app,
--        through an owner-only RPC, after the tap. withdraw_sighting_
--        verification CHECK 13 asserts the note never appears in the copy.
--
--        ⚠️ NOT READABLE FROM THE TABLE. withdraw_note is granted to no client
--        role (20260814150000 made sightings column-granted, and this column
--        is not added to that list): not the spotter, not the owner. The only
--        reader is get_post_withdrawals, which checks ownership itself.
--
--        ⚠️ ONLY WHAT THE OWNER WAS TOLD ABOUT. get_post_withdrawals returns
--        a withdrawal only once withdrawn_notified_at is set — the same rule
--        as the notice. A note on a sighting the owner never heard of is not
--        surfaced afterwards as if it were news.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: ONE drop function —
--        withdraw_sighting(uuid, text), recreated as (uuid, text, text
--        DEFAULT NULL) in the same transaction, so every existing call still
--        resolves (as 20261009150000 did for the one-argument version).
--        Everything else is additive: one nullable column, one CHECK, one new
--        function, one restated function (one more body sentence).
-- LINKS: supabase/migrations/20261009150000_a_withdrawal_says_why.sql (the
--          reason, the claim — restated from it);
--        supabase/migrations/20260814150000_review_flags_are_not_the_spotters_to_read.sql
--          (the column grants this column is deliberately left out of);
--        supabase/tests/withdraw_sighting_verification.sql (CHECKS 12-14);
--        docs/SECURITY_AND_TRUST.md §3, §7; docs/DOMAIN.md (Sightings).
-- =============================================================================


-- =============================================================================
-- 1. The note
-- =============================================================================
alter table public.sightings
  add column withdraw_note text null;

-- Only with "Something else", bounded, never blank, stored trimmed, and free
-- of control and text-direction characters — so what the owner reads is
-- exactly what the RPC accepted. Defence in depth against a service-role
-- write as much as a check on the RPC.
-- ⚠️ `is not distinct from`, NOT `=`: with a NULL reason, `= 'other'` is
-- NULL, the whole OR is NULL, and a CHECK passes NULL — a note with no
-- reason would have got through (code review of this change).
alter table public.sightings add constraint sightings_withdraw_note_chk
  check (withdraw_note is null
         or (withdraw_reason is not distinct from 'other'
             and char_length(withdraw_note) between 1 and 200
             and withdraw_note = btrim(withdraw_note, E' \t\r\n')
             and withdraw_note !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]'));

-- Restated: its 20261009150000 comment said "there is no free-text reason
-- anywhere", which stops being true here.
comment on column public.sightings.withdraw_reason is
  'Why the spotter took the sighting back (2026-10-09): not_the_car | not_sure | mistake | other, or NULL when they skipped the question (it is optional) or the sighting was never withdrawn. A CLOSED vocabulary on purpose — it reaches the owner''s push only as fixed, server-built copy (claim_sighting_withdrawn_notification). The one free-text field beside it is withdraw_note (with ''other'' only), which is never pushed.';

comment on column public.sightings.withdraw_note is
  'The spotter''s own words when they took the sighting back with "Something else" (2026-10-09): 1-200 characters, trimmed, NULL otherwise. Read ONLY by the post owner, in the app, through get_post_withdrawals — granted to no client role, and never put in a push (claim_sighting_withdrawn_notification only says a note exists). Unmoderated: SECURITY_AND_TRUST §7.';


-- =============================================================================
-- 2. withdraw_sighting — now with an optional note
-- =============================================================================
-- DROPPED, not replaced: adding a parameter makes a NEW function, and leaving
-- the two-argument version beside it would make every two-argument call
-- ambiguous to PostgREST. The default keeps today's app's call working.
drop function public.withdraw_sighting(uuid, text);

create function public.withdraw_sighting(
  p_sighting_id uuid,
  p_reason      text default null,
  p_note        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller  uuid := auth.uid();
  v_spotter uuid;
  -- Trimmed here so the stored note always satisfies the CHECK; a note of
  -- only spaces is no note.
  v_note    text := nullif(btrim(p_note, E' \t\r\n'), '');
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- An answer outside the vocabulary is refused BEFORE anything is written.
  -- (The CHECK constraint would catch it too, but as a constraint violation —
  -- this keeps the refusal a token the client already narrows.)
  if p_reason is not null
     and p_reason not in ('not_the_car', 'not_sure', 'mistake', 'other') then
    raise exception 'INVALID_INPUT';
  end if;

  -- A note with nothing visible in it (only spaces of any kind — no-break,
  -- figure and narrow ones are named, since [:space:] may not cover them
  -- under every locale — or the blank-looking Hangul filler) is no note, or
  -- the push would say "left you a note" over a blank.
  if v_note !~ '[^[:space:]\u00A0\u2007\u202F\u3164]' then
    v_note := null;
  end if;

  -- A note only ever goes with "Something else", and is bounded — refused,
  -- not silently dropped or cut, so the spotter is never told the owner got
  -- words they didn't.
  if v_note is not null
     and (p_reason is distinct from 'other' or char_length(v_note) > 200) then
    raise exception 'INVALID_INPUT';
  end if;

  -- SAFETY: no control characters (C0 bar tab and line breaks, and C1), no
  -- soft hyphens, zero-width characters or joiners, and no text-direction
  -- marks. Unmoderated words shown to a theft victim must read as what they
  -- are; a direction override can make a line say something else on screen.
  -- Written as escapes so the set can be read in review. The app strips the
  -- same set before sending, so a spotter never meets this refusal.
  if v_note ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]' then
    raise exception 'INVALID_INPUT';
  end if;

  -- One conditional update carries the whole rule: yours, and still unruled.
  -- Doing it in the UPDATE rather than SELECT-then-UPDATE closes the race where
  -- the owner rules on the sighting between the two.
  update public.sightings s
     set status = 'withdrawn',
         withdraw_reason = p_reason,
         withdraw_note = v_note
   where s.id = p_sighting_id
     and s.spotter_id = v_caller
     and s.status = 'unverified'
  returning s.spotter_id into v_spotter;

  -- ONE opaque token for "no such sighting", "not yours" and "already ruled
  -- on". A distinct message per case would let anyone probe for sighting ids,
  -- and would leak whether a stranger's report had been credited.
  if v_spotter is null then
    raise exception 'SIGHTING_NOT_WITHDRAWABLE';
  end if;

  -- The spotter's standing is shown to owners; a retracted report must not
  -- count towards it. greatest(0, ...) because a counter that can go negative
  -- is worse than one that is slightly generous.
  update public.profiles p
     set sightings_reported = greatest(0, p.sightings_reported - 1)
   where p.id = v_spotter;

  return jsonb_build_object('sighting_id', p_sighting_id, 'withdrawn', true);
end $$;

comment on function public.withdraw_sighting(uuid, text, text) is
  'The spotter takes back their own sighting, optionally saying why (p_reason: not_the_car | not_sure | mistake | other, or NULL) and, with ''other'' only, a note (p_note: trimmed, blank = none, at most 200 characters). Anything else raises INVALID_INPUT before any write. SECURITY DEFINER, scoped to auth.uid(), and permitted ONLY while status = ''unverified'' — after the owner has ruled, withdrawing would erase their verdict (and on credited, one that moved money). Sets status=''withdrawn'', withdraw_reason and withdraw_note in ONE conditional update so an owner ruling concurrently cannot be overwritten, and decrements profiles.sightings_reported (floored at 0). Raises NOT_AUTHENTICATED, INVALID_INPUT, or SIGHTING_NOT_WITHDRAWABLE for missing / not-yours / already-ruled alike — one token, no existence oracle. Does NOT free a create_sighting rate-limit slot. Does not notify: the client then invokes notify-sighting-withdrawn.';

revoke execute on function public.withdraw_sighting(uuid, text, text) from public, anon;
grant execute on function public.withdraw_sighting(uuid, text, text) to authenticated;


-- =============================================================================
-- 3. claim_sighting_withdrawn_notification — restated from 20261009150000
--    with ONE new body sentence. Everything else is unchanged; diff it.
-- =============================================================================
create or replace function public.claim_sighting_withdrawn_notification(
  p_sighting_id uuid,
  p_actor       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner    uuid;
  v_post_id  uuid;
  v_make     text;
  v_colour   text;
  v_reason   text;
  v_has_note boolean;
  v_claimed  uuid;
begin
  -- Null inputs are simply an unclaimable request — the same shared refusal.
  if p_sighting_id is null or p_actor is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- Every gate in ONE predicate (see 20261009150000 for each line's reason).
  -- SAFETY: make / colour bounded at 22 BEFORE assembly, so the 80-char title
  -- always keeps "was taken back". Only WHETHER there is a note is read —
  -- never its words.
  select p.owner_id,
         p.id,
         left(coalesce(nullif(btrim(p.make),   ''), 'car'), 22),
         left(coalesce(nullif(btrim(p.colour), ''), ''),    22),
         s.withdraw_reason,
         s.withdraw_note is not null
    into v_owner, v_post_id, v_make, v_colour, v_reason, v_has_note
  from public.sightings s
  join public.posts p on p.id = s.post_id
  where s.id = p_sighting_id
    and s.spotter_id = p_actor
    and s.status = 'withdrawn'
    and s.withdrawn_notified_at is null
    and s.notified_at is not null
    and p.status = 'active';

  if not found or v_owner = p_actor then
    return jsonb_build_object('claimed', false);
  end if;

  -- THE CLAIM — conditional, so two concurrent invocations cannot both win.
  update public.sightings
     set withdrawn_notified_at = now()
   where id = p_sighting_id
     and withdrawn_notified_at is null
  returning id into v_claimed;

  if v_claimed is null then
    return jsonb_build_object('claimed', false);
  end if;

  return jsonb_build_object(
    'claimed', true,
    'user_id', v_owner,
    'post_id', v_post_id,
    'title', left(regexp_replace(
               format('A sighting of your %s %s was taken back', v_colour, v_make),
               '\s+', ' ', 'g'), 80),
    -- SAFETY: a FIXED sentence per answer — never the spotter's words, no
    -- identity, no place. A note only changes WHICH fixed sentence: the
    -- owner reads the words in the app (get_post_withdrawals), not here.
    'body', case
              when v_reason = 'not_the_car' then 'The spotter says it wasn''t your car.'
              when v_reason = 'not_sure'    then 'The spotter wasn''t sure it was your car.'
              when v_reason = 'mistake'     then 'The spotter sent it by mistake.'
              when v_has_note               then 'The spotter withdrew it and left you a note.'
              else                               'The spotter withdrew it.'
            end);
end;
$$;

comment on function public.claim_sighting_withdrawn_notification(uuid, uuid) is
  'Authorises AND claims the sighting-withdrawn -> POST OWNER push exactly once. SERVICE ROLE ONLY (the actor is a parameter: the caller is an Edge Function that already verified the end-user JWT). Returns {"claimed": true, user_id (post owner), post_id, title, body} on the single winning call, and the IDENTICAL {"claimed": false} for every refusal — missing sighting, actor not its spotter (AUTHORISATION), not withdrawn, owner never notified of the sighting (notified_at null), post not active, owner is the actor, or already notified — so it is no existence oracle. Idempotent via a conditional update of sightings.withdrawn_notified_at (REPLAY). SAFETY: title = the car (make/colour, each left(...,22) BEFORE assembly, so the 80-char title always keeps "was taken back") + "was taken back"; body = one FIXED sentence per withdraw_reason, and for ''other'' with a note "…and left you a note." — the note''s words NEVER enter the copy (2026-10-09; the owner reads them in the app via get_post_withdrawals). No plate, no place, no spotter identity. Deliberately carries no don''t-approach line: it tells the owner a sighting should NOT be acted on.';

revoke execute on function public.claim_sighting_withdrawn_notification(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_sighting_withdrawn_notification(uuid, uuid)
  to service_role;


-- =============================================================================
-- 4. get_post_withdrawals — the owner reads what they were told about
-- =============================================================================
create function public.get_post_withdrawals(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := auth.uid();
  v_owner  uuid;
  v_out    jsonb;
begin
  -- SAFETY: backstop; the grant below already excludes anon.
  if v_viewer is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: the ONLY visibility gate — the caller must own the post. The same
  -- token as get_post_sightings, for a missing post and a stranger's alike.
  select p.owner_id into v_owner from public.posts p where p.id = p_post_id;
  if not found or v_owner <> v_viewer then
    raise exception 'NOT_OWNER';
  end if;

  -- SAFETY: three fields and nothing else — no sighting id (nothing to tie a
  -- note back to a spotter's other reports), no spotter, no place, no photo.
  -- Only withdrawals the owner was TOLD about (withdrawn_notified_at), the
  -- moment they were told standing in for when. Bounded at the newest 50 —
  -- the owner reads a short list, not an archive, however many retract.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'withdrawn_at', w.withdrawn_notified_at,
               'reason',       w.withdraw_reason,
               'note',         w.withdraw_note)
             order by w.withdrawn_notified_at desc, w.id),
           '[]'::jsonb)
    into v_out
  from (
    -- s.id only as a tie-break (claims in one transaction share a time);
    -- it never leaves this subquery.
    select s.id, s.withdrawn_notified_at, s.withdraw_reason, s.withdraw_note
      from public.sightings s
     where s.post_id = p_post_id
       and s.status = 'withdrawn'
       and s.withdrawn_notified_at is not null
     order by s.withdrawn_notified_at desc, s.id
     limit 50
  ) w;

  return v_out;
end $$;

comment on function public.get_post_withdrawals(uuid) is
  'The post OWNER''s list of sightings taken back that they were told about (withdrawn_notified_at set), newest first, at most 50: a bare array of {withdrawn_at, reason (not_the_car | not_sure | mistake | other | null), note (the spotter''s own words, ≤200, only with other; else null)}. SECURITY DEFINER; raises NOT_AUTHENTICATED, or NOT_OWNER for a missing post and a stranger''s alike. Returns no sighting id, no spotter, no place. The ONLY reader of sightings.withdraw_note (2026-10-09) — in the app, never a push.';

revoke execute on function public.get_post_withdrawals(uuid) from public, anon;
grant execute on function public.get_post_withdrawals(uuid) to authenticated;
