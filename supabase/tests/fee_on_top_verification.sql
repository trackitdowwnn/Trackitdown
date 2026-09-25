-- =============================================================================
-- Fee-on-top verification — "the reward is the reward" (ADR-0020,
-- 20260925100000). NOT a migration — do not place in migrations/.
--
-- SELF-ASSERTING: every check RAISES EXCEPTION on failure, so psql -v
-- ON_ERROR_STOP=1 exits non-zero on the first violated money property. Tier 1
-- (docs/TESTING.md). Every check runs inside begin…rollback on its own fixture
-- posts, so nothing here leaks into the suites that sort after it.
--
-- The properties, in one line each:
--   * a reward listing is CHARGED reward + floor(5%), and records that split;
--   * the bare reward (the pre-ADR-0020 price) is now REFUSED;
--   * payments_split_check makes every other split unwritable;
--   * the spotter is PAID the stored reward — in full on a fee_on_top row —
--     and told that same number;
--   * rows written without a pricing (legacy shape) keep the old 95/5 rule;
--   * settlement dates are stamped by the status change.
--
-- Fixtures: owner 22222222-… and spotter 33333333-… from supabase/seed.sql.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — A LEGACY-SHAPED ROW KEEPS THE OLD RULE. An insert with no pricing
-- (every fixture written before ADR-0020) is filled by
-- payments_fill_legacy_split: escrow -> fee_inside 95/5, a fee -> flat_fee.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('f0f0f0f0-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222', 'active', 25000, 'FT01 OLD');
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('f0f0f0f0-0000-0000-0000-000000000002',
        '22222222-2222-2222-2222-222222222222', 'active', null, 'FT02 FEE');

do $$
declare
  v_pricing public.payment_pricing;
  v_reward  integer;
  v_fee     integer;
begin
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
  values ('f0f0f0f0-0000-0000-0000-000000000001', 'pi_ft1_escrow', 'held', 25000);
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
  values ('f0f0f0f0-0000-0000-0000-000000000002', 'pi_ft1_fee', 'collected', 500, 'listing_fee');

  select pricing, reward_pence, service_fee_pence into v_pricing, v_reward, v_fee
    from public.payments where stripe_payment_intent_id = 'pi_ft1_escrow';
  if v_pricing <> 'fee_inside' or v_reward <> 23750 or v_fee <> 1250 then
    raise exception 'CHECK 1 FAILED: legacy escrow row filled as %/%/%, expected fee_inside/23750/1250',
      v_pricing, v_reward, v_fee;
  end if;

  select pricing, reward_pence, service_fee_pence into v_pricing, v_reward, v_fee
    from public.payments where stripe_payment_intent_id = 'pi_ft1_fee';
  if v_pricing <> 'flat_fee' or v_reward is not null or v_fee <> 500 then
    raise exception 'CHECK 1 FAILED: legacy fee row filled as %/%/%, expected flat_fee/null/500',
      v_pricing, v_reward, v_fee;
  end if;
  raise notice 'CHECK 1 passed: rows written without a pricing keep the pre-ADR-0020 split';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 — THE CHARGE IS REWARD + 5%. A £250 reward is charged £262.50 and
-- recorded as fee_on_top 25000/1250. The bare reward — what every build before
-- ADR-0020 charged — is refused with BOUNTY_MISMATCH and writes nothing.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('f0f0f0f0-0000-0000-0000-000000000003',
        '22222222-2222-2222-2222-222222222222', 'draft', 25000, 'FT03 NEW');

do $$
declare
  v_rows    integer;
  v_pricing public.payment_pricing;
  v_kind    public.payment_kind;
  v_amount  integer;
  v_reward  integer;
  v_fee     integer;
begin
  begin
    perform public.record_post_payment_intent(
      'f0f0f0f0-0000-0000-0000-000000000003', 'pi_ft2_bare', 25000);
    raise exception 'CHECK 2 FAILED: the bare reward (the old price) was accepted as the charge';
  exception when others then
    if sqlerrm not like '%BOUNTY_MISMATCH%' then raise; end if;
  end;

  select count(*) into v_rows from public.payments
   where post_id = 'f0f0f0f0-0000-0000-0000-000000000003';
  if v_rows <> 0 then
    raise exception 'CHECK 2 FAILED: the refused charge still wrote % row(s)', v_rows;
  end if;

  perform public.record_post_payment_intent(
    'f0f0f0f0-0000-0000-0000-000000000003', 'pi_ft2', 26250);

  select pricing, kind, amount_pence, reward_pence, service_fee_pence
    into v_pricing, v_kind, v_amount, v_reward, v_fee
    from public.payments where stripe_payment_intent_id = 'pi_ft2';
  if v_pricing <> 'fee_on_top' or v_kind <> 'bounty_escrow'
     or v_amount <> 26250 or v_reward <> 25000 or v_fee <> 1250 then
    raise exception 'CHECK 2 FAILED: recorded %/%/%/%/%, expected fee_on_top/bounty_escrow/26250/25000/1250',
      v_pricing, v_kind, v_amount, v_reward, v_fee;
  end if;
  raise notice 'CHECK 2 passed: a £250 reward is charged £262.50 and recorded as fee_on_top; the bare reward is refused';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — THE FEE ROUNDS DOWN, AND THE BOUNDS APPLY TO THE REWARD.
-- 5% of 1234p is 61.7p: the charge is 1295, never 1296. A £5,000 reward is
-- charged £5,250 — above the old 500000 cap, which bounded the CHARGE.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('f0f0f0f0-0000-0000-0000-000000000004',
        '22222222-2222-2222-2222-222222222222', 'draft', 1234, 'FT04 ODD'),
       ('f0f0f0f0-0000-0000-0000-000000000005',
        '22222222-2222-2222-2222-222222222222', 'draft', 500000, 'FT05 MAX');

do $$
declare
  v_fee integer;
begin
  begin
    perform public.record_post_payment_intent(
      'f0f0f0f0-0000-0000-0000-000000000004', 'pi_ft3_ceil', 1296);
    raise exception 'CHECK 3 FAILED: a rounded-UP fee (1296) was accepted';
  exception when others then
    if sqlerrm not like '%BOUNTY_MISMATCH%' then raise; end if;
  end;

  perform public.record_post_payment_intent(
    'f0f0f0f0-0000-0000-0000-000000000004', 'pi_ft3_floor', 1295);
  select service_fee_pence into v_fee
    from public.payments where stripe_payment_intent_id = 'pi_ft3_floor';
  if v_fee <> 61 then
    raise exception 'CHECK 3 FAILED: fee on 1234p recorded as %, expected 61 (floor)', v_fee;
  end if;

  perform public.record_post_payment_intent(
    'f0f0f0f0-0000-0000-0000-000000000005', 'pi_ft3_max', 525000);
  if not exists (select 1 from public.payments
                  where stripe_payment_intent_id = 'pi_ft3_max'
                    and amount_pence = 525000 and reward_pence = 500000) then
    raise exception 'CHECK 3 FAILED: the maximum reward could not be charged £5,250';
  end if;
  raise notice 'CHECK 3 passed: the fee is floor(5%%) and a £5,000 reward is charged £5,250';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 — payments_split_check MAKES EVERY OTHER SPLIT UNWRITABLE. Each row
-- below is one way a split could be wrong; each must fail on write with a
-- check_violation, never land and be discovered in a reconciliation.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('f0f0f0f0-0000-0000-0000-000000000006',
        '22222222-2222-2222-2222-222222222222', 'active', 25000, 'FT06 BAD');

do $$
declare
  v_case text;
  v_bad  record;
begin
  for v_bad in
    select * from (values
      ('fee_on_top with a fee that is not 5%',       'bounty_escrow', 'fee_on_top', 26000, 25000, 1000),
      ('fee_on_top whose charge is not reward+fee',  'bounty_escrow', 'fee_on_top', 26251, 25000, 1250),
      ('fee_on_top below the £10 reward floor',      'bounty_escrow', 'fee_on_top',  1039,   990,   49),
      ('fee_on_top on a listing-fee row',            'listing_fee',   'fee_on_top', 26250, 25000, 1250),
      ('fee_inside whose reward is not 95%',         'bounty_escrow', 'fee_inside', 25000, 25000,    0),
      ('flat_fee at any price but 500',              'listing_fee',   'flat_fee',     499,  null,  499),
      ('flat_fee carrying a reward',                 'listing_fee',   'flat_fee',     500,   475,  500),
      ('flat_fee on an escrow row',                  'bounty_escrow', 'flat_fee',     500,  null,  500),
      -- ⚠️ The NULL cases. A CHECK that evaluates to NULL PASSES, so without
      -- the coalesce(…, false) wrapper each of these would be accepted at any
      -- amount — a fee_on_top charge with no reward to bound it.
      ('fee_on_top with a NULL reward',              'bounty_escrow', 'fee_on_top', 99999,  null, 1250),
      ('fee_inside with a NULL reward',              'bounty_escrow', 'fee_inside', 25000,  null, 1250)
    ) as t(label, kind, pricing, amount, reward, fee)
  loop
    v_case := v_bad.label;
    begin
      insert into public.payments
        (post_id, stripe_payment_intent_id, status, amount_pence, kind,
         pricing, reward_pence, service_fee_pence)
      values
        ('f0f0f0f0-0000-0000-0000-000000000006', 'pi_ft4_' || md5(v_case), 'held',
         v_bad.amount, v_bad.kind::public.payment_kind, v_bad.pricing::public.payment_pricing,
         v_bad.reward, v_bad.fee);
      raise exception 'CHECK 4 FAILED: payments_split_check accepted "%"', v_case;
    exception when check_violation then
      null; -- refused, as it must be
    end;
  end loop;

  -- A NULL service fee is refused by the column itself.
  begin
    insert into public.payments
      (post_id, stripe_payment_intent_id, status, amount_pence, kind,
       pricing, reward_pence, service_fee_pence)
    values ('f0f0f0f0-0000-0000-0000-000000000006', 'pi_ft4_nullfee', 'held',
            25000, 'bounty_escrow', 'fee_on_top', 25000, null);
    raise exception 'CHECK 4 FAILED: a NULL service fee was accepted';
  exception when not_null_violation or check_violation then
    null;
  end;
  raise notice 'CHECK 4 passed: payments_split_check refuses every malformed split, NULLs included';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4b — A NEW ESCROW CHARGE MUST STATE ITS PRICING, AND NO SPLIT CAN BE
-- REWRITTEN. The legacy fill must never reach a real charge (a writer that
-- forgot the column would silently pay 95/5 of a fee-on-top charge), and a
-- recorded row may never be moved to another rule — even a valid one.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('f0f0f0f0-0000-0000-0000-00000000000a',
        '22222222-2222-2222-2222-222222222222', 'active', 25000, 'FT0A FIX');

do $$
declare
  v_ok boolean := false;
begin
  begin
    insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
    values ('f0f0f0f0-0000-0000-0000-00000000000a', 'pi_ft4b_bare', 'requires_payment', 25000, 'bounty_escrow');
  exception when check_violation then
    if sqlerrm like '%PRICING_REQUIRED%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then
    raise exception 'CHECK 4b FAILED: a new escrow charge with no pricing was filled as 95/5';
  end if;

  -- A legacy fee_inside row (charged £250) rewritten as a valid fee_on_top one
  -- (£250 reward, £12.50 fee, £262.50) would pay its spotter £12.50 more than
  -- was ever charged for them. Every split column is frozen.
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
  values ('f0f0f0f0-0000-0000-0000-00000000000a', 'pi_ft4b_legacy', 'held', 25000);
  v_ok := false;
  begin
    update public.payments
       set pricing = 'fee_on_top', amount_pence = 26250,
           reward_pence = 25000, service_fee_pence = 1250
     where stripe_payment_intent_id = 'pi_ft4b_legacy';
  exception when check_violation then
    if sqlerrm like '%PAYMENT_SPLIT_IMMUTABLE%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then
    raise exception 'CHECK 4b FAILED: a recorded split was rewritten to another rule';
  end if;

  -- A status write — the only kind real code makes — still goes through.
  update public.payments set status = 'refunded' where stripe_payment_intent_id = 'pi_ft4b_legacy';
  raise notice 'CHECK 4b passed: a new charge must state its pricing, and a recorded split is frozen';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4c — REUSE IS KEYED ON THE INTENT, NOT THE AMOUNT. A live row at the
-- same amount under a DIFFERENT intent (an expired idempotency key, or a legacy
-- row whose amount the new price happens to equal) must not swallow the new
-- intent: it is superseded, and the intent the app is about to pay is recorded.
-- Before 2026-09-25 the new intent went unrecorded and a paid card left no row.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('f0f0f0f0-0000-0000-0000-00000000000b',
        '22222222-2222-2222-2222-222222222222', 'draft', 25000, 'FT0B KEY');

do $$
declare
  v_old public.payment_status;
  v_new public.payment_status;
begin
  perform public.record_post_payment_intent(
    'f0f0f0f0-0000-0000-0000-00000000000b', 'pi_ft4c_first', 26250);
  perform public.record_post_payment_intent(
    'f0f0f0f0-0000-0000-0000-00000000000b', 'pi_ft4c_second', 26250);

  select status into v_old from public.payments where stripe_payment_intent_id = 'pi_ft4c_first';
  select status into v_new from public.payments where stripe_payment_intent_id = 'pi_ft4c_second';
  if v_old is distinct from 'failed' or v_new is distinct from 'requires_payment' then
    raise exception 'CHECK 4c FAILED: same-amount different-intent left %/%, expected failed/requires_payment',
      v_old, v_new;
  end if;

  -- And the same intent twice is still a no-op.
  perform public.record_post_payment_intent(
    'f0f0f0f0-0000-0000-0000-00000000000b', 'pi_ft4c_second', 26250);
  if (select count(*) from public.payments
       where post_id = 'f0f0f0f0-0000-0000-0000-00000000000b'
         and status = 'requires_payment') <> 1 then
    raise exception 'CHECK 4c FAILED: re-recording the same intent opened a second live row';
  end if;
  raise notice 'CHECK 4c passed: a new intent is always recorded; the same intent is reused';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 — THE SPOTTER IS PAID, AND TOLD, THE REWARD IN FULL.
-- A £400 fee_on_top listing (charged £420) is credited: the credited push says
-- "£400.00", my_pending_credit says 40000, and the payout records 40000 to the
-- spotter / 2000 to the platform. The OLD split of the charge (39900/2100) is
-- refused, and released_at is stamped by the status change.
-- -----------------------------------------------------------------------------
begin;
insert into public.stripe_connected_accounts
  (profile_id, stripe_account_id, onboarding_complete, payouts_enabled)
values ('33333333-3333-3333-3333-333333333333', 'acct_test_ft5', true, true)
on conflict (profile_id) do update set payouts_enabled = true;

insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('f0f0f0f0-0000-0000-0000-000000000007',
        '22222222-2222-2222-2222-222222222222', 'draft', 40000, 'FT07 PAY');

do $$
declare
  v_claim    jsonb;
  v_pending  integer;
  v_acct     uuid;
  v_status   text;
  v_transfer integer;
  v_fee      integer;
  v_released timestamptz;
  v_ok       boolean := false;
begin
  perform public.record_post_payment_intent(
    'f0f0f0f0-0000-0000-0000-000000000007', 'pi_ft5', 42000);
  perform public.mark_post_payment_held('pi_ft5');

  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
  values ('f0f0f0f0-1111-0000-0000-000000000007',
          'f0f0f0f0-0000-0000-0000-000000000007',
          '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true);

  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  perform public.claim_recovery('f0f0f0f0-0000-0000-0000-000000000007',
                                'f0f0f0f0-1111-0000-0000-000000000007');
  reset role;

  -- The push: the reward in full, not 95% of the charge.
  v_claim := public.claim_credited_notification(
    'f0f0f0f0-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222');
  if v_claim ->> 'kind' is distinct from 'credited'
     or v_claim ->> 'title' is distinct from 'You''ve earned £400.00' then
    raise exception 'CHECK 5 FAILED: credited push was % / %, expected credited / You''ve earned £400.00',
      v_claim ->> 'kind', v_claim ->> 'title';
  end if;

  -- The /payouts context line: the same number.
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  set local role authenticated;
  select transfer_pence into v_pending from public.my_pending_credit();
  reset role;
  if v_pending is distinct from 40000 then
    raise exception 'CHECK 5 FAILED: my_pending_credit says %, expected 40000', v_pending;
  end if;

  select id into v_acct from public.stripe_connected_accounts
   where profile_id = '33333333-3333-3333-3333-333333333333';

  -- The OLD rule applied to the charge must be refused.
  begin
    perform public.mark_recovery_paid('pi_ft5', 'tr_ft5_old', v_acct, 39900, 2100);
  exception when others then
    if sqlerrm like '%PAYOUT_SPLIT_MISMATCH%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then
    raise exception 'CHECK 5 FAILED: a 95/5 split of a fee_on_top charge was recorded';
  end if;

  perform public.mark_recovery_paid('pi_ft5', 'tr_ft5', v_acct, 40000, 2000);

  select status::text, transfer_amount_pence, platform_fee_pence, released_at
    into v_status, v_transfer, v_fee, v_released
    from public.payments where stripe_payment_intent_id = 'pi_ft5';
  if v_status <> 'released' or v_transfer <> 40000 or v_fee <> 2000 then
    raise exception 'CHECK 5 FAILED: payout recorded %/%/%, expected released/40000/2000',
      v_status, v_transfer, v_fee;
  end if;
  if v_released is null then
    raise exception 'CHECK 5 FAILED: released_at was not stamped by the status change';
  end if;
  raise notice 'CHECK 5 passed: a £400 reward is pushed, shown and paid as £400; the old split is refused';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 6 — A LEGACY ROW IS STILL PAID UNDER ITS OWN RULE. The new rule must
-- never reach money charged under the old one: paying a fee_inside charge in
-- full (25000/0) is refused; its 95/5 (23750/1250) is what it pays.
-- -----------------------------------------------------------------------------
begin;
insert into public.stripe_connected_accounts
  (profile_id, stripe_account_id, onboarding_complete, payouts_enabled)
values ('33333333-3333-3333-3333-333333333333', 'acct_test_ft6', true, true)
on conflict (profile_id) do update set payouts_enabled = true;

insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('f0f0f0f0-0000-0000-0000-000000000008',
        '22222222-2222-2222-2222-222222222222', 'active', 25000, 'FT08 LEG');

do $$
declare
  v_acct uuid;
  v_ok   boolean := false;
begin
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
  values ('f0f0f0f0-0000-0000-0000-000000000008', 'pi_ft6', 'held', 25000);

  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
  values ('f0f0f0f0-1111-0000-0000-000000000008',
          'f0f0f0f0-0000-0000-0000-000000000008',
          '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true);

  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  perform public.claim_recovery('f0f0f0f0-0000-0000-0000-000000000008',
                                'f0f0f0f0-1111-0000-0000-000000000008');
  reset role;

  select id into v_acct from public.stripe_connected_accounts
   where profile_id = '33333333-3333-3333-3333-333333333333';

  begin
    perform public.mark_recovery_paid('pi_ft6', 'tr_ft6_full', v_acct, 25000, 0);
  exception when others then
    if sqlerrm like '%PAYOUT_SPLIT_MISMATCH%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then
    raise exception 'CHECK 6 FAILED: a legacy fee_inside charge was paid out in full';
  end if;

  perform public.mark_recovery_paid('pi_ft6', 'tr_ft6', v_acct, 23750, 1250);
  if not exists (select 1 from public.payments
                  where stripe_payment_intent_id = 'pi_ft6'
                    and status = 'released' and transfer_amount_pence = 23750) then
    raise exception 'CHECK 6 FAILED: the legacy row did not pay its own 95/5';
  end if;
  raise notice 'CHECK 6 passed: a legacy fee_inside row pays 95/5 and cannot be paid in full';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 7 — refunded_at IS STAMPED BY THE STATUS CHANGE, with the database's
-- clock rather than a caller's, and can never be rewritten afterwards.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('f0f0f0f0-0000-0000-0000-000000000009',
        '22222222-2222-2222-2222-222222222222', 'active', 25000, 'FT09 REF');

do $$
declare
  v_first timestamptz;
  v_ok    boolean := false;
begin
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
  values ('f0f0f0f0-0000-0000-0000-000000000009', 'pi_ft7', 'held', 25000);

  -- A caller-supplied date on the transition is ignored: now() wins.
  update public.payments
     set status = 'refunded', refunded_amount_pence = 24605,
         refunded_at = '2001-01-01'
   where stripe_payment_intent_id = 'pi_ft7';
  select refunded_at into v_first from public.payments where stripe_payment_intent_id = 'pi_ft7';
  if v_first is null or v_first < now() - interval '1 minute' then
    raise exception 'CHECK 7 FAILED: refunded_at is %, expected the moment of the status change', v_first;
  end if;

  -- And once stamped, it cannot be moved.
  begin
    update public.payments set refunded_at = '2001-01-01'
     where stripe_payment_intent_id = 'pi_ft7';
  exception when check_violation then
    if sqlerrm like '%PAYMENT_SETTLED_AT_IMMUTABLE%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then
    raise exception 'CHECK 7 FAILED: a stamped refunded_at was rewritten';
  end if;
  raise notice 'CHECK 7 passed: refunded_at is stamped by the status change, with now(), and then frozen';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 8 — THE TRIGGER FUNCTIONS ARE NOT CALLABLE BY CLIENTS.
-- -----------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.payments_fill_legacy_split()',
    'public.payments_stamp_settled_at()',
    'public.payments_split_is_fixed()'
  ] loop
    if has_function_privilege('anon', fn, 'EXECUTE')
       or has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'CHECK 8 FAILED: a client role can EXECUTE %', fn;
    end if;
  end loop;
  raise notice 'CHECK 8 passed: the payments trigger functions are closed to clients';
end $$;
