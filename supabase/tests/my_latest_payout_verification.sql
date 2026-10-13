-- =============================================================================
-- WHAT:  Tier 1 verification for my_latest_payout() — the caller's most recent
--        SENT reward, and nothing else. NOT a migration.
-- WHY:   It is a security-definer window into the payments ledger, which is
--        otherwise service-role only. Its whole safety is in its WHERE clause:
--        lose `profile_id = auth.uid()` and every spotter reads every payout;
--        lose `status = 'released'` and a reward still in escrow reads as
--        sent — a promise about money that has not moved. Neither failure
--        raises anything on its own, so each is a check here.
--
-- CHECKS: 1 nothing sent → no rows · 2 ⚠️ held and refunded are never "sent" ·
-- 3 a released reward returns its post, recorded transfer and sent time ·
-- 4 the LATEST of two · 5 ⚠️ another user sees nothing · 6 grants: anon
-- cannot execute, authenticated can.
-- LINKS: supabase/migrations/20261013100000_a_spotter_can_see_their_reward_sent.sql.
--
-- SELF-ASSERTING: every check RAISES on failure (ON_ERROR_STOP=1). Everything
-- runs inside begin/rollback.
-- =============================================================================

begin;
do $$
declare
  v_spotter  uuid := '33333333-3333-3333-3333-333333333333';
  v_account  uuid;
  v_row      record;
  v_count    integer;
begin
  insert into public.stripe_connected_accounts
    (profile_id, stripe_account_id, onboarding_complete, payouts_enabled)
  values (v_spotter, 'acct_latest_payout_test', true, true)
  on conflict (profile_id) do update set payouts_enabled = true;

  select id into v_account
    from public.stripe_connected_accounts where profile_id = v_spotter;

  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);

  -- ---------------------------------------------------------------------
  -- CHECK 1 — nothing sent yet: no rows.
  -- ---------------------------------------------------------------------
  select count(*) into v_count from public.my_latest_payout();
  if v_count <> 0 then
    raise exception 'CHECK 1 FAILED: % row(s) before anything was sent', v_count;
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 2 — ⚠️ money still in escrow, or refunded, is NEVER "sent". Both
  -- name this spotter as payee, so only the status filter keeps them out.
  -- ---------------------------------------------------------------------
  insert into public.payments
    (post_id, stripe_payment_intent_id, status, amount_pence, payee_account_id)
  values
    ('a1a1a1a1-0000-0000-0000-000000000003', 'pi_latest_held', 'held', 25000, v_account),
    ('a1a1a1a1-0000-0000-0000-000000000004', 'pi_latest_refunded', 'refunded', 25000, v_account);

  select count(*) into v_count from public.my_latest_payout();
  if v_count <> 0 then
    raise exception 'CHECK 2 FAILED: a held or refunded payment read as SENT — the app would tell a spotter money moved that has not';
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 3 — a released reward: its post, the transfer RECORDED at release
  -- (not recomputed), and updated_at as the sent time.
  -- ---------------------------------------------------------------------
  insert into public.payments
    (post_id, stripe_payment_intent_id, status, amount_pence, payee_account_id,
     stripe_transfer_id, transfer_amount_pence, platform_fee_pence, updated_at)
  values
    ('a1a1a1a1-0000-0000-0000-000000000005', 'pi_latest_old', 'released', 20000, v_account,
     'tr_latest_old', 19000, 1000, now() - interval '5 days');

  select * into v_row from public.my_latest_payout();
  if v_row.post_id is distinct from 'a1a1a1a1-0000-0000-0000-000000000005'::uuid
     or v_row.transfer_pence is distinct from 19000 then
    raise exception 'CHECK 3 FAILED: got post % and % pence, expected the released reward (19000)',
      v_row.post_id, v_row.transfer_pence;
  end if;
  if v_row.sent_at > now() - interval '4 days' or v_row.sent_at < now() - interval '6 days' then
    raise exception 'CHECK 3 FAILED: sent_at % is not the release time (5 days ago)', v_row.sent_at;
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 4 — the LATEST of two sent rewards.
  -- ---------------------------------------------------------------------
  insert into public.payments
    (post_id, stripe_payment_intent_id, status, amount_pence, payee_account_id,
     stripe_transfer_id, transfer_amount_pence, platform_fee_pence, updated_at)
  values
    ('a1a1a1a1-0000-0000-0000-000000000006', 'pi_latest_new', 'released', 40000, v_account,
     'tr_latest_new', 38000, 2000, now() - interval '1 day');

  select * into v_row from public.my_latest_payout();
  if v_row.post_id is distinct from 'a1a1a1a1-0000-0000-0000-000000000006'::uuid then
    raise exception 'CHECK 4 FAILED: returned post %, not the most recently sent reward', v_row.post_id;
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 5 — ⚠️ another signed-in user sees NONE of it. The payee filter is
  -- the only thing between this ledger and every spotter's payouts.
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  select count(*) into v_count from public.my_latest_payout();
  if v_count <> 0 then
    raise exception 'CHECK 5 FAILED: another user read this spotter''s payout';
  end if;

  raise notice 'my_latest_payout CHECKS 1-5 passed';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 6 — grants. One user's money: anon must never reach it.
-- -----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.my_latest_payout()', 'execute') then
    raise exception 'CHECK 6 FAILED: anon can execute my_latest_payout';
  end if;
  if not has_function_privilege('authenticated', 'public.my_latest_payout()', 'execute') then
    raise exception 'CHECK 6 FAILED: authenticated cannot execute my_latest_payout';
  end if;
  raise notice 'my_latest_payout CHECK 6 passed';
end $$;

rollback;
