-- =============================================================================
-- WHAT:  Verification for 20261028100000_refund_claims_have_an_owner.sql. NOT a migration.
-- WHY:   The reward refund claim was one ownerless stamp: whichever claimant's
--        own ledger read failed released it, even when the OTHER claimant (the
--        sweep, the owner's deactivate, or an earlier timed-out attempt) might
--        already have sent the refund to Stripe — reopening credit and payout
--        under it (audit run 3, lead 1). Only the claim's creator may release.
-- CHECKS: 1 ⚠️ a request that JOINED someone else's claim cannot release it, and
-- the credit stays refused · 2 ⚠️ the creator's token releases it (and a
-- joiner's does not) · 3 the legacy one-argument release clears only a
-- token-less claim · 4 a null token is refused · 5 only the service role may
-- call the new functions.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        Alex (1111…) owns two live listings with held £250 rewards; Beth
--        (2222…) reported a sighting on the first.
-- LINKS: supabase/migrations/20261028100000_refund_claims_have_an_owner.sql;
--        supabase/functions/deactivate-post/index.ts;
--        supabase/functions/release-held-refunds/index.ts.
-- =============================================================================

begin;

insert into public.posts (id, owner_id, status, bounty_amount_pence, plate) values
  ('0c1a0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'active', 25000, 'OW01 NER'),
  ('0c1a0000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'active', 25000, 'OW02 NER');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind) values
  ('0c1a0000-0000-0000-0000-000000000001', 'pi_owner_shared', 'held', 25000, 'bounty_escrow'),
  ('0c1a0000-0000-0000-0000-000000000002', 'pi_owner_mine',   'held', 25000, 'bounty_escrow');
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('0c1a0000-0000-0000-0000-0000000000c1', '0c1a0000-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222', 'unverified', 'Ancoats', true);

-- -----------------------------------------------------------------------------
-- CHECK 1 — the sweep holds the claim; the owner's deactivate joins it and its
-- own read fails. Its release must not touch the sweep's claim.
-- -----------------------------------------------------------------------------
do $$
declare
  v_code text;
begin
  -- Stand-in for the sweep's claim (claim_reward_end_refund needs a full
  -- reward_end hold): stamped, with the sweep's token.
  update public.payments
     set reward_end_refund_claimed_at = now(),
         reward_end_refund_claim_token = 'a0000000-0000-0000-0000-00000000000a'
   where stripe_payment_intent_id = 'pi_owner_shared';

  if public.claim_deactivate_refund('0c1a0000-0000-0000-0000-000000000001',
                                    'b0000000-0000-0000-0000-00000000000b')
     is distinct from 'pi_owner_shared' then
    raise exception 'CHECK 1 FAILED: deactivate did not join the existing claim.';
  end if;
  if (select reward_end_refund_claim_token from public.payments
       where stripe_payment_intent_id = 'pi_owner_shared')
     is distinct from 'a0000000-0000-0000-0000-00000000000a'::uuid then
    raise exception 'CHECK 1 FAILED: joining the claim replaced its owner''s token.';
  end if;

  perform public.release_reward_end_refund_claim('pi_owner_shared', 'b0000000-0000-0000-0000-00000000000b');
  if (select reward_end_refund_claimed_at from public.payments
       where stripe_payment_intent_id = 'pi_owner_shared') is null then
    raise exception 'CHECK 1 FAILED: a request that only joined the claim released it.';
  end if;

  perform set_config('request.jwt.claims',
    '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
  set local role authenticated;
  begin
    perform public.claim_recovery('0c1a0000-0000-0000-0000-000000000001',
                                  '0c1a0000-0000-0000-0000-0000000000c1');
  exception when others then
    v_code := sqlerrm;
  end;
  reset role;
  if v_code is null or v_code not like '%REWARD_ENDING%' then
    raise exception 'CHECK 1 FAILED: the credit reopened under the other claimant''s refund (got %).',
                    coalesce(v_code, 'no error');
  end if;

  raise notice 'CHECK 1 passed: a joiner cannot release the claim, and the credit stays refused.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 2 — the creator's token releases its own claim; a joiner's does not.
-- -----------------------------------------------------------------------------
do $$
begin
  if public.claim_deactivate_refund('0c1a0000-0000-0000-0000-000000000002',
                                    'c0000000-0000-0000-0000-00000000000c')
     is distinct from 'pi_owner_mine' then
    raise exception 'CHECK 2 FAILED: the listing''s held reward could not be claimed.';
  end if;
  -- A second request (a retry, or the sweep) joins, then fails its read.
  perform public.claim_deactivate_refund('0c1a0000-0000-0000-0000-000000000002',
                                         'd0000000-0000-0000-0000-00000000000d');
  perform public.release_reward_end_refund_claim('pi_owner_mine', 'd0000000-0000-0000-0000-00000000000d');
  if (select reward_end_refund_claimed_at from public.payments
       where stripe_payment_intent_id = 'pi_owner_mine') is null then
    raise exception 'CHECK 2 FAILED: the joiner released the creator''s claim.';
  end if;

  perform public.release_reward_end_refund_claim('pi_owner_mine', 'c0000000-0000-0000-0000-00000000000c');
  if exists (select 1 from public.payments
              where stripe_payment_intent_id = 'pi_owner_mine'
                and (reward_end_refund_claimed_at is not null or reward_end_refund_claim_token is not null)) then
    raise exception 'CHECK 2 FAILED: the creator could not release its own claim.';
  end if;

  raise notice 'CHECK 2 passed: only the creator''s token releases the claim.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 3 — the legacy one-argument release clears only a token-less claim.
-- -----------------------------------------------------------------------------
do $$
begin
  perform public.release_reward_end_refund_claim('pi_owner_shared');
  if (select reward_end_refund_claimed_at from public.payments
       where stripe_payment_intent_id = 'pi_owner_shared') is null then
    raise exception 'CHECK 3 FAILED: the legacy release cleared an owned claim.';
  end if;

  update public.payments
     set reward_end_refund_claimed_at = now(), reward_end_refund_claim_token = null
   where stripe_payment_intent_id = 'pi_owner_mine';
  perform public.release_reward_end_refund_claim('pi_owner_mine');
  if (select reward_end_refund_claimed_at from public.payments
       where stripe_payment_intent_id = 'pi_owner_mine') is not null then
    raise exception 'CHECK 3 FAILED: the legacy release no longer clears its own token-less claim.';
  end if;

  raise notice 'CHECK 3 passed: legacy release clears only token-less claims.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 4 — a null token is refused, never treated as "anyone's".
-- -----------------------------------------------------------------------------
do $$
declare
  v_code text;
begin
  begin
    perform public.release_reward_end_refund_claim('pi_owner_shared', null);
  exception when others then
    v_code := sqlerrm;
  end;
  if v_code is null or v_code not like '%CLAIM_TOKEN_REQUIRED%' then
    raise exception 'CHECK 4 FAILED: a null token was accepted by the release (got %).', coalesce(v_code, 'no error');
  end if;

  v_code := null;
  begin
    perform public.claim_deactivate_refund('0c1a0000-0000-0000-0000-000000000002', null);
  exception when others then
    v_code := sqlerrm;
  end;
  if v_code is null or v_code not like '%CLAIM_TOKEN_REQUIRED%' then
    raise exception 'CHECK 4 FAILED: a null token was accepted by the claim (got %).', coalesce(v_code, 'no error');
  end if;

  raise notice 'CHECK 4 passed: a null token is refused.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 5 — only the service role may call the new functions.
-- -----------------------------------------------------------------------------
do $$
declare
  v_role text;
  v_fn   text;
begin
  foreach v_fn in array array[
    'public.claim_reward_end_refund(text, uuid)',
    'public.claim_deactivate_refund(uuid, uuid)',
    'public.release_reward_end_refund_claim(text, uuid)',
    'public.release_reward_end_refund_claim(text)'] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_role, v_fn, 'execute') then
        raise exception 'CHECK 5 FAILED: % can call %.', v_role, v_fn;
      end if;
    end loop;
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'CHECK 5 FAILED: the service role cannot call %.', v_fn;
    end if;
  end loop;
  raise notice 'CHECK 5 passed: only the service role calls them.';
end $$;

rollback;
