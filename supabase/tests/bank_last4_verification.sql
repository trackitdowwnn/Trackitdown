-- =============================================================================
-- WHAT:  Verification for "Paid into account ending 5678"
--        (20261015100000_a_payout_names_its_bank.sql). NOT a migration.
-- WHY:   A label about someone's bank must be exactly what Stripe reported,
--        their own, and never more than four digits.
--
-- CHECKS: 1 record_bank_last4 records four digits · 2 ⚠️ anything else is
-- ignored, never stored (a full number, letters, three digits) · 3 ⚠️ the
-- column refuses more than four digits even from a direct write · 4 the
-- owner reads their own; another user reads nothing · 5 ⚠️ the writer is
-- service-role only.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        Payee 55555555-… and spotter 44444444-… are seed profiles.
-- LINKS: supabase/migrations/20261015100000_a_payout_names_its_bank.sql.
-- =============================================================================

begin;
delete from public.stripe_connected_accounts where profile_id = '55555555-5555-5555-5555-555555555555';
select public.upsert_connected_account(
  '55555555-5555-5555-5555-555555555555', 'acct_bank_last4', true, true);

do $$
declare
  v_last4 text;
begin
  -- CHECK 1 — four digits are recorded.
  perform public.record_bank_last4('acct_bank_last4', '5678');
  select bank_last4 into v_last4
    from public.stripe_connected_accounts where stripe_account_id = 'acct_bank_last4';
  if v_last4 is distinct from '5678' then
    raise exception 'CHECK 1 FAILED: expected 5678, got %', v_last4;
  end if;

  -- CHECK 2 — ⚠️ anything else is ignored, and the last good value stays.
  perform public.record_bank_last4('acct_bank_last4', '00012345');
  perform public.record_bank_last4('acct_bank_last4', 'abcd');
  perform public.record_bank_last4('acct_bank_last4', '123');
  perform public.record_bank_last4('acct_bank_last4', null);
  select bank_last4 into v_last4
    from public.stripe_connected_accounts where stripe_account_id = 'acct_bank_last4';
  if v_last4 is distinct from '5678' then
    raise exception 'CHECK 2 FAILED: a malformed value replaced 5678 with %', v_last4;
  end if;

  -- CHECK 2b — the first value is not a change; a DIFFERENT bank is one, and
  -- stamps bank_replaced_at, so no older payout is named for the new bank.
  if (select bank_replaced_at from public.stripe_connected_accounts
       where stripe_account_id = 'acct_bank_last4') is not null then
    raise exception 'CHECK 2b FAILED: recording the first bank stamped a replacement';
  end if;
  perform public.record_bank_last4('acct_bank_last4', '5678');
  if (select bank_replaced_at from public.stripe_connected_accounts
       where stripe_account_id = 'acct_bank_last4') is not null then
    raise exception 'CHECK 2b FAILED: the SAME bank again stamped a replacement';
  end if;
  perform public.record_bank_last4('acct_bank_last4', '4321');
  if (select bank_replaced_at from public.stripe_connected_accounts
       where stripe_account_id = 'acct_bank_last4') is null then
    raise exception 'CHECK 2b FAILED: a different bank did not stamp bank_replaced_at';
  end if;
  perform public.record_bank_last4('acct_bank_last4', '5678');

  -- CHECK 3 — ⚠️ the column itself refuses a full account number.
  begin
    update public.stripe_connected_accounts
       set bank_last4 = '00012345'
     where stripe_account_id = 'acct_bank_last4';
    raise exception 'CHECK 3 FAILED: the column accepted a full account number';
  exception when check_violation then
    null;
  end;

  raise notice 'bank last4 CHECKS 1-3 passed';
end $$;

-- CHECK 4 — the owner reads their own; another user reads nothing.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
do $$
declare
  v_last4 text;
begin
  select bank_last4 into v_last4 from public.stripe_connected_accounts
   where stripe_account_id = 'acct_bank_last4';
  if v_last4 is distinct from '5678' then
    raise exception 'CHECK 4 FAILED: the owner read % for their own bank', v_last4;
  end if;
end $$;

select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.stripe_connected_accounts
              where stripe_account_id = 'acct_bank_last4') then
    raise exception 'CHECK 4 FAILED: another user can read this payee''s bank';
  end if;

  -- CHECK 5 — ⚠️ an ordinary user cannot write it.
  begin
    perform public.record_bank_last4('acct_bank_last4', '9999');
    raise exception 'CHECK 5 FAILED: an authenticated user could call record_bank_last4';
  exception when insufficient_privilege then
    null;
  end;

  raise notice 'bank last4 CHECKS 4-5 passed';
end $$;

reset role;
rollback;
