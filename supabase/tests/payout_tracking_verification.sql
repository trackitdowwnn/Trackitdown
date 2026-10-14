-- =============================================================================
-- WHAT:  Verification for the bank leg of a spotter's payout
--        (20261014110000_a_payout_reaches_the_bank.sql). NOT a migration.
-- WHY:   Stripe delivers payout.* events out of order and retries them for
--        days. If an older payout could overwrite a newer one, or a payout
--        could move backwards, the tracker would say "due Friday" about money
--        already refused — or ask for new bank details after it landed. And
--        the failure push must go once per payout, not once per delivery.
--
-- CHECKS: 1 unknown account → nothing · 2 the first payout is recorded ·
-- 3 ⚠️ the same payout only moves forward (a late "pending" is ignored) ·
-- 4 ⚠️ paid can still fail, with its code · 5 ⚠️ one failure push per payout ·
-- 6 an OLDER payout never replaces the record · 7 a newer one does, and the
-- old failure's claim is spent · 8 the bank-replaced stamp · 9 grants, the new
-- kind, and that it cannot be muted · 10 ⚠️ the owner reads their own payout
-- columns; no one else does.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        Spotter 55555555-… (seed profile), owner of a fresh payee row.
-- LINKS: supabase/migrations/20261014110000_a_payout_reaches_the_bank.sql.
-- =============================================================================

begin;
delete from public.stripe_connected_accounts where profile_id = '55555555-5555-5555-5555-555555555555';
insert into public.stripe_connected_accounts
  (profile_id, stripe_account_id, onboarding_complete, payouts_enabled)
values ('55555555-5555-5555-5555-555555555555', 'acct_payout_track', true, true);

do $$
declare
  v_res jsonb;
  v_row public.stripe_connected_accounts%rowtype;
  v_t0  constant timestamptz := now() - interval '2 days';
begin
  -- CHECK 1 — an account we never recorded: nothing written.
  v_res := public.record_payout_event('acct_stranger', 'po_x', 'paid', 100, current_date, now(), null);
  if (v_res ->> 'applied')::boolean then
    raise exception 'CHECK 1 FAILED: a payout for an unknown account was applied';
  end if;

  -- CHECK 2 — the first payout.
  v_res := public.record_payout_event('acct_payout_track', 'po_1', 'pending', 19000,
                                      current_date + 2, v_t0, null);
  select * into v_row from public.stripe_connected_accounts where stripe_account_id = 'acct_payout_track';
  if not (v_res ->> 'applied')::boolean or v_row.last_payout_id <> 'po_1'
     or v_row.last_payout_status <> 'pending' or v_row.last_payout_amount_pence <> 19000
     or v_row.last_payout_arrival_date <> current_date + 2 then
    raise exception 'CHECK 2 FAILED: the first payout was not recorded as sent (%)', v_res;
  end if;
  if (v_res ->> 'profile_id')::uuid <> '55555555-5555-5555-5555-555555555555' then
    raise exception 'CHECK 2 FAILED: the result names the wrong spotter';
  end if;

  -- CHECK 3 — ⚠️ forward only: in_transit lands, a late "pending" does not.
  perform public.record_payout_event('acct_payout_track', 'po_1', 'in_transit', 19000,
                                     current_date + 2, v_t0, null);
  v_res := public.record_payout_event('acct_payout_track', 'po_1', 'pending', 19000,
                                      current_date + 2, v_t0, null);
  select * into v_row from public.stripe_connected_accounts where stripe_account_id = 'acct_payout_track';
  if (v_res ->> 'applied')::boolean or v_row.last_payout_status <> 'in_transit' then
    raise exception 'CHECK 3 FAILED: a late "pending" moved an in-transit payout backwards (%)',
      v_row.last_payout_status;
  end if;

  -- CHECK 4 — ⚠️ paid, then the bank bounces it: failed, with its code.
  perform public.record_payout_event('acct_payout_track', 'po_1', 'paid', 19000,
                                     current_date + 2, v_t0, null);
  v_res := public.record_payout_event('acct_payout_track', 'po_1', 'failed', 19000,
                                      current_date + 2, v_t0, 'account_closed');
  select * into v_row from public.stripe_connected_accounts where stripe_account_id = 'acct_payout_track';
  if not (v_res ->> 'failed')::boolean or v_row.last_payout_status <> 'failed'
     or v_row.last_payout_failure_code <> 'account_closed' then
    raise exception 'CHECK 4 FAILED: a paid payout that failed was not recorded as failed (%)', v_res;
  end if;
  -- …and a late "paid" for it never un-fails it.
  perform public.record_payout_event('acct_payout_track', 'po_1', 'paid', 19000,
                                     current_date + 2, v_t0, null);
  select * into v_row from public.stripe_connected_accounts where stripe_account_id = 'acct_payout_track';
  if v_row.last_payout_status <> 'failed' then
    raise exception 'CHECK 4 FAILED: a late "paid" turned a failed payout back into paid';
  end if;

  -- CHECK 5 — ⚠️ one push per failed payout.
  v_res := public.claim_payout_failed_notification('acct_payout_track', 'po_1');
  if not (v_res ->> 'claimed')::boolean
     or (v_res ->> 'user_id')::uuid <> '55555555-5555-5555-5555-555555555555'
     or v_res ->> 'title' is null or v_res ->> 'body' is null then
    raise exception 'CHECK 5 FAILED: the first claim did not win with copy (%)', v_res;
  end if;
  v_res := public.claim_payout_failed_notification('acct_payout_track', 'po_1');
  if (v_res ->> 'claimed')::boolean then
    raise exception 'CHECK 5 FAILED: a second claim for the same failed payout won — two pushes';
  end if;

  -- CHECK 6 — an OLDER payout (a late delivery) never replaces the record.
  v_res := public.record_payout_event('acct_payout_track', 'po_0', 'paid', 5000,
                                      current_date - 5, v_t0 - interval '5 days', null);
  select * into v_row from public.stripe_connected_accounts where stripe_account_id = 'acct_payout_track';
  if (v_res ->> 'applied')::boolean or v_row.last_payout_id <> 'po_1' then
    raise exception 'CHECK 6 FAILED: an older payout replaced the newer record';
  end if;

  -- CHECK 7 — a newer payout (the resend) replaces it, clearing the failure;
  -- the old failure's claim cannot be spent again.
  v_res := public.record_payout_event('acct_payout_track', 'po_2', 'in_transit', 19000,
                                      current_date + 1, now(), null);
  select * into v_row from public.stripe_connected_accounts where stripe_account_id = 'acct_payout_track';
  if not (v_res ->> 'applied')::boolean or v_row.last_payout_id <> 'po_2'
     or v_row.last_payout_status <> 'in_transit' or v_row.last_payout_failure_code is not null then
    raise exception 'CHECK 7 FAILED: the newer payout did not replace the failed one cleanly';
  end if;
  v_res := public.claim_payout_failed_notification('acct_payout_track', 'po_1');
  if (v_res ->> 'claimed')::boolean then
    raise exception 'CHECK 7 FAILED: a claim for a payout no longer recorded won';
  end if;

  -- CHECK 8 — the bank-replaced stamp.
  perform public.record_bank_replaced('acct_payout_track');
  select * into v_row from public.stripe_connected_accounts where stripe_account_id = 'acct_payout_track';
  if v_row.bank_replaced_at is null then
    raise exception 'CHECK 8 FAILED: bank_replaced_at was not stamped';
  end if;

  raise notice 'payout tracking CHECKS 1-8 passed';
end $$;

-- CHECK 9 — grants, the new kind, and that it cannot be muted.
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.record_payout_event(text, text, text, integer, date, timestamptz, text)',
    'public.record_bank_replaced(text)',
    'public.claim_payout_failed_notification(text, text)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'CHECK 9 FAILED: a client role can execute %', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'CHECK 9 FAILED: service_role cannot execute %', v_fn;
    end if;
  end loop;

  insert into public.notifications (user_id, kind, title, body, payload)
  values ('55555555-5555-5555-5555-555555555555', 'payout_failed', 't', 'b', '{}'::jsonb);
  if public.notification_category('payout_failed') is not null then
    raise exception 'CHECK 9 FAILED: payout_failed is mutable — money waiting on new details could be silenced';
  end if;
  raise notice 'payout tracking CHECK 9 passed';
end $$;

-- CHECK 10 — ⚠️ the owner reads their own payout columns; no one else does.
do $$
declare
  v_status text;
  v_count  integer;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
  set local role authenticated;
  select last_payout_status into v_status
    from public.stripe_connected_accounts
   where profile_id = '55555555-5555-5555-5555-555555555555';
  reset role;
  if v_status is distinct from 'in_transit' then
    raise exception 'CHECK 10 FAILED: the owner could not read their own payout status (got %)', v_status;
  end if;

  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_count
    from public.stripe_connected_accounts
   where stripe_account_id = 'acct_payout_track';
  reset role;
  if v_count <> 0 then
    raise exception 'CHECK 10 FAILED: another user read someone else''s payout record';
  end if;
  raise notice 'payout tracking CHECK 10 passed';
end $$;

rollback;
