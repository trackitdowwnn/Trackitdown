-- -----------------------------------------------------------------------------
-- WHAT:  The three pushes of the dispute loop — `closed_uncredited` (a post
--        you sighted closed without crediting anyone; you have 72 hours),
--        `dispute_upheld` ("you've earned £X") and `dispute_rejected` — plus
--        the outcome claim function.
-- WHY:   `closed_uncredited` IS the feature: without it the owner-denial
--        control protects nobody, because no spotter learns there is anything
--        to contest. The two outcome kinds exist because v1 resolution is
--        hand-run SQL with no client in the loop — without the upheld push a
--        winning spotter never learns they won and never adds bank details
--        (the money strands in escrow); without the rejected push they hang
--        forever on "we're looking at it". Deliberately NO owner `refund_sent`
--        push: the owner initiated the exit, was told the date, and their
--        bank statement confirms.
--
--        The closed_uncredited copy itself is built by create_refund_hold
--        (previous migration) — the hold and its pushes are one atomic moment.
--        This migration adds the KINDS and the outcome claim.
--
-- MONEY: the upheld amount comes from `payout_split`, the one definition of
--        the 95/5 arithmetic — same rule as the credited push.
-- LINKS: supabase/migrations/20260805100000_refund_holds_and_disputes.sql;
--        supabase/migrations/20260804100000_credited_notification.sql (the
--          claim idiom + the money-on-lock-screen trade-off, recorded there);
--        supabase/functions/release-held-refunds/index.ts (the caller);
--        src/features/notifications/lib/notificationKinds.ts (the mirror —
--          notificationKinds.test.ts asserts it).
-- -----------------------------------------------------------------------------

-- =============================================================================
-- 1. The kind whitelist learns the dispute loop. Same one-greppable-line
--    format — notificationKinds.test.ts scans for the LATEST definition.
-- =============================================================================
alter table public.push_sends drop constraint push_sends_kind_chk;
alter table public.push_sends
  add constraint push_sends_kind_chk check (kind in ('alert','sighting','message','recovery','credited','closed_uncredited','dispute_upheld','dispute_rejected'));

-- =============================================================================
-- 2. The outcome claim. Actor-less on purpose: resolution is a hand-run
--    service-role act, so there is no user action to re-verify — the claim's
--    job is pure idempotency (the sweep retries; the spotter must hear once).
--    Every refusal returns the identical {claimed:false}.
-- =============================================================================
create or replace function public.claim_dispute_outcome_notification(
  p_dispute_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_status  text;
  v_spotter uuid;
  v_post    uuid;
  v_sight   uuid;
  v_bounty  integer;
  v_transfer integer;
begin
  -- Resolved and unclaimed only. The conditional update IS the idempotency.
  update public.refund_disputes
     set outcome_notified_at = now()
   where id = p_dispute_id
     and status in ('upheld', 'rejected')
     and outcome_notified_at is null
  returning id, status, spotter_id, post_id, sighting_id
    into v_id, v_status, v_spotter, v_post, v_sight;

  if v_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  if v_status = 'rejected' then
    -- Final and calm. No reasons: the evidence was weighed by a person, and
    -- a reasons string would become an argument surface.
    return jsonb_build_object(
      'claimed', true,
      'kind', 'dispute_rejected',
      'user_id', v_spotter,
      'sighting_id', v_sight,
      'title', 'About your sighting',
      'body', 'We looked into it carefully, and this bounty won''t be coming to you. Thank you for reporting it.'
    );
  end if;

  -- UPHELD: the earn moment, same shape as the credited push. held OR
  -- released — a fast payout may already have beaten this claim.
  select p.amount_pence into v_bounty
    from public.payments p
   where p.post_id = v_post
     and p.status in ('held', 'released')
   limit 1;

  if v_bounty is null then
    -- An upheld dispute with no funded payment should be impossible. Send no
    -- push rather than inventing a number (the claim stays consumed; the
    -- anomaly is for the logs, not the spotter).
    return jsonb_build_object('claimed', false);
  end if;

  select transfer_pence into v_transfer from public.payout_split(v_bounty);

  return jsonb_build_object(
    'claimed', true,
    'kind', 'dispute_upheld',
    'user_id', v_spotter,
    'sighting_id', v_sight,
    'title', 'You''ve earned £' || to_char(v_transfer / 100.0, 'FM999990.00'),
    'body', 'You were right — your sighting led to the recovery. Tell us where to send it.'
  );
end $$;

comment on function public.claim_dispute_outcome_notification(uuid) is
  'One-shot claim for a resolved dispute''s outcome push. Conditional update on outcome_notified_at is the idempotency (the sweep retries; the spotter hears once). Upheld amount via payout_split, mirroring claim_credited_notification. Every refusal returns the identical {claimed:false}. SERVICE ROLE ONLY.';

revoke all on function public.claim_dispute_outcome_notification(uuid) from public;
revoke all on function public.claim_dispute_outcome_notification(uuid) from anon;
revoke all on function public.claim_dispute_outcome_notification(uuid) from authenticated;
grant execute on function public.claim_dispute_outcome_notification(uuid) to service_role;
