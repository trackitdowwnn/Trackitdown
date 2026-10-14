-- =============================================================================
-- WHAT:  Verification for the Payouts screen's dates and car
--        (20261014130000_a_payout_has_its_dates.sql). NOT a migration.
-- WHY:   The redesigned tracker dates every step behind the spotter and names
--        the car the reward was for. A wrong date is worse than none, and the
--        car must never bring its plate with it.
--
-- CHECKS: 1 my_pending_credit returns credited_at, make and colour · 2 ⚠️ and
-- never a plate (its shape) · 3 payouts_enabled_at: unset while not payable,
-- stamped when payouts switch on · 4 ⚠️ an already-payable account keeps its
-- FIRST stamp through later writes (the upsert path) · 5 switched off and on
-- again: stamped anew.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        now() is the transaction's start, so CHECK 4 moves the first stamp
--        back three days to make "a new stamp" observable in CHECK 5.
--        Owner 11111111-…, spotter 44444444-…, payee 55555555-… (seed profiles).
-- LINKS: supabase/migrations/20261014130000_a_payout_has_its_dates.sql.
-- =============================================================================

begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, make, colour, recovered_at)
values ('ee000000-0000-0000-0000-000000000071', '11111111-1111-1111-1111-111111111111',
        'recovery_claimed', 20000, 'PD71 CAR', 'BMW', 'Blue', now());
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence, captured_at)
values ('ee000071-0000-0000-0000-00000000000a', 'ee000000-0000-0000-0000-000000000071',
        'pi_payout_dates', 'held', 20000, now() - interval '2 days');
insert into public.sightings (post_id, spotter_id, status, area_label, location_unavailable,
                              credited_at, created_at)
values ('ee000000-0000-0000-0000-000000000071', '44444444-4444-4444-4444-444444444444',
        'credited', 'Camden', true, now() - interval '1 day', now() + interval '1 minute');

do $$
declare
  v_row record;
  v_shape text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);

  -- CHECK 1 — the credit's moment and the car.
  select * into v_row from public.my_pending_credit();
  if v_row.post_id is distinct from 'ee000000-0000-0000-0000-000000000071'::uuid then
    raise exception 'CHECK 1 FAILED: expected the test post, got %', v_row.post_id;
  end if;
  if v_row.credited_at is null
     or v_row.credited_at > now() - interval '23 hours'
     or v_row.credited_at < now() - interval '25 hours' then
    raise exception 'CHECK 1 FAILED: credited_at % is not the credit''s moment (a day ago)', v_row.credited_at;
  end if;
  if v_row.make is distinct from 'BMW' or v_row.colour is distinct from 'Blue' then
    raise exception 'CHECK 1 FAILED: the car came back as % %', v_row.colour, v_row.make;
  end if;

  -- CHECK 2 — ⚠️ never the plate.
  select pg_get_function_result('public.my_pending_credit()'::regprocedure) into v_shape;
  if v_shape ilike '%plate%' then
    raise exception 'CHECK 2 FAILED: my_pending_credit returns a plate: %', v_shape;
  end if;

  raise notice 'payout dates CHECKS 1-2 passed';
end $$;

delete from public.stripe_connected_accounts where profile_id = '55555555-5555-5555-5555-555555555555';

do $$
declare
  v_first timestamptz;
  v_now   timestamptz;
begin
  -- CHECK 3 — unset while not payable, stamped when payouts switch on.
  perform public.upsert_connected_account(
    '55555555-5555-5555-5555-555555555555', 'acct_payout_dates', true, false);
  select payouts_enabled_at into v_now
    from public.stripe_connected_accounts where stripe_account_id = 'acct_payout_dates';
  if v_now is not null then
    raise exception 'CHECK 3 FAILED: an account not yet payable has payouts_enabled_at %', v_now;
  end if;

  perform public.upsert_connected_account(
    '55555555-5555-5555-5555-555555555555', 'acct_payout_dates', true, true);
  select payouts_enabled_at into v_first
    from public.stripe_connected_accounts where stripe_account_id = 'acct_payout_dates';
  if v_first is null then
    raise exception 'CHECK 3 FAILED: payouts switched on and nothing was stamped';
  end if;

  -- CHECK 4 — ⚠️ a later write to an already-payable account keeps the first
  -- stamp (the upsert's conflict path sees the real old row).
  update public.stripe_connected_accounts
     set payouts_enabled_at = payouts_enabled_at - interval '3 days'
   where stripe_account_id = 'acct_payout_dates';
  select payouts_enabled_at into v_first
    from public.stripe_connected_accounts where stripe_account_id = 'acct_payout_dates';
  perform public.upsert_connected_account(
    '55555555-5555-5555-5555-555555555555', 'acct_payout_dates', true, true);
  select payouts_enabled_at into v_now
    from public.stripe_connected_accounts where stripe_account_id = 'acct_payout_dates';
  if v_now is distinct from v_first then
    raise exception 'CHECK 4 FAILED: a repeat "payable" moved the stamp from % to %', v_first, v_now;
  end if;

  -- CHECK 5 — off, then on again: a new stamp.
  perform public.upsert_connected_account(
    '55555555-5555-5555-5555-555555555555', 'acct_payout_dates', true, false);
  perform public.upsert_connected_account(
    '55555555-5555-5555-5555-555555555555', 'acct_payout_dates', true, true);
  select payouts_enabled_at into v_now
    from public.stripe_connected_accounts where stripe_account_id = 'acct_payout_dates';
  if v_now is null or v_now <= v_first then
    raise exception 'CHECK 5 FAILED: switched on again but the stamp is % (first was %)', v_now, v_first;
  end if;

  raise notice 'payout dates CHECKS 3-5 passed';
end $$;

rollback;
