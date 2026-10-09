-- =============================================================================
-- WHAT:  When a spotter takes a sighting back, the post's OWNER is told — and,
--        if the spotter chose to say, why.
--          1. sightings.withdraw_reason — a CLOSED vocabulary
--             (not_the_car | not_sure | mistake | other), NULL when the
--             spotter skipped the question — and sightings.withdrawn_notified_at,
--             the once-only marker for the owner's notice.
--          2. withdraw_sighting(p_sighting_id, p_reason default null) — the
--             same single guarded UPDATE, now also storing the reason. The old
--             one-argument call still resolves (named args + the default).
--          3. claim_sighting_withdrawn_notification — SERVICE ROLE ONLY: the
--             authorisation, the once-only claim, and the copy, built here.
--          4. Kind 'sighting_withdrawn' (UNMUTABLE, like 'sighting').
-- WHY:   Owner request (2026-10-09). A withdrawn sighting simply vanished from
--        the owner's listing, so an owner who had been told "Your blue BMW was
--        spotted" was never told it had been taken back — and might still be
--        acting on it. The spotter now answers an optional, fixed question,
--        and the owner hears the outcome in one calm sentence.
--
--        ⚠️ A CLOSED VOCABULARY, NOT FREE TEXT. The reason travels to the
--        owner's lock screen through Expo, Apple and Google
--        (SECURITY_AND_TRUST §3): push copy is built from fixed words here, in
--        SQL, where test:db can see it. A stranger's free text cannot be
--        moderated yet (§7 — there is no moderator tooling), and it would ride
--        straight onto a theft victim's lock screen. Four fixed answers, each a
--        fixed sentence.
--
--        ⚠️ TOLD ONLY IF THEY HEARD. The claim requires notified_at — the
--        owner was sent the sighting in the first place. A retraction of a
--        sighting they never heard about is only noise. And only while the
--        post is ACTIVE, like the sighting push itself.
--
--        ⚠️ NO SAFETY LINE, DELIBERATELY — the one sighting notice without it.
--        DOMAIN's rule ("every sighting … notification carries the safety
--        line") exists because a sighting notice can send an owner towards
--        their car. This one tells them a sighting should NOT be acted on, and
--        names no place; "don't approach" would read as if it still should be.
-- LINKS: supabase/migrations/20260903100000_withdraw_a_sighting.sql (the RPC);
--        supabase/migrations/20260922120000_pushes_say_the_news_first.sql
--          (claim_sighting_notification — the model);
--        supabase/functions/notify-sighting-withdrawn/index.ts (the sender);
--        supabase/tests/withdraw_sighting_verification.sql;
--        docs/SECURITY_AND_TRUST.md §3; docs/DOMAIN.md (Notifications).
-- =============================================================================


-- =============================================================================
-- 1. The reason, and the owner-notice marker
-- =============================================================================
alter table public.sightings
  add column withdraw_reason text null,
  add column withdrawn_notified_at timestamptz null;

alter table public.sightings add constraint sightings_withdraw_reason_chk
  check (withdraw_reason in ('not_the_car', 'not_sure', 'mistake', 'other'));

comment on column public.sightings.withdraw_reason is
  'Why the spotter took the sighting back (2026-10-09): not_the_car | not_sure | mistake | other, or NULL when they skipped the question (it is optional) or the sighting was never withdrawn. A CLOSED vocabulary on purpose — it reaches the owner only as fixed, server-built copy (claim_sighting_withdrawn_notification); there is no free-text reason anywhere.';

comment on column public.sightings.withdrawn_notified_at is
  'When the post owner was told this sighting had been taken back. The once-only marker for claim_sighting_withdrawn_notification (as notified_at is for the sighting push, and confirmed_notified_at for the spotter''s confirmation).';


-- =============================================================================
-- 2. withdraw_sighting — now with an optional reason
-- =============================================================================
-- DROPPED, not replaced: adding a parameter makes a NEW function, and leaving
-- the one-argument version beside it would make every one-argument call
-- ambiguous to PostgREST. The default keeps today's app's call working.
drop function public.withdraw_sighting(uuid);

create function public.withdraw_sighting(p_sighting_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller  uuid := auth.uid();
  v_spotter uuid;
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

  -- One conditional update carries the whole rule: yours, and still unruled.
  -- Doing it in the UPDATE rather than SELECT-then-UPDATE closes the race where
  -- the owner rules on the sighting between the two.
  update public.sightings s
     set status = 'withdrawn',
         withdraw_reason = p_reason
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

comment on function public.withdraw_sighting(uuid, text) is
  'The spotter takes back their own sighting, optionally saying why (p_reason: not_the_car | not_sure | mistake | other, or NULL; anything else raises INVALID_INPUT before any write). SECURITY DEFINER, scoped to auth.uid(), and permitted ONLY while status = ''unverified'' — after the owner has ruled, withdrawing would erase their verdict (and on credited, one that moved money). Sets status=''withdrawn'' and withdraw_reason in ONE conditional update so an owner ruling concurrently cannot be overwritten, and decrements profiles.sightings_reported (floored at 0). Raises NOT_AUTHENTICATED, INVALID_INPUT, or SIGHTING_NOT_WITHDRAWABLE for missing / not-yours / already-ruled alike — one token, no existence oracle. Does NOT free a create_sighting rate-limit slot. Does not notify: the client then invokes notify-sighting-withdrawn, which claims through claim_sighting_withdrawn_notification.';

revoke execute on function public.withdraw_sighting(uuid, text) from public, anon;
grant execute on function public.withdraw_sighting(uuid, text) to authenticated;


-- =============================================================================
-- 3. claim_sighting_withdrawn_notification — the owner's notice, once
-- =============================================================================
create function public.claim_sighting_withdrawn_notification(
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
  v_make    text;
  v_colour  text;
  v_reason  text;
  v_claimed uuid;
begin
  -- Null inputs are simply an unclaimable request — the same shared refusal.
  if p_sighting_id is null or p_actor is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- Every gate in ONE predicate, so every failure exits through `not found`:
  --   s.spotter_id = p_actor          -- AUTHORISATION: the actor's own report
  --   s.status = 'withdrawn'          -- it really was taken back
  --   s.withdrawn_notified_at is null -- REPLAY: not already told
  --   s.notified_at is not null       -- the owner HEARD about it to begin with
  --   p.status = 'active'             -- a closed listing's owner isn't chasing
  -- SAFETY: make / colour are unbounded owner-authored text — left(…, 32) each
  -- before assembly, exactly as the sighting push does.
  select p.owner_id,
         p.id,
         left(coalesce(nullif(btrim(p.make),   ''), 'car'), 32),
         left(coalesce(nullif(btrim(p.colour), ''), ''),    32),
         s.withdraw_reason
    into v_owner, v_post_id, v_make, v_colour, v_reason
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
    -- The news, as the sighting push gave it: the car, then what happened.
    -- Same bounded values; regexp_replace collapses the double space a car
    -- with no recorded colour leaves.
    'title', left(regexp_replace(
               format('A sighting of your %s %s was taken back', v_colour, v_make),
               '\s+', ' ', 'g'), 80),
    -- SAFETY: a FIXED sentence per answer — nothing the spotter typed (there
    -- is no free text), no identity, no place. About the CAR, never a verdict
    -- on the spotter; "withdrew it" when they gave no reason or "other".
    'body', case v_reason
              when 'not_the_car' then 'The spotter says it wasn''t your car.'
              when 'not_sure'    then 'The spotter wasn''t sure it was your car.'
              when 'mistake'     then 'The spotter sent it by mistake.'
              else                    'The spotter withdrew it.'
            end);
end;
$$;

comment on function public.claim_sighting_withdrawn_notification(uuid, uuid) is
  'Authorises AND claims the sighting-withdrawn -> POST OWNER push exactly once. SERVICE ROLE ONLY (the actor is a parameter: the caller is an Edge Function that already verified the end-user JWT). Returns {"claimed": true, user_id (post owner), post_id, title, body} on the single winning call, and the IDENTICAL {"claimed": false} for every refusal — missing sighting, actor not its spotter (AUTHORISATION), not withdrawn, owner never notified of the sighting (notified_at null), post not active, owner is the actor, or already notified — so it is no existence oracle. Idempotent via a conditional update of sightings.withdrawn_notified_at (REPLAY). SAFETY: title = the car (make/colour, each left(...,32)) + "was taken back", bounded at 80; body = one FIXED sentence per withdraw_reason (no free text exists). No plate, no place, no spotter identity. Deliberately carries no don''t-approach line: it tells the owner a sighting should NOT be acted on.';

revoke execute on function public.claim_sighting_withdrawn_notification(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_sighting_withdrawn_notification(uuid, uuid)
  to service_role;


-- =============================================================================
-- 4. Kind 'sighting_withdrawn' — UNMUTABLE
-- =============================================================================
-- notification_category needs no change: an unlisted kind falls to NULL —
-- unmutable, deliberately, as 'sighting' is. An owner told about a sighting
-- must be able to learn it was taken back.
alter table public.notifications drop constraint notifications_kind_chk;
alter table public.notifications add constraint notifications_kind_chk
  check (kind in ('alert','sighting','message','recovery','credited',
                  'credited_no_reward','closed_uncredited','dispute_upheld',
                  'dispute_rejected','payout_sent','not_credited',
                  'sighting_confirmed','still_missing','deletion_soon',
                  'reward_ending','reward_ended',
                  'payout_reminder','payout_lapsed',
                  'sighting_withdrawn'));

alter table public.push_sends drop constraint push_sends_kind_chk;
alter table public.push_sends add constraint push_sends_kind_chk
  check (kind in ('alert','sighting','message','recovery','credited',
                  'credited_no_reward','closed_uncredited','dispute_upheld',
                  'dispute_rejected','payout_sent','not_credited',
                  'sighting_confirmed','still_missing','deletion_soon',
                  'reward_ending','reward_ended',
                  'payout_reminder','payout_lapsed',
                  'sighting_withdrawn'));

comment on function public.notification_category(text) is
  'Maps a notification kind to its mutable preference category, or NULL when the kind may not be muted (sighting, sighting_withdrawn, closed_uncredited, still_missing, deletion_soon, reward_ending, reward_ended, payout_reminder, payout_lapsed) or is not yet classified. NULL always means "deliver". sighting_withdrawn (2026-10-09) follows sighting: an owner told about a sighting must be able to learn it was taken back.';
