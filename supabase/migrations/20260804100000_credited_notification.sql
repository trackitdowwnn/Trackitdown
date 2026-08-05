-- -----------------------------------------------------------------------------
-- WHAT:  The "you've earned £X" push — a new `credited` notification kind, its
--        idempotency claim, and its copy, built in SQL like every other push.
-- WHY:   DOMAIN: payout setup is prompted at CREDIT time, not signup — and
--        until now the credit moment was silent. The owner tapped confirm, the
--        spotter was told NOTHING, and the realistic steady state (ROADMAP)
--        was a credited spotter who never learns they earned money. This push
--        is the entry point of that moment: it lands, names the amount, and
--        its tap opens /payouts — the highest-motivation form a user will
--        ever fill.
--
--        WHY A NEW KIND rather than reusing `recovery`: `recovery` is reserved
--        for WATCHERS ("the car you were watching was recovered") and routes
--        to the post. Different audience, different destination, different
--        copy. Reusing it would collide the day the watcher push ships.
--
-- MONEY: the amount in the copy comes from `payout_split`, the ONE definition
--        of the 95/5 arithmetic. A third derivation here would be exactly the
--        drift `mark_recovery_paid` exists to reject.
--
--        DELIBERATE TRADE-OFF, on the record: the push title carries a money
--        amount, which is visible on a lock screen. That is the point — the
--        amount IS the motivation — and it matches what banking apps do, but
--        it is a disclosure the spotter did not choose. Revisit only if a
--        spotter asks; an opt-out toggle is a settings row away if ever needed.
-- LINKS: supabase/migrations/20260802140000_notification_claims.sql (the claim
--          idiom this copies: actor re-verification + conditional-update
--          idempotency + identical {claimed:false} on every refusal);
--        supabase/migrations/20260802220000_release_payout.sql (payout_split);
--        supabase/functions/notify-credited/index.ts (the caller);
--        src/features/notifications/lib/notificationKinds.ts (mirrors the
--          widened kind whitelist — notificationKinds.test.ts asserts it).
-- -----------------------------------------------------------------------------

-- =============================================================================
-- 1. The kind whitelist learns 'credited'. Same one-greppable-line format as
--    the original — notificationKinds.test.ts scans migrations for the LATEST
--    definition of this constraint.
-- =============================================================================
alter table public.push_sends drop constraint push_sends_kind_chk;
alter table public.push_sends
  add constraint push_sends_kind_chk check (kind in ('alert','sighting','message','recovery','credited'));

-- =============================================================================
-- 2. The idempotency claim column, on the credited sighting itself (one
--    credited sighting per post, so one push per post falls out for free).
--    SERVER-ONLY, same posture and reasoning as sightings.notified_at.
-- =============================================================================
alter table public.sightings
  add column credited_notified_at timestamptz;

comment on column public.sightings.credited_notified_at is
  'Credited-push idempotency CLAIM. NULL = the spotter has never been pushed about this credit. Set exactly once by claim_credited_notification (SECURITY DEFINER, SERVICE ROLE ONLY) via a conditional update, so replays and concurrent calls send nothing. Server-only: sightings carries no client write grant.';

create index sightings_credited_notify_pending_idx
  on public.sightings (id)
  where status = 'credited' and credited_notified_at is null;

-- =============================================================================
-- 3. The claim. Actor = the post OWNER (crediting is their action; the claim
--    re-verifies it rather than trusting the Edge Function's caller). Every
--    refusal — not the owner, no credited sighting, already notified, no such
--    post — returns the IDENTICAL {claimed:false}, so this is no oracle.
-- =============================================================================
create or replace function public.claim_credited_notification(
  p_post_id uuid,
  p_actor   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sighting_id uuid;
  v_spotter     uuid;
  v_bounty      integer;
  v_transfer    integer;
begin
  -- The credited sighting on a post the ACTOR owns. Status may be
  -- recovery_claimed (the normal moment) or recovered (a fast payout finished
  -- first) — both are legitimate times for the spotter to hear the news.
  select s.id, s.spotter_id
    into v_sighting_id, v_spotter
    from public.sightings s
    join public.posts p on p.id = s.post_id
   where s.post_id = p_post_id
     and s.status = 'credited'
     and p.owner_id = p_actor
     and p.status in ('recovery_claimed', 'recovered');

  if v_sighting_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- The conditional update IS the idempotency: of two concurrent calls,
  -- exactly one row comes back.
  update public.sightings
     set credited_notified_at = now()
   where id = v_sighting_id
     and credited_notified_at is null
  returning id into v_sighting_id;

  if v_sighting_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- MONEY: the spotter's share via payout_split — the one definition of the
  -- arithmetic. amount_pence is read whatever the payment status: held is the
  -- normal case, released means a fast payout beat the push.
  select p.amount_pence into v_bounty
    from public.payments p
   where p.post_id = p_post_id
     and p.status in ('held', 'released')
   limit 1;

  if v_bounty is null then
    -- A credit with no funded payment should be impossible (claim_recovery
    -- requires an active, paid post). Send no push rather than inventing a
    -- number.
    return jsonb_build_object('claimed', false);
  end if;

  select transfer_pence into v_transfer
    from public.payout_split(v_bounty);

  -- The COPY, built here so its privacy is DB-testable: an amount and an
  -- instruction. No car, no plate, no location, no owner name — the spotter
  -- knows which sighting was theirs, and the tap lands on /payouts where the
  -- context is money, not the vehicle.
  return jsonb_build_object(
    'claimed', true,
    'user_id', v_spotter,
    'post_id', p_post_id,
    'title', 'You''ve earned £' || to_char(v_transfer / 100.0, 'FM999990.00'),
    'body', 'Your sighting led to a recovery. Tell us where to send it.'
  );
end $$;

comment on function public.claim_credited_notification(uuid, uuid) is
  'One-shot claim for the credited-spotter push. Verifies the ACTOR owns the post and a credited sighting exists, then claims via conditional update on sightings.credited_notified_at. Amount in the copy comes from payout_split (the one 95/5 definition). Every refusal returns the identical {claimed:false} — no oracle. SERVICE ROLE ONLY.';

revoke all on function public.claim_credited_notification(uuid, uuid) from public;
revoke all on function public.claim_credited_notification(uuid, uuid) from anon;
revoke all on function public.claim_credited_notification(uuid, uuid) from authenticated;
grant execute on function public.claim_credited_notification(uuid, uuid) to service_role;
