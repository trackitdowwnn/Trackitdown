-- =============================================================================
-- WHAT:  Verification for 20261026140000_a_reward_end_refund_takes_the_post_lock.sql.
--        NOT a migration.
-- WHY:   A reward that ended at its term is refunded on a LIVE listing, where
--        the owner can still credit a finder. Exactly one may win, under the
--        post lock: until the sweep claims the refund a credit wins (the
--        owner's decision, 2026-10-26); once it is claimed, no credit and no
--        payout may start from that reward.
--
-- CHECKS: 1 ⚠️ claimed → claim_recovery refuses the credit, begin_payout the
-- payout · 2 released → the credit wins, and the claim then refuses ·
-- 3 a claim is idempotent (a crashed run resumes) · 4 a started payout is
-- never claimed · 5 only the service role may claim or release.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        Alex (1111…) owns a fresh live listing with a held £250 reward whose
--        reward_end hold has expired; Beth (2222…) reported a sighting on it.
-- LINKS: supabase/migrations/20261026140000_a_reward_end_refund_takes_the_post_lock.sql;
--        supabase/functions/release-held-refunds/index.ts (Phase 1).
-- =============================================================================

begin;

insert into public.posts (id, owner_id, status, bounty_amount_pence, plate) values
  ('6e6e0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'active', 25000, 'RE01 END');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind) values
  ('6e6e0000-0000-0000-0000-000000000001', 'pi_reward_end_lock', 'held', 25000, 'bounty_escrow');
insert into public.refund_holds (post_id, owner_id, payment_id, exit_path, system_initiated, sighting_ids, expires_at)
select '6e6e0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', id,
       'reward_end', true, '{}'::uuid[], now() - interval '1 hour'
  from public.payments where stripe_payment_intent_id = 'pi_reward_end_lock';
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('6e6e0000-0000-0000-0000-0000000000c1', '6e6e0000-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222', 'unverified', 'Ancoats', true);

-- -----------------------------------------------------------------------------
-- CHECK 1 — once the sweep has claimed the refund, no credit and no payout.
-- -----------------------------------------------------------------------------
do $$
declare
  v_code text;
begin
  if not public.claim_reward_end_refund('pi_reward_end_lock') then
    raise exception 'CHECK 1 FAILED: an expired reward_end refund with no credit could not be claimed.';
  end if;

  perform set_config('request.jwt.claims',
    '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
  set local role authenticated;
  v_code := null;
  begin
    perform public.claim_recovery('6e6e0000-0000-0000-0000-000000000001',
                                  '6e6e0000-0000-0000-0000-0000000000c1');
  exception when others then
    v_code := sqlerrm;
  end;
  reset role;

  if v_code is null or v_code not like '%REWARD_ENDING%' then
    raise exception 'CHECK 1 FAILED: claim_recovery credited a sighting on a reward being refunded '
                    '(got %).', coalesce(v_code, 'no error');
  end if;
  if (select status from public.sightings where id = '6e6e0000-0000-0000-0000-0000000000c1') = 'credited' then
    raise exception 'CHECK 1 FAILED: the sighting was credited anyway.';
  end if;

  v_code := null;
  begin
    perform public.begin_payout('6e6e0000-0000-0000-0000-000000000001');
  exception when others then
    v_code := sqlerrm;
  end;
  if v_code is null or v_code not like '%REWARD_ENDING%' then
    raise exception 'CHECK 1 FAILED: begin_payout started a payout from a reward being refunded '
                    '(got %).', coalesce(v_code, 'no error');
  end if;

  raise notice 'CHECK 1 passed: a claimed refund refuses both the credit and the payout.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 3 — a claim is idempotent: a run that died after claiming resumes.
-- (Run while still claimed from CHECK 1.)
-- -----------------------------------------------------------------------------
do $$
declare
  v_first timestamptz;
begin
  select reward_end_refund_claimed_at into v_first
    from public.payments where stripe_payment_intent_id = 'pi_reward_end_lock';
  if not public.claim_reward_end_refund('pi_reward_end_lock') then
    raise exception 'CHECK 3 FAILED: an already-claimed, still-due refund was not handed back to '
                    'the sweep — a crashed run could never finish it.';
  end if;
  if (select reward_end_refund_claimed_at from public.payments
       where stripe_payment_intent_id = 'pi_reward_end_lock') is distinct from v_first then
    raise exception 'CHECK 3 FAILED: re-claiming moved the claim stamp.';
  end if;

  raise notice 'CHECK 3 passed: a claimed refund is claimed again, unchanged.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 2 — released (no refund reached Stripe): the credit wins, and the
-- sweep can no longer claim the refund.
-- -----------------------------------------------------------------------------
do $$
begin
  perform public.release_reward_end_refund_claim('pi_reward_end_lock');
  if (select reward_end_refund_claimed_at from public.payments
       where stripe_payment_intent_id = 'pi_reward_end_lock') is not null then
    raise exception 'CHECK 2 FAILED: the claim was not released.';
  end if;

  perform set_config('request.jwt.claims',
    '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
  set local role authenticated;
  perform public.claim_recovery('6e6e0000-0000-0000-0000-000000000001',
                                '6e6e0000-0000-0000-0000-0000000000c1');
  reset role;

  if (select status from public.sightings where id = '6e6e0000-0000-0000-0000-0000000000c1') <> 'credited' then
    raise exception 'CHECK 2 FAILED: with no claim, the owner could not credit the finder.';
  end if;
  if public.claim_reward_end_refund('pi_reward_end_lock') then
    raise exception 'CHECK 2 FAILED: the sweep claimed a refund of a reward already credited to a '
                    'spotter.';
  end if;

  raise notice 'CHECK 2 passed: before the claim a credit wins, and the refund is then refused.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 4 — a payout that has started is never claimed for a refund.
-- -----------------------------------------------------------------------------
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate) values
  ('6e6e0000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'active', 25000, 'RE02 END');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind, payout_started_at)
values ('6e6e0000-0000-0000-0000-000000000002', 'pi_reward_end_paying', 'held', 25000, 'bounty_escrow', now());
insert into public.refund_holds (post_id, owner_id, payment_id, exit_path, system_initiated, sighting_ids, expires_at)
select '6e6e0000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', id,
       'reward_end', true, '{}'::uuid[], now() - interval '1 hour'
  from public.payments where stripe_payment_intent_id = 'pi_reward_end_paying';

do $$
begin
  if public.claim_reward_end_refund('pi_reward_end_paying') then
    raise exception 'CHECK 4 FAILED: a reward with a payout in flight was claimed for a refund.';
  end if;
  raise notice 'CHECK 4 passed: a started payout is never claimed for a refund.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 5 — only the service role may claim or release.
-- -----------------------------------------------------------------------------
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.claim_reward_end_refund(text)', 'execute')
       or has_function_privilege(v_role, 'public.release_reward_end_refund_claim(text)', 'execute') then
      raise exception 'CHECK 5 FAILED: % can claim or release a reward refund.', v_role;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.claim_reward_end_refund(text)', 'execute') then
    raise exception 'CHECK 5 FAILED: the sweep (service_role) cannot claim.';
  end if;
  raise notice 'CHECK 5 passed: only the service role claims or releases.';
end $$;

rollback;
