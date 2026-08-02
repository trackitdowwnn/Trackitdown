-- =============================================================================
-- WHAT:  The payout half of a recovery — `payout_split` (the canonical 95/5
--        arithmetic) and `mark_recovery_paid` (records the transfer and closes
--        the post as `recovered`).
-- WHY:   `claim_recovery` stops at `recovery_claimed` because `recovered` means
--        ALREADY PAID (DOMAIN.md lifecycle 5) and SQL cannot know whether
--        Stripe moved the money. This is the half that is told.
--
--        Sibling of `mark_post_recovered_no_spotter`, and the mirror image of
--        it: that one REFUSES when a credited sighting exists, this one
--        REQUIRES it. Between them every claimed recovery has exactly one legal
--        ending, and neither can accidentally perform the other's.
--
-- MONEY: ADR-0002 — separate charges and transfers, so the 5% is kept by
--        TRANSFER MATH, never `application_fee_amount` (that field only exists
--        for destination/direct charges). The bounty sits on the platform
--        balance from capture until it is transferred or refunded.
--
--        `payout_split` is the ONE definition of the arithmetic. The Edge
--        Function must compute the same numbers to create the Stripe transfer,
--        so it necessarily has its own copy — therefore this function
--        RE-DERIVES the split and REJECTS a mismatch. A client, a bug or a
--        future edit that tries to record a different division of the bounty
--        than the rule permits is refused at the write, not trusted because it
--        came from a server. That check is the point of this migration.
--
--        Integer pence only. `transfer + fee = bounty` EXACTLY, by construction
--        (the fee is the remainder, never a second rounding).
--
-- SAFETY: service_role only. A client that could call `mark_recovery_paid`
--         could mark a bounty released with no transfer behind it.
-- LINKS: supabase/migrations/20260802200000_claim_recovery.sql;
--        supabase/migrations/20260802210000_mark_recovered_no_spotter.sql
--          (the sibling this mirrors);
--        supabase/functions/release-payout/index.ts (the only caller);
--        docs/decisions/ADR-0002-stripe-connect.md; docs/DOMAIN.md (lifecycle 5,
--        "Bounty rules"); supabase/tests/recovery_verification.sql.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The canonical split.
-- IMMUTABLE so it can be used in checks and so the planner may fold it. Kept as
-- integer arithmetic end to end: `* 95 / 100` with explicit rounding rather than
-- `* 0.95`, so no float ever touches money.
-- -----------------------------------------------------------------------------
create or replace function public.payout_split(p_bounty_pence integer)
returns table (transfer_pence integer, fee_pence integer)
language sql
immutable
set search_path = ''
as $$
  select
    round(p_bounty_pence::numeric * 95 / 100)::integer as transfer_pence,
    -- The REMAINDER, never a second rounding. Guarantees the two halves add
    -- back to exactly the bounty; rounding both independently could lose or
    -- invent a penny.
    p_bounty_pence - round(p_bounty_pence::numeric * 95 / 100)::integer as fee_pence;
$$;

comment on function public.payout_split(integer) is
  'The canonical 95/5 bounty split (ADR-0002 transfer math). Integer pence; the fee is the remainder so transfer + fee = bounty exactly. The Edge Function computes the same numbers to create the Stripe transfer, and mark_recovery_paid re-derives them to reject any other division.';

grant execute on function public.payout_split(integer) to service_role;
revoke all on function public.payout_split(integer) from public;
revoke all on function public.payout_split(integer) from anon;
revoke all on function public.payout_split(integer) from authenticated;


-- -----------------------------------------------------------------------------
-- 2. Record the transfer and close the post.
-- -----------------------------------------------------------------------------
create or replace function public.mark_recovery_paid(
  p_payment_intent_id     text,
  p_transfer_id           text,
  p_payee_account_id      uuid,
  p_transfer_amount_pence integer,
  p_platform_fee_pence    integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_id  uuid;
  v_amount   integer;
  v_expected record;
begin
  -- Lock the ledger row so payment + post move atomically against a concurrent
  -- redelivery of the same Stripe event.
  select post_id, amount_pence
    into v_post_id, v_amount
  from public.payments
  where stripe_payment_intent_id = p_payment_intent_id
  for update;

  -- Benign no-op: a transfer for an intent we never recorded.
  if not found then
    return;
  end if;

  -- MONEY: re-derive the split and refuse anything else. The caller already
  -- computed these to create the Stripe transfer; this is the independent
  -- check that the numbers about to be written are the numbers the rule
  -- permits. Raises rather than no-ops — money has already moved by now, so
  -- silently declining to record it would strand a real transfer.
  select * into v_expected from public.payout_split(v_amount);
  if p_transfer_amount_pence <> v_expected.transfer_pence
     or p_platform_fee_pence <> v_expected.fee_pence then
    raise exception
      'PAYOUT_SPLIT_MISMATCH: got %/% for a % bounty, expected %/%',
      p_transfer_amount_pence, p_platform_fee_pence, v_amount,
      v_expected.transfer_pence, v_expected.fee_pence;
  end if;

  -- SAFETY: a payout requires a credited sighting. Without one there is nobody
  -- this money belongs to, and the correct ending is a refund
  -- (mark_post_recovered_no_spotter). The exact inverse of that function's
  -- guard, so the two endings can never be confused for one another.
  if not exists (
    select 1 from public.sightings
    where post_id = v_post_id and status = 'credited'
  ) then
    raise exception 'PAYOUT_WITHOUT_CREDITED_SIGHTING';
  end if;

  -- Escrow held -> released. Guarded on 'held' so a duplicate or late delivery
  -- never regresses a later state or rewrites the recorded transfer.
  update public.payments
     set status                = 'released',
         stripe_transfer_id    = p_transfer_id,
         payee_account_id      = p_payee_account_id,
         transfer_amount_pence = p_transfer_amount_pence,
         platform_fee_pence    = p_platform_fee_pence
   where stripe_payment_intent_id = p_payment_intent_id
     and status = 'held';

  -- Terminal state, ONLY from recovery_claimed. An allowlist of one: this must
  -- never close an active post, nor re-close an already-terminal one.
  update public.posts
     set status = 'recovered'
   where id = v_post_id
     and status = 'recovery_claimed';
end $$;

comment on function public.mark_recovery_paid(text, text, uuid, integer, integer) is
  'Records the bounty transfer to a credited spotter: payments held->released, post recovery_claimed->recovered. Re-derives the 95/5 split and RAISES on a mismatch. Requires a credited sighting (the inverse of mark_post_recovered_no_spotter). Service-role only.';

revoke all on function public.mark_recovery_paid(text, text, uuid, integer, integer) from public;
revoke all on function public.mark_recovery_paid(text, text, uuid, integer, integer) from anon;
revoke all on function public.mark_recovery_paid(text, text, uuid, integer, integer) from authenticated;
grant execute on function public.mark_recovery_paid(text, text, uuid, integer, integer) to service_role;


-- -----------------------------------------------------------------------------
-- 3. The connected-account writer.
-- stripe_connected_accounts has a SELECT-own policy and no write grant, so the
-- onboarding Edge Function needs a service-role way in. Kept as an RPC rather
-- than a direct table write so the upsert rule lives in one audited place.
-- -----------------------------------------------------------------------------
create or replace function public.upsert_connected_account(
  p_profile_id          uuid,
  p_stripe_account_id   text,
  p_onboarding_complete boolean,
  p_payouts_enabled     boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.stripe_connected_accounts
    (profile_id, stripe_account_id, onboarding_complete, payouts_enabled)
  values (p_profile_id, p_stripe_account_id, p_onboarding_complete, p_payouts_enabled)
  on conflict (profile_id) do update
    set stripe_account_id   = excluded.stripe_account_id,
        onboarding_complete = excluded.onboarding_complete,
        payouts_enabled     = excluded.payouts_enabled,
        updated_at          = now();
end $$;

comment on function public.upsert_connected_account(uuid, text, boolean, boolean) is
  'Service-role writer for stripe_connected_accounts (the table has SELECT-own only). Called by the Connect onboarding function and by the account.updated webhook.';

revoke all on function public.upsert_connected_account(uuid, text, boolean, boolean) from public;
revoke all on function public.upsert_connected_account(uuid, text, boolean, boolean) from anon;
revoke all on function public.upsert_connected_account(uuid, text, boolean, boolean) from authenticated;
grant execute on function public.upsert_connected_account(uuid, text, boolean, boolean) to service_role;
