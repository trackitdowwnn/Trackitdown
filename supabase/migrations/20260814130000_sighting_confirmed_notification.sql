-- =============================================================================
-- WHAT: The spotter finally hears the answer. A new notification kind,
--       `sighting_confirmed`, plus its claim column and claim RPC.
--
-- WHY:  A spotter reports a car and then, in the ordinary case, nothing ever
--       happens to them. `credited` fires for the one who wins the bounty and
--       `not_credited` for the runners-up once a car goes home — but the far
--       commoner event, an owner looking at your photo and saying "yes, that
--       is my car", was silent. That is the moment this whole feature exists to
--       create, and a moment nobody is told about is not a loop.
--
--       THE BADGE LINE IS DERIVED HERE, NOT PASSED IN. mark_sighting_helpful
--       returns crossedThreshold to its caller, but a client-asserted "you
--       earned a badge" is not something to put in a push. This RPC re-reads
--       the spotter's counter and names the rung only when it sits EXACTLY on
--       one (1 / 5 / 25, mirroring BADGE_THRESHOLDS in reputation.ts). Two
--       confirmations landing between the bump and this claim make it say
--       nothing rather than something wrong — it under-claims, never over-.
--
--       WHY THE COPY IS BUILT IN SQL: house rule. Copy assembled here is
--       covered by `npm run test:db`; copy assembled in Deno is covered by
--       nothing this project runs.
--
-- SAFETY: fires on the confirmation itself, so a capped or collusion-flagged
--       confirmation still notifies — the sighting genuinely WAS confirmed, and
--       withholding the news would leak that something about the pair was
--       judged. The badge line simply does not appear, because the counter did
--       not move. No notification is sent for `not_mine`: a rejection is news
--       the spotter reads on their own record when they choose to look, not an
--       interruption telling someone they were wrong.
--
--       Every refusal returns the IDENTICAL {claimed:false} — not the owner,
--       not confirmed, already notified, no such sighting — so this is no
--       oracle. The conditional update IS the idempotency.
-- LINKS: supabase/migrations/20260806120000_not_credited_notification.sql
--          (the template this follows);
--        supabase/functions/notify-sighting-confirmed/index.ts (the sender);
--        src/features/notifications/lib/notificationKinds.ts (must match);
--        src/features/profile/lib/reputation.ts (BADGE_THRESHOLDS + labels).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The kind. BOTH constraints move together, on one greppable line each —
--    notificationKinds.test.ts reads these files and asserts the TS mirror
--    matches, so a half-done widening fails the suite rather than production.
-- -----------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_kind_chk;

alter table public.notifications add constraint notifications_kind_chk check (kind in ('alert','sighting','message','recovery','credited','closed_uncredited','dispute_upheld','dispute_rejected','payout_sent','not_credited','sighting_confirmed'));

alter table public.push_sends drop constraint push_sends_kind_chk;

alter table public.push_sends add constraint push_sends_kind_chk check (kind in ('alert','sighting','message','recovery','credited','closed_uncredited','dispute_upheld','dispute_rejected','payout_sent','not_credited','sighting_confirmed'));

-- -----------------------------------------------------------------------------
-- 2. The claim column. Server-only, like its four siblings: no client holds an
--    update grant on this table.
-- -----------------------------------------------------------------------------
alter table public.sightings
  add column confirmed_notified_at timestamptz;

comment on column public.sightings.confirmed_notified_at is
  'Push claim for the sighting_confirmed notification. Server-written only; the conditional update on it IS the idempotency, so a replayed invoke sends nothing.';

create index sightings_confirmed_notify_pending_idx
  on public.sightings (id)
  where status = 'helpful' and confirmed_notified_at is null;

-- -----------------------------------------------------------------------------
-- 3. The claim. Actor = the post OWNER (confirming is their action; the claim
--    re-verifies it rather than trusting the Edge Function's caller).
-- -----------------------------------------------------------------------------
create or replace function public.claim_sighting_confirmed_notification(
  p_sighting_id uuid,
  p_actor       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_spotter uuid;
  v_make    text;
  v_colour  text;
  v_count   integer;
  v_badge   text;
  v_body    text;
begin
  -- A confirmed sighting on a post the ACTOR owns.
  select s.id, s.spotter_id, p.make, p.colour
    into v_id, v_spotter, v_make, v_colour
    from public.sightings s
    join public.posts p on p.id = s.post_id
   where s.id = p_sighting_id
     and s.status = 'helpful'
     and p.owner_id = p_actor;

  if v_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- The conditional update IS the idempotency: of two concurrent calls,
  -- exactly one row comes back.
  update public.sightings
     set confirmed_notified_at = now()
   where id = v_id
     and confirmed_notified_at is null
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- The badge line, derived not asserted. EXACTLY on a rung or nothing:
  -- landing past one (two confirmations racing this claim) says nothing rather
  -- than something wrong. Labels mirror reputation.ts COUNTER_KINDS exactly.
  select sightings_helpful into v_count
    from public.profiles where id = v_spotter;

  v_badge := case v_count
               when 1  then 'First helpful mark'
               when 5  then '5 helpful marks'
               when 25 then '25 helpful marks'
             end;

  -- Copy. The car as the spotter already saw it — no owner identity, no
  -- location, no plate. "Confirmed" is the honest word: an owner acted, which
  -- is not the same as the spotter being verified right, and the copy around
  -- this number must never imply otherwise (spotterTrust.ts).
  v_body := 'The owner confirmed your sighting of the ' || lower(v_colour) || ' ' || v_make || '.';
  if v_badge is not null then
    v_body := v_body || ' That earned you "' || v_badge || '".';
  end if;

  return jsonb_build_object(
    'claimed', true,
    'user_id', v_spotter,
    'sighting_id', v_id,
    'title', 'Your sighting was confirmed',
    'body', v_body
  );
end;
$$;

comment on function public.claim_sighting_confirmed_notification(uuid, uuid) is
  'Claims the sighting_confirmed push for a spotter whose sighting the post owner marked helpful. Actor must own the post; the sighting must be helpful; the conditional update on confirmed_notified_at is the idempotency. Every refusal returns the IDENTICAL {claimed:false} — no oracle. Copy is built HERE (so npm run test:db covers it) and names a badge ONLY when the spotter''s counter sits exactly on a rung, so it under-claims rather than over-claims. Carries the car as the spotter already saw it: no owner identity, no location, no plate.';

revoke all on function public.claim_sighting_confirmed_notification(uuid, uuid) from public;

revoke all on function public.claim_sighting_confirmed_notification(uuid, uuid) from anon;

revoke all on function public.claim_sighting_confirmed_notification(uuid, uuid) from authenticated;

grant execute on function public.claim_sighting_confirmed_notification(uuid, uuid) to service_role;
