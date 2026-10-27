-- =============================================================================
-- WHAT:  Verification for 20261027100000_a_deactivate_refund_takes_the_post_lock.sql.
--        NOT a migration.
-- WHY:   The owner's deactivate refund and a credit (or payout) of the same
--        reward used to race: the refund went out on an unlocked "still
--        active" read, so a sighting credited a moment earlier was left
--        unfunded (audit run 2, lead 1). Exactly one may win, under the post
--        lock.
--
-- CHECKS: 1 ⚠️ claimed → claim_recovery refuses the credit, begin_payout the
-- payout · 2 a claim is idempotent (a retry resumes) · 3 released → the
-- credit wins, and the refund is then refused · 4 a started payout is never
-- claimed · 5 nothing held, or not refundable → no claim · 6 only the service
-- role may claim.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        Alex (1111…) owns a live listing with a held £250 reward; Beth
--        (2222…) reported a sighting on it.
-- LINKS: supabase/migrations/20261027100000_a_deactivate_refund_takes_the_post_lock.sql;
--        supabase/functions/deactivate-post/index.ts;
--        supabase/tests/reward_end_refund_lock_verification.sql (the sibling).
-- =============================================================================

begin;

insert into public.posts (id, owner_id, status, bounty_amount_pence, plate) values
  ('6d6d0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'active', 25000, 'DE01 ACT');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind) values
  ('6d6d0000-0000-0000-0000-000000000001', 'pi_deactivate_lock', 'held', 25000, 'bounty_escrow');
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('6d6d0000-0000-0000-0000-0000000000c1', '6d6d0000-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222', 'unverified', 'Ancoats', true);

-- -----------------------------------------------------------------------------
-- CHECK 1 — once deactivate has claimed the refund, no credit and no payout.
-- -----------------------------------------------------------------------------
do $$
declare
  v_code text;
begin
  if public.claim_deactivate_refund('6d6d0000-0000-0000-0000-000000000001')
     is distinct from 'pi_deactivate_lock' then
    raise exception 'CHECK 1 FAILED: a live listing''s held reward could not be claimed for a refund.';
  end if;

  perform set_config('request.jwt.claims',
    '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
  set local role authenticated;
  v_code := null;
  begin
    perform public.claim_recovery('6d6d0000-0000-0000-0000-000000000001',
                                  '6d6d0000-0000-0000-0000-0000000000c1');
  exception when others then
    v_code := sqlerrm;
  end;
  reset role;

  if v_code is null or v_code not like '%REWARD_ENDING%' then
    raise exception 'CHECK 1 FAILED: claim_recovery credited a sighting on a reward being refunded '
                    '(got %).', coalesce(v_code, 'no error');
  end if;
  if (select status from public.sightings where id = '6d6d0000-0000-0000-0000-0000000000c1') = 'credited' then
    raise exception 'CHECK 1 FAILED: the sighting was credited anyway.';
  end if;

  v_code := null;
  begin
    perform public.begin_payout('6d6d0000-0000-0000-0000-000000000001');
  exception when others then
    v_code := sqlerrm;
  end;
  if v_code is null or v_code not like '%REWARD_ENDING%' then
    raise exception 'CHECK 1 FAILED: begin_payout started a payout from a reward being refunded '
                    '(got %).', coalesce(v_code, 'no error');
  end if;

  raise notice 'CHECK 1 passed: a claimed deactivate refund refuses both the credit and the payout.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 2 — a claim is idempotent: a retried deactivate resumes it.
-- (Run while still claimed from CHECK 1.)
-- -----------------------------------------------------------------------------
do $$
declare
  v_first timestamptz;
begin
  select reward_end_refund_claimed_at into v_first
    from public.payments where stripe_payment_intent_id = 'pi_deactivate_lock';
  if public.claim_deactivate_refund('6d6d0000-0000-0000-0000-000000000001')
     is distinct from 'pi_deactivate_lock' then
    raise exception 'CHECK 2 FAILED: an already-claimed refund was not handed back to a retry.';
  end if;
  if (select reward_end_refund_claimed_at from public.payments
       where stripe_payment_intent_id = 'pi_deactivate_lock') is distinct from v_first then
    raise exception 'CHECK 2 FAILED: re-claiming moved the claim stamp.';
  end if;

  raise notice 'CHECK 2 passed: a claimed refund is claimed again, unchanged.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 3 — released (no refund reached Stripe): the credit wins, and the
-- deactivate refund can no longer be claimed.
-- -----------------------------------------------------------------------------
do $$
begin
  perform public.release_reward_end_refund_claim('pi_deactivate_lock');

  perform set_config('request.jwt.claims',
    '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
  set local role authenticated;
  perform public.claim_recovery('6d6d0000-0000-0000-0000-000000000001',
                                '6d6d0000-0000-0000-0000-0000000000c1');
  reset role;

  if (select status from public.sightings where id = '6d6d0000-0000-0000-0000-0000000000c1') <> 'credited' then
    raise exception 'CHECK 3 FAILED: with no claim, the owner could not credit the finder.';
  end if;
  if public.claim_deactivate_refund('6d6d0000-0000-0000-0000-000000000001') is not null then
    raise exception 'CHECK 3 FAILED: deactivate claimed a refund of a reward already credited to a '
                    'spotter.';
  end if;

  raise notice 'CHECK 3 passed: a credit first wins, and the refund is then refused.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 4 — a payout that has started is never claimed for a refund.
-- -----------------------------------------------------------------------------
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate) values
  ('6d6d0000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'active', 25000, 'DE02 PAY');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind, payout_started_at)
values ('6d6d0000-0000-0000-0000-000000000002', 'pi_deactivate_paying', 'held', 25000, 'bounty_escrow', now());

do $$
begin
  if public.claim_deactivate_refund('6d6d0000-0000-0000-0000-000000000002') is not null then
    raise exception 'CHECK 4 FAILED: a reward with a payout in flight was claimed for a refund.';
  end if;
  raise notice 'CHECK 4 passed: a started payout is never claimed for a refund.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 5 — nothing held, or a post no longer refundable: no claim.
-- -----------------------------------------------------------------------------
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate) values
  ('6d6d0000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'active', 25000, 'DE03 NON'),
  ('6d6d0000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'cancelled', 25000, 'DE04 CAN');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind) values
  ('6d6d0000-0000-0000-0000-000000000004', 'pi_deactivate_cancelled', 'held', 25000, 'bounty_escrow');

do $$
begin
  if public.claim_deactivate_refund('6d6d0000-0000-0000-0000-000000000003') is not null then
    raise exception 'CHECK 5 FAILED: a post with no held reward was claimed.';
  end if;
  if public.claim_deactivate_refund('6d6d0000-0000-0000-0000-000000000004') is not null then
    raise exception 'CHECK 5 FAILED: a cancelled post''s reward was claimed.';
  end if;
  if (select reward_end_refund_claimed_at from public.payments
       where stripe_payment_intent_id = 'pi_deactivate_cancelled') is not null then
    raise exception 'CHECK 5 FAILED: a refused claim still stamped the payment.';
  end if;
  raise notice 'CHECK 5 passed: nothing held or not refundable → no claim.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 6 — only the service role may claim.
-- -----------------------------------------------------------------------------
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.claim_deactivate_refund(uuid)', 'execute') then
      raise exception 'CHECK 6 FAILED: % can claim a deactivate refund.', v_role;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.claim_deactivate_refund(uuid)', 'execute') then
    raise exception 'CHECK 6 FAILED: deactivate-post (service_role) cannot claim.';
  end if;
  raise notice 'CHECK 6 passed: only the service role claims.';
end $$;

rollback;
