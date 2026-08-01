-- =============================================================================
-- WHAT:  public.mark_post_recovered_no_spotter — records the refund that
--        resolves a `recovery_claimed` post where the owner credited NOBODY,
--        advancing it to the terminal `recovered_no_spotter`.
-- WHY:   `claim_recovery` deliberately stops at `recovery_claimed` because
--        `recovered_no_spotter` means ALREADY REFUNDED (DOMAIN.md lifecycle 6)
--        and SQL cannot know whether Stripe succeeded. This is the other half:
--        the Edge Function refunds, then calls this to record it.
--
--        A SIBLING of mark_post_payment_refunded rather than a parameter on
--        it. That function is deliberately guarded to
--        `status in ('active','pending_verification')` precisely so a late or
--        duplicate webhook can never drag a later lifecycle state backwards to
--        `cancelled` — and `recovery_claimed` is exactly such a later state.
--        Widening its guard to let recovery through would re-open the hole it
--        was written to close, and "cancelled" is the wrong outcome anyway: the
--        car was FOUND, and the 30-day public "recently recovered" window and
--        the owner's history both depend on the distinction.
--
-- MONEY: identical escrow discipline to its sibling. The ledger moves
--        held -> refunded ONLY from `held`, so a duplicate call or a late
--        `charge.refunded` webhook can never regress a later state or
--        overwrite the recorded refund. Amounts are pence integers and are
--        computed by the Edge Function from Stripe's authoritative balance
--        transaction — never by the client, never here.
--
-- SAFETY: refuses to resolve a post that HAS a credited sighting. That post is
--        owed a payout, not a refund; paying the owner back while a spotter
--        holds a credited sighting would take the spotter's money. The guard
--        is here, at the write, and not only in the Edge Function.
-- LINKS: supabase/migrations/20260802200000_claim_recovery.sql;
--        supabase/migrations/20260729100000_post_refund_cancel.sql (the
--          sibling this mirrors, and whose guard explains the split);
--        supabase/functions/refund-recovery/index.ts (the only caller);
--        docs/DOMAIN.md (lifecycle 6); supabase/tests/recovery_verification.sql.
-- =============================================================================

create or replace function public.mark_post_recovered_no_spotter(
  p_payment_intent_id     text,
  p_refund_id             text,
  p_refunded_amount_pence integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_id uuid;
begin
  -- Lock the ledger row so payment + post move atomically against a concurrent
  -- redelivery of the same Stripe event.
  select post_id
    into v_post_id
  from public.payments
  where stripe_payment_intent_id = p_payment_intent_id
  for update;

  -- Benign no-op: a refund for an intent we never recorded.
  if not found then
    return;
  end if;

  -- SAFETY: a credited sighting means a spotter is owed this money. Refunding
  -- the owner here would pay the wrong party. Fail loudly — the Edge Function
  -- has already moved money at this point, so a silent no-op would strand a
  -- real Stripe refund with no record of it.
  if exists (
    select 1 from public.sightings
    where post_id = v_post_id and status = 'credited'
  ) then
    raise exception 'RECOVERY_HAS_CREDITED_SIGHTING';
  end if;

  -- Escrow held -> refunded. Guarded on 'held' so a duplicate or late delivery
  -- never regresses a later state or rewrites the recorded refund.
  update public.payments
     set status                = 'refunded',
         stripe_refund_id      = p_refund_id,
         refunded_amount_pence = p_refunded_amount_pence
   where stripe_payment_intent_id = p_payment_intent_id
     and status = 'held';

  -- Terminal state, ONLY from recovery_claimed. An allowlist of one: this must
  -- never resolve an active post (that is deactivate-post's job) nor re-resolve
  -- an already-terminal one.
  update public.posts
     set status = 'recovered_no_spotter'
   where id = v_post_id
     and status = 'recovery_claimed';
end $$;

comment on function public.mark_post_recovered_no_spotter(text, text, integer) is
  'Records the refund resolving a recovery where nobody was credited: payments held->refunded, post recovery_claimed->recovered_no_spotter. Raises if a credited sighting exists (that post is owed a payout, not a refund). Service-role only.';

-- Service-role ONLY. Like its sibling, this is called exclusively by an Edge
-- Function AFTER Stripe has moved money; a client that could call it would be
-- able to mark its own bounty refunded without a refund existing.
revoke all on function public.mark_post_recovered_no_spotter(text, text, integer) from public;
revoke all on function public.mark_post_recovered_no_spotter(text, text, integer) from anon;
revoke all on function public.mark_post_recovered_no_spotter(text, text, integer) from authenticated;
grant execute on function public.mark_post_recovered_no_spotter(text, text, integer) to service_role;
