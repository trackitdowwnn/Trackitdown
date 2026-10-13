-- =============================================================================
-- WHAT:  Tier 1 verification for upsert_connected_account's "details stay
--        submitted" rule (20261013130000). NOT a migration.
-- WHY:   Two writers copy Stripe's v1 details_submitted, which for a v2
--        payout account need not be true; without this rule they would flip a
--        spotter who had sent everything back to "a few more details needed".
--        And payouts_enabled must still move BOTH ways — Stripe can switch
--        payouts off, and the app must then say so.
--
-- CHECKS: 1 a first write records what it is given · 2 ⚠️ a later false
-- never undoes a recorded submission · 3 payouts_enabled still moves both
-- ways · 4 clients can't call it.
-- LINKS: supabase/migrations/20261013130000_details_submitted_stays_submitted.sql.
--
-- SELF-ASSERTING: every check RAISES on failure (ON_ERROR_STOP=1). Everything
-- runs inside begin/rollback.
-- =============================================================================

begin;
do $$
declare
  v_profile uuid := '44444444-4444-4444-4444-444444444444';
  v_row     record;
begin
  -- CHECK 1 — first write: as given.
  perform public.upsert_connected_account(v_profile, 'acct_sync_test', true, false);
  select onboarding_complete, payouts_enabled into v_row
    from public.stripe_connected_accounts where profile_id = v_profile;
  if v_row.onboarding_complete is not true or v_row.payouts_enabled is not false then
    raise exception 'CHECK 1 FAILED: first write recorded % / %', v_row.onboarding_complete, v_row.payouts_enabled;
  end if;

  -- CHECK 2 — ⚠️ a webhook copying v1's false must not undo it.
  perform public.upsert_connected_account(v_profile, 'acct_sync_test', false, true);
  select onboarding_complete, payouts_enabled into v_row
    from public.stripe_connected_accounts where profile_id = v_profile;
  if v_row.onboarding_complete is not true then
    raise exception 'CHECK 2 FAILED: a later false undid a recorded submission — the spotter reads "a few more details needed" after sending everything';
  end if;

  -- CHECK 3 — payouts_enabled moves both ways: on (above), then off.
  if v_row.payouts_enabled is not true then
    raise exception 'CHECK 3 FAILED: payouts_enabled did not turn on';
  end if;
  perform public.upsert_connected_account(v_profile, 'acct_sync_test', true, false);
  select payouts_enabled into v_row
    from public.stripe_connected_accounts where profile_id = v_profile;
  if v_row.payouts_enabled is not false then
    raise exception 'CHECK 3 FAILED: payouts_enabled could not turn back off — Stripe switching payouts off must show';
  end if;

  -- And a never-submitted row can still become submitted.
  perform public.upsert_connected_account('55555555-5555-5555-5555-555555555555', 'acct_sync_test_2', false, false);
  perform public.upsert_connected_account('55555555-5555-5555-5555-555555555555', 'acct_sync_test_2', true, false);
  select onboarding_complete into v_row
    from public.stripe_connected_accounts where profile_id = '55555555-5555-5555-5555-555555555555';
  if v_row.onboarding_complete is not true then
    raise exception 'CHECK 2 FAILED: an unsubmitted row could not become submitted';
  end if;

  raise notice 'payout account sync CHECKS 1-3 passed';
end $$;

-- CHECK 4 — clients can't call it.
do $$
begin
  if has_function_privilege('authenticated', 'public.upsert_connected_account(uuid, text, boolean, boolean)', 'execute')
     or has_function_privilege('anon', 'public.upsert_connected_account(uuid, text, boolean, boolean)', 'execute') then
    raise exception 'CHECK 4 FAILED: a client can call upsert_connected_account';
  end if;
  raise notice 'payout account sync CHECK 4 passed';
end $$;

rollback;
