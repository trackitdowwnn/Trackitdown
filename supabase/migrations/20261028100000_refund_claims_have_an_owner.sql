-- =============================================================================
-- WHAT: A reward refund claim now has an OWNER — the one request that made it —
--       and only that request can give it back (security audit run 3, lead 1).
--
-- WHY:  payments.reward_end_refund_claimed_at is one stamp shared by the hourly
--       sweep (claim_reward_end_refund, 20261026140000) and the owner's
--       deactivate (claim_deactivate_refund, 20261027100000). Both join an
--       existing stamp and report success, and both call
--       release_reward_end_refund_claim when their OWN ledger read fails — which
--       cleared the stamp whoever set it. So a request that only knew ITS refund
--       never reached Stripe could release a claim whose other holder's refund
--       (or an earlier attempt's, timed out but sent) might have: crediting and
--       payout reopened while the reward was on its way back to the owner.
--
-- HOW:  Each claim attempt brings its own random token (crypto.randomUUID() in
--       the Edge Function). The new two-argument claims store it ONLY when they
--       create the claim; joining an existing claim leaves the creator's token.
--       The new two-argument release clears the claim only when the token
--       matches. Everything else is unchanged: the same lock order, the same
--       re-checks, the same stamp that claim_recovery and begin_payout refuse on.
--
--       BACKWARD COMPATIBLE for the deploy window (migrations land a few seconds
--       before the functions): the one-argument claims are untouched and make
--       token-less claims; the one-argument release now clears ONLY a
--       token-less claim, so old code can still undo its own, never a new one.
--       ⚠️ Once deployed, nothing calls the one-argument versions; a later
--       migration may drop them.
-- =============================================================================

alter table public.payments
  add column reward_end_refund_claim_token uuid;

comment on column public.payments.reward_end_refund_claim_token is
  'The token of the request that CREATED the reward refund claim '
  '(reward_end_refund_claimed_at). Only release_reward_end_refund_claim with '
  'the same token may clear it. Null on claims made before 20261028100000.';

-- -----------------------------------------------------------------------------
-- claim_reward_end_refund(intent, token) — the sweep's claim, now owned.
-- Body as 20261026140000 apart from the token.
-- -----------------------------------------------------------------------------
create or replace function public.claim_reward_end_refund(p_payment_intent_id text, p_claim_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post    uuid;
  v_pay_id  uuid;
  v_started timestamptz;
begin
  if p_claim_token is null then
    raise exception 'CLAIM_TOKEN_REQUIRED';
  end if;

  select post_id into v_post
    from public.payments
   where stripe_payment_intent_id = p_payment_intent_id;
  if v_post is null then
    return false;
  end if;

  -- THE POST LOCK, then the payment — begin_payout's order.
  perform 1 from public.posts where id = v_post for update;
  select id, payout_started_at into v_pay_id, v_started
    from public.payments
   where stripe_payment_intent_id = p_payment_intent_id
     and status = 'held'
     and kind = 'bounty_escrow'
     for update;
  if v_pay_id is null or v_started is not null then
    return false;
  end if;

  if not exists (
    select 1 from public.refunds_due(1000, v_post) d
     where d.payment_intent_id = p_payment_intent_id
       and d.reason = 'reward_end'
  ) then
    return false;
  end if;

  -- SET sees the OLD row: the token is written only by the claim's creator.
  update public.payments
     set reward_end_refund_claim_token = case when reward_end_refund_claimed_at is null
                                              then p_claim_token else reward_end_refund_claim_token end,
         reward_end_refund_claimed_at  = coalesce(reward_end_refund_claimed_at, now())
   where id = v_pay_id;
  return true;
end $$;

comment on function public.claim_reward_end_refund(text, uuid) is
  'Service-role only (release-held-refunds). As claim_reward_end_refund(text), '
  'but the claim records p_claim_token when this call creates it, so only that '
  'request can release it. Joining an existing claim keeps its token. 20261028100000.';

revoke all on function public.claim_reward_end_refund(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_reward_end_refund(text, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- claim_deactivate_refund(post, token) — the owner's deactivate claim, owned.
-- Body as 20261027100000 apart from the token.
-- -----------------------------------------------------------------------------
create or replace function public.claim_deactivate_refund(p_post_id uuid, p_claim_token uuid)
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
  if p_claim_token is null then
    raise exception 'CLAIM_TOKEN_REQUIRED';
  end if;

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
     set reward_end_refund_claim_token = case when reward_end_refund_claimed_at is null
                                              then p_claim_token else reward_end_refund_claim_token end,
         reward_end_refund_claimed_at  = coalesce(reward_end_refund_claimed_at, now())
   where id = v_pay_id;
  return v_intent;
end $$;

comment on function public.claim_deactivate_refund(uuid, uuid) is
  'Service-role only (deactivate-post). As claim_deactivate_refund(uuid), but '
  'the claim records p_claim_token when this call creates it, so only that '
  'request can release it. Joining an existing claim keeps its token. 20261028100000.';

revoke all on function public.claim_deactivate_refund(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_deactivate_refund(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- release_reward_end_refund_claim(intent, token) — only the claim's creator.
-- -----------------------------------------------------------------------------
create or replace function public.release_reward_end_refund_claim(p_payment_intent_id text, p_claim_token uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post uuid;
begin
  if p_claim_token is null then
    raise exception 'CLAIM_TOKEN_REQUIRED';
  end if;

  select post_id into v_post
    from public.payments
   where stripe_payment_intent_id = p_payment_intent_id;
  if v_post is null then
    return;
  end if;

  perform 1 from public.posts where id = v_post for update;
  update public.payments
     set reward_end_refund_claimed_at  = null,
         reward_end_refund_claim_token = null
   where stripe_payment_intent_id = p_payment_intent_id
     and status = 'held'
     and reward_end_refund_claim_token = p_claim_token;
end $$;

comment on function public.release_reward_end_refund_claim(text, uuid) is
  'Service-role only. Clears a reward refund claim on a still-held payment ONLY '
  'when p_claim_token is the token of the request that created it — a request '
  'that merely joined a claim can never release it. 20261028100000.';

revoke all on function public.release_reward_end_refund_claim(text, uuid) from public, anon, authenticated;
grant execute on function public.release_reward_end_refund_claim(text, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- release_reward_end_refund_claim(intent) — legacy, deploy window only: it may
-- now clear only a TOKEN-LESS claim (one an old caller made itself).
-- -----------------------------------------------------------------------------
create or replace function public.release_reward_end_refund_claim(p_payment_intent_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post uuid;
begin
  select post_id into v_post
    from public.payments
   where stripe_payment_intent_id = p_payment_intent_id;
  if v_post is null then
    return;
  end if;

  perform 1 from public.posts where id = v_post for update;
  update public.payments
     set reward_end_refund_claimed_at = null
   where stripe_payment_intent_id = p_payment_intent_id
     and status = 'held'
     and reward_end_refund_claim_token is null;
end $$;

comment on function public.release_reward_end_refund_claim(text) is
  'LEGACY (pre-20261028100000 callers): clears only a token-less reward refund '
  'claim. Owned claims are released by release_reward_end_refund_claim(text, uuid).';

revoke all on function public.release_reward_end_refund_claim(text) from public, anon, authenticated;
grant execute on function public.release_reward_end_refund_claim(text) to service_role;
