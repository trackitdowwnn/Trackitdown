-- =============================================================================
-- WHAT: The owner's "Deactivate listing" refund claims the reward under the
--       POST LOCK before any money moves, so a sighting credited (or a payout
--       started) at the same moment can never be refunded from under the
--       spotter (security audit run 2, lead 1).
--
-- WHY:  deactivate-post checked "still active" with an unlocked read, then
--       refunded through Stripe, and only mark_post_payment_refunded — AFTER
--       the money moved — took the lock. A claim_recovery landing in between
--       left the post recovery_claimed with its reward refunded: the credited
--       spotter's payout found NO_HELD_PAYMENT. Payout first, the refund then
--       went out on top of the transfer: the platform paid twice.
--
-- HOW:  The reward_end shape (20261026140000), reused rather than copied:
--         1. claim_deactivate_refund — under the post lock (post, then payment:
--            begin_payout's order), requires a refundable post, a held reward
--            and no payout started, and stamps the SAME
--            payments.reward_end_refund_claimed_at. Returns the claimed intent;
--            deactivate-post refunds exactly that payment.
--         2. claim_recovery and begin_payout already refuse while that stamp is
--            on a held payment (REWARD_ENDING) — unchanged, so not restated.
--         3. release_reward_end_refund_claim (unchanged) gives the claim back
--            when deactivate-post KNOWS no refund reached Stripe.
--       shortcut: the column keeps its reward_end name for both claims; rename
--       it (and restate claim_recovery/begin_payout) if a third claim appears.
-- =============================================================================

comment on column public.payments.reward_end_refund_claimed_at is
  'Set under the post lock when a refund of this held reward is about to be '
  'sent: by claim_reward_end_refund (the hourly sweep, reward at its term) or '
  'by claim_deactivate_refund (the owner deactivating, 20261027100000). While '
  'set on a held payment, claim_recovery will not credit a sighting and '
  'begin_payout will not start a payout. Cleared by '
  'release_reward_end_refund_claim when no refund reached Stripe; kept on the '
  'refunded row as the record.';

-- -----------------------------------------------------------------------------
-- claim_deactivate_refund — deactivate-post's claim on the post's held reward.
-- Returns the claimed payment intent id, or NULL = not now (no longer
-- refundable, nothing held, or a payout has started).
-- -----------------------------------------------------------------------------
create or replace function public.claim_deactivate_refund(p_post_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay_id  uuid;
  v_intent  text;
  v_started timestamptz;
begin
  -- THE POST LOCK, then the payment — begin_payout's order, so the two never
  -- deadlock. claim_recovery takes the same post lock. Re-checking the status
  -- UNDER the lock is the point: a credit moves the post to recovery_claimed.
  perform 1 from public.posts
   where id = p_post_id
     and status in ('active', 'pending_verification')
     for update;
  if not found then
    return null;
  end if;

  select id, stripe_payment_intent_id, payout_started_at
    into v_pay_id, v_intent, v_started
    from public.payments
   where post_id = p_post_id
     and status = 'held'
     and kind = 'bounty_escrow'
     for update;
  if v_pay_id is null or v_started is not null then
    return null;
  end if;

  update public.payments
     set reward_end_refund_claimed_at = coalesce(reward_end_refund_claimed_at, now())
   where id = v_pay_id;
  return v_intent;
end $$;

comment on function public.claim_deactivate_refund(uuid) is
  'Service-role only (deactivate-post). Under the post lock, checks the post '
  'is still refundable with a held reward and no payout started, and claims '
  'the refund; claim_recovery and begin_payout refuse while claimed. '
  'Idempotent: a retry gets the same intent back. 20261027100000.';

revoke all on function public.claim_deactivate_refund(uuid) from public, anon, authenticated;
grant execute on function public.claim_deactivate_refund(uuid) to service_role;
