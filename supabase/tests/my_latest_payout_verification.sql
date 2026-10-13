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
-- 3 a released reward returns its recorded transfer and sent time · 4 the
-- LATEST of two · 5 ⚠️ the "sent" push's stamp is the date, and a later
-- unrelated write does not move it · 6 a release with no recorded transfer is
-- never "£0 sent" · 7 ⚠️ two spotters WITH payouts each see only their own ·
-- 8 grants: anon cannot execute, authenticated can.
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
  if v_row.transfer_pence is distinct from 19000 then
    raise exception 'CHECK 3 FAILED: got % pence, expected the released reward''s recorded 19000',
      v_row.transfer_pence;
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
  if v_row.transfer_pence is distinct from 38000 then
    raise exception 'CHECK 4 FAILED: returned % pence, not the most recently sent reward (38000)', v_row.transfer_pence;
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 5 — ⚠️ THE DATE IS THE "SENT" PUSH'S, and nothing later moves it.
  -- claim_payout_sent_notification stamps payout_notified_at on the released
  -- row, and the updated_at trigger moves with ANY write — so updated_at
  -- alone would drift to the last unrelated stamp (security review).
  -- ---------------------------------------------------------------------
  update public.payments
     set payout_notified_at = now() - interval '20 hours'
   where stripe_payment_intent_id = 'pi_latest_new';
  -- An unrelated later write: the trigger moves updated_at to now().
  update public.payments
     set refund_fee_absorbed = refund_fee_absorbed
   where stripe_payment_intent_id = 'pi_latest_new';

  select * into v_row from public.my_latest_payout();
  if v_row.sent_at > now() - interval '19 hours' or v_row.sent_at < now() - interval '21 hours' then
    raise exception 'CHECK 5 FAILED: sent_at % is not the "sent" push''s stamp (20 hours ago) — an unrelated write moved it', v_row.sent_at;
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 6 — a release with NO recorded transfer is never "sent": the app
  -- would read it as "Your £0.00 reward".
  -- ---------------------------------------------------------------------
  insert into public.payments
    (post_id, stripe_payment_intent_id, status, amount_pence, payee_account_id,
     stripe_transfer_id, updated_at)
  values
    ('a1a1a1a1-0000-0000-0000-000000000001', 'pi_latest_unrecorded', 'released', 25000, v_account,
     'tr_latest_unrecorded', now());

  select * into v_row from public.my_latest_payout();
  if v_row.transfer_pence is distinct from 38000 then
    raise exception 'CHECK 6 FAILED: a release with no recorded transfer came back (% pence)', v_row.transfer_pence;
  end if;

  raise notice 'my_latest_payout CHECKS 1-6 passed';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 7 — ⚠️ TWO SPOTTERS WITH PAYOUTS each see only their own. The other
-- user must HAVE a connected account and a released payout of their own:
-- with neither, a broken payee join (`on true`, or on profile_id alone) would
-- still return nothing to them and pass — while in production handing every
-- spotter the latest payout on the whole ledger (security review).
-- -----------------------------------------------------------------------------
do $$
declare
  v_other    uuid := '11111111-1111-1111-1111-111111111111';
  v_theirs   uuid;
  v_row      record;
begin
  -- The spotter (3333…) keeps the account and payouts from the checks above:
  -- their latest is the 38000 one, sent 20 hours ago.
  insert into public.stripe_connected_accounts
    (profile_id, stripe_account_id, onboarding_complete, payouts_enabled)
  values (v_other, 'acct_latest_isolation_other', true, true);
  select id into v_theirs from public.stripe_connected_accounts where profile_id = v_other;

  -- Theirs is the NEWEST payout on the ledger: a broken join would hand it to
  -- everyone, including the spotter.
  insert into public.payments
    (post_id, stripe_payment_intent_id, status, amount_pence, payee_account_id,
     stripe_transfer_id, transfer_amount_pence, platform_fee_pence, updated_at)
  values
    ('a1a1a1a1-0000-0000-0000-000000000007', 'pi_iso_theirs', 'released', 30000, v_theirs,
     'tr_iso_theirs', 28500, 1500, now() - interval '1 hour');

  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  select * into v_row from public.my_latest_payout();
  if v_row.transfer_pence is distinct from 38000 then
    raise exception 'CHECK 7 FAILED: the spotter got % pence — not their own 38000; someone else''s payout leaked', v_row.transfer_pence;
  end if;

  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  select * into v_row from public.my_latest_payout();
  if v_row.transfer_pence is distinct from 28500 then
    raise exception 'CHECK 7 FAILED: the other user got % pence, not their own 28500', v_row.transfer_pence;
  end if;

  -- And a user with no payout account at all gets nothing.
  perform set_config('request.jwt.claims',
    '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
  if exists (select 1 from public.my_latest_payout()) then
    raise exception 'CHECK 7 FAILED: a user with no payout account read a payout';
  end if;

  raise notice 'my_latest_payout CHECK 7 passed';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 8 — grants. One user's money: anon must never reach it.
-- -----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.my_latest_payout()', 'execute') then
    raise exception 'CHECK 8 FAILED: anon can execute my_latest_payout';
  end if;
  if not has_function_privilege('authenticated', 'public.my_latest_payout()', 'execute') then
    raise exception 'CHECK 8 FAILED: authenticated cannot execute my_latest_payout';
  end if;
  raise notice 'my_latest_payout CHECK 8 passed';
end $$;

rollback;
