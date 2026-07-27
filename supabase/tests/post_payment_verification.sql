-- =============================================================================
-- Post-payment (bounty escrow CHARGE slice) verification (NOT a migration —
-- do not place in migrations/).
--
-- SELF-ASSERTING: every check is a DO block (or a seeded begin…rollback block)
-- that RAISES EXCEPTION on failure, so the whole file aborts non-zero the moment
-- a MONEY-STATE safety property is violated. These are Tier 1 properties
-- (docs/TESTING.md): the charge amount is server-authoritative, money-state
-- transitions never regress, and clients can never execute the money functions.
-- This file is meant to GATE CI, not to be eyeballed. On success each block
-- emits a NOTICE.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset            # applies migrations + seed
--     psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/post_payment_verification.sql
--
-- (ON_ERROR_STOP=1 makes psql exit non-zero on the first uncaught RAISE.)
--
-- Fixtures: a fresh DRAFT post is seeded inside each begin…rollback block, owned
-- by seed profile 11111111-… (Alex Mercer), with a KNOWN bounty of £250 (25000
-- pence). The seed rows never persist (every mutation block is rolled back).
-- Functions under test (20260726100000_post_payment.sql):
--   record_post_payment_intent, mark_post_payment_held, mark_post_payment_failed,
--   claim_stripe_event.
-- NOTE: mark_post_payment_held is REDEFINED by 20260730100000_live_on_payment.sql
--   to advance the post draft -> ACTIVE (was draft -> pending_verification); the
--   CHECK 4/8/9/11 assertions below assert that current (active) behaviour.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — record_post_payment_intent on a draft inserts ONE requires_payment
-- ledger row; a SECOND call with a DIFFERENT intent id for the same post does
-- NOT create a second live row (idempotent — the retry reuses the first).
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('dddddddd-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'draft', 25000, 'DR11 PAY');

do $$
declare
  v_rows   integer;
  v_status public.payment_status;
  v_intent text;
begin
  perform public.record_post_payment_intent(
    'dddddddd-0000-0000-0000-000000000001', 'pi_check1_first', 25000);
  -- second call, different intent id, same post -> must be a no-op
  perform public.record_post_payment_intent(
    'dddddddd-0000-0000-0000-000000000001', 'pi_check1_second', 25000);

  select count(*) into v_rows
  from public.payments
  where post_id = 'dddddddd-0000-0000-0000-000000000001';

  select status, stripe_payment_intent_id into v_status, v_intent
  from public.payments
  where post_id = 'dddddddd-0000-0000-0000-000000000001';

  if v_rows <> 1 then
    raise exception 'CHECK 1 FAILED: expected exactly 1 payments row after two record calls, got %', v_rows;
  end if;
  if v_status <> 'requires_payment' then
    raise exception 'CHECK 1 FAILED: ledger row status is %, expected requires_payment', v_status;
  end if;
  if v_intent <> 'pi_check1_first' then
    raise exception 'CHECK 1 FAILED: the retained ledger row is %, expected the first intent (pi_check1_first)', v_intent;
  end if;
  raise notice 'CHECK 1 passed: record_post_payment_intent inserts one requires_payment row and is idempotent';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 — record_post_payment_intent with a WRONG p_amount_pence raises
-- BOUNTY_MISMATCH (the charge amount is server-authoritative, never trusted from
-- the caller), and writes NO ledger row.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('dddddddd-0000-0000-0000-000000000002',
        '11111111-1111-1111-1111-111111111111', 'draft', 25000, 'DR22 PAY');

do $$
declare
  v_raised boolean := false;
  v_rows   integer;
begin
  begin
    perform public.record_post_payment_intent(
      'dddddddd-0000-0000-0000-000000000002', 'pi_check2', 9999);  -- wrong amount
  exception when others then
    if sqlerrm not like '%BOUNTY_MISMATCH%' then
      raise exception 'CHECK 2 FAILED: expected BOUNTY_MISMATCH, got a different error: %', sqlerrm;
    end if;
    v_raised := true;
  end;

  if not v_raised then
    raise exception 'CHECK 2 FAILED: a mismatched amount did not raise BOUNTY_MISMATCH';
  end if;

  select count(*) into v_rows
  from public.payments
  where post_id = 'dddddddd-0000-0000-0000-000000000002';
  if v_rows <> 0 then
    raise exception 'CHECK 2 FAILED: a mismatched amount still wrote % ledger row(s)', v_rows;
  end if;
  raise notice 'CHECK 2 passed: wrong amount raises BOUNTY_MISMATCH and writes no ledger row';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — record_post_payment_intent on a NON-draft post raises POST_NOT_DRAFT.
-- Uses an existing ACTIVE seed post (a1a1…0001, bounty 25000) — no seeding needed.
-- Passing the CORRECT amount proves POST_NOT_DRAFT fires on state, not amount.
-- -----------------------------------------------------------------------------
do $$
declare
  v_raised boolean := false;
begin
  begin
    perform public.record_post_payment_intent(
      'a1a1a1a1-0000-0000-0000-000000000001', 'pi_check3', 25000);
  exception when others then
    if sqlerrm not like '%POST_NOT_DRAFT%' then
      raise exception 'CHECK 3 FAILED: expected POST_NOT_DRAFT, got a different error: %', sqlerrm;
    end if;
    v_raised := true;
  end;

  if not v_raised then
    raise exception 'CHECK 3 FAILED: recording an intent on an active post did not raise POST_NOT_DRAFT';
  end if;
  raise notice 'CHECK 3 passed: non-draft post raises POST_NOT_DRAFT';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 4 — mark_post_payment_held sets the payment 'held' AND flips the post
-- draft -> active; a SECOND call is a no-op (post stays
-- active, payment stays held — never regressed).
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('dddddddd-0000-0000-0000-000000000004',
        '11111111-1111-1111-1111-111111111111', 'draft', 25000, 'DR44 PAY');

do $$
declare
  v_pay_status  public.payment_status;
  v_post_status public.post_status;
begin
  perform public.record_post_payment_intent(
    'dddddddd-0000-0000-0000-000000000004', 'pi_check4', 25000);

  -- escrow success
  perform public.mark_post_payment_held('pi_check4');

  select status into v_pay_status  from public.payments
    where stripe_payment_intent_id = 'pi_check4';
  select status into v_post_status from public.posts
    where id = 'dddddddd-0000-0000-0000-000000000004';

  if v_pay_status <> 'held' then
    raise exception 'CHECK 4 FAILED: payment status is % after held, expected held', v_pay_status;
  end if;
  if v_post_status <> 'active' then
    raise exception 'CHECK 4 FAILED: post status is % after held, expected active', v_post_status;
  end if;

  -- duplicate delivery: must be a no-op, never regress
  perform public.mark_post_payment_held('pi_check4');

  select status into v_pay_status  from public.payments
    where stripe_payment_intent_id = 'pi_check4';
  select status into v_post_status from public.posts
    where id = 'dddddddd-0000-0000-0000-000000000004';

  if v_pay_status <> 'held' then
    raise exception 'CHECK 4 FAILED: second held call regressed payment to %', v_pay_status;
  end if;
  if v_post_status <> 'active' then
    raise exception 'CHECK 4 FAILED: second held call regressed post to %', v_post_status;
  end if;
  raise notice 'CHECK 4 passed: held captures escrow + advances draft -> active; second call is a no-op';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 — mark_post_payment_failed sets the payment 'failed' and LEAVES the
-- post as 'draft' (owner may retry the charge).
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('dddddddd-0000-0000-0000-000000000005',
        '11111111-1111-1111-1111-111111111111', 'draft', 25000, 'DR55 PAY');

do $$
declare
  v_pay_status  public.payment_status;
  v_post_status public.post_status;
begin
  perform public.record_post_payment_intent(
    'dddddddd-0000-0000-0000-000000000005', 'pi_check5', 25000);

  perform public.mark_post_payment_failed('pi_check5');

  select status into v_pay_status  from public.payments
    where stripe_payment_intent_id = 'pi_check5';
  select status into v_post_status from public.posts
    where id = 'dddddddd-0000-0000-0000-000000000005';

  if v_pay_status <> 'failed' then
    raise exception 'CHECK 5 FAILED: payment status is % after failed, expected failed', v_pay_status;
  end if;
  if v_post_status <> 'draft' then
    raise exception 'CHECK 5 FAILED: post status is % after a failed charge, expected draft (unchanged)', v_post_status;
  end if;
  raise notice 'CHECK 5 passed: failed marks the payment failed and leaves the post draft';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 6 — claim_stripe_event returns TRUE the first time (newly claimed) and
-- FALSE the second time (duplicate delivery). Rolled back so nothing persists.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_first  boolean;
  v_second boolean;
begin
  v_first  := public.claim_stripe_event('evt_check6');
  v_second := public.claim_stripe_event('evt_check6');

  if v_first is not true then
    raise exception 'CHECK 6 FAILED: first claim returned %, expected TRUE', v_first;
  end if;
  if v_second is not false then
    raise exception 'CHECK 6 FAILED: second claim returned %, expected FALSE (duplicate)', v_second;
  end if;
  raise notice 'CHECK 6 passed: claim_stripe_event dedups (TRUE then FALSE)';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 7 — a non-service role can NOT EXECUTE the money functions. Asserts the
-- grant directly: authenticated (and anon) must have NO EXECUTE on any of the
-- four functions; service_role MUST. Money-state transitions are service-role
-- only (SECURITY_AND_TRUST §4/§6).
-- -----------------------------------------------------------------------------
do $$
declare
  fns text[] := array[
    'public.record_post_payment_intent(uuid, text, integer)',
    'public.mark_post_payment_held(text)',
    'public.mark_post_payment_failed(text)',
    'public.claim_stripe_event(text)'
  ];
  fn text;
begin
  foreach fn in array fns loop
    if has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'CHECK 7 FAILED: authenticated can EXECUTE % (must be service-role only)', fn;
    end if;
    if has_function_privilege('anon', fn, 'EXECUTE') then
      raise exception 'CHECK 7 FAILED: anon can EXECUTE % (must be service-role only)', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'CHECK 7 FAILED: service_role cannot EXECUTE % (Edge Functions need it)', fn;
    end if;
  end loop;
  raise notice 'CHECK 7 passed: money functions are service-role only (anon/authenticated denied)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 8 — decline-then-succeed RECOVERY on the reused PaymentIntent: a first
-- attempt fails (payment_failed) then a later attempt on the SAME intent succeeds
-- (payment_intent.succeeded). mark_post_payment_held must lift the row from
-- 'failed' -> 'held' AND advance the still-draft post -> active —
-- NOT skip it and leave the ledger 'failed' while the post advances (that would
-- be captured escrow with a disagreeing ledger). MONEY: never-regress must not
-- mean never-recover.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('dddddddd-0000-0000-0000-000000000008',
        '11111111-1111-1111-1111-111111111111', 'draft', 25000, 'DR88 PAY');

do $$
declare
  v_pay_status  public.payment_status;
  v_post_status public.post_status;
begin
  perform public.record_post_payment_intent(
    'dddddddd-0000-0000-0000-000000000008', 'pi_check8', 25000);

  -- first attempt declines on the reused intent
  perform public.mark_post_payment_failed('pi_check8');
  -- ... then a later attempt on the SAME intent succeeds
  perform public.mark_post_payment_held('pi_check8');

  select status into v_pay_status  from public.payments
    where stripe_payment_intent_id = 'pi_check8';
  select status into v_post_status from public.posts
    where id = 'dddddddd-0000-0000-0000-000000000008';

  if v_pay_status <> 'held' then
    raise exception 'CHECK 8 FAILED: failed->succeeded left the payment %, expected held (recovery)', v_pay_status;
  end if;
  if v_post_status <> 'active' then
    raise exception 'CHECK 8 FAILED: failed->succeeded left the post %, expected active', v_post_status;
  end if;
  raise notice 'CHECK 8 passed: decline-then-succeed on a reused intent recovers failed -> held + advances the post';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 9 — mark_post_payment_failed on an ALREADY-HELD row is a no-op: a late or
-- duplicate payment_failed event can NEVER wipe out captured escrow. MONEY:
-- never-regress (the guard is `and status = 'requires_payment'`).
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('dddddddd-0000-0000-0000-000000000009',
        '11111111-1111-1111-1111-111111111111', 'draft', 25000, 'DR99 PAY');

do $$
declare
  v_pay_status  public.payment_status;
  v_post_status public.post_status;
begin
  perform public.record_post_payment_intent(
    'dddddddd-0000-0000-0000-000000000009', 'pi_check9', 25000);
  perform public.mark_post_payment_held('pi_check9');   -- escrow captured

  -- a stray/late failure event for the same intent must NOT regress it
  perform public.mark_post_payment_failed('pi_check9');

  select status into v_pay_status  from public.payments
    where stripe_payment_intent_id = 'pi_check9';
  select status into v_post_status from public.posts
    where id = 'dddddddd-0000-0000-0000-000000000009';

  if v_pay_status <> 'held' then
    raise exception 'CHECK 9 FAILED: a late failure regressed captured escrow to %, expected held', v_pay_status;
  end if;
  if v_post_status <> 'active' then
    raise exception 'CHECK 9 FAILED: a late failure regressed the post to %, expected active', v_post_status;
  end if;
  raise notice 'CHECK 9 passed: a late payment_failed cannot wipe out captured (held) escrow';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 10 — the webhook dedup table stripe_webhook_events is service-role only:
-- anon/authenticated have NO SELECT/INSERT (RLS enabled, no policies, no grant);
-- service_role does. Mirrors the payments ledger (SECURITY_AND_TRUST §4/§6).
-- -----------------------------------------------------------------------------
do $$
declare
  tbl text := 'public.stripe_webhook_events';
  role text;
begin
  foreach role in array array['anon', 'authenticated'] loop
    if has_table_privilege(role, tbl, 'SELECT') then
      raise exception 'CHECK 10 FAILED: % can SELECT % (must be service-role only)', role, tbl;
    end if;
    if has_table_privilege(role, tbl, 'INSERT') then
      raise exception 'CHECK 10 FAILED: % can INSERT % (must be service-role only)', role, tbl;
    end if;
  end loop;
  if not has_table_privilege('service_role', tbl, 'INSERT') then
    raise exception 'CHECK 10 FAILED: service_role cannot INSERT % (the webhook needs it)', tbl;
  end if;
  raise notice 'CHECK 10 passed: stripe_webhook_events is service-role only (anon/authenticated denied)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 11 — EDIT-SAFE recording: a draft with an open requires_payment intent
-- whose bounty is then edited must SUPERSEDE the stale intent's ledger row and
-- record the new (correctly-priced) intent — never drop it (which would strand a
-- captured charge with no ledger row and the post stuck in draft). Then the new
-- intent's success advances the post. MONEY: an edited charge must reconcile.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('dddddddd-0000-0000-0000-000000000011',
        '11111111-1111-1111-1111-111111111111', 'draft', 25000, 'DR11 EDT');

do $$
declare
  v_old_status  public.payment_status;
  v_new_status  public.payment_status;
  v_rows        integer;
  v_post_status public.post_status;
begin
  -- first attempt at £250
  perform public.record_post_payment_intent(
    'dddddddd-0000-0000-0000-000000000011', 'pi_check11_old', 25000);

  -- owner edits the bounty to £300 (RLS permits a draft-bounty edit)
  update public.posts set bounty_amount_pence = 30000
    where id = 'dddddddd-0000-0000-0000-000000000011';

  -- new attempt at £300 on a fresh intent
  perform public.record_post_payment_intent(
    'dddddddd-0000-0000-0000-000000000011', 'pi_check11_new', 30000);

  select status into v_old_status from public.payments
    where stripe_payment_intent_id = 'pi_check11_old';
  select status into v_new_status from public.payments
    where stripe_payment_intent_id = 'pi_check11_new';
  select count(*) into v_rows from public.payments
    where post_id = 'dddddddd-0000-0000-0000-000000000011';

  if v_old_status <> 'failed' then
    raise exception 'CHECK 11 FAILED: stale intent left %, expected failed (superseded)', v_old_status;
  end if;
  if v_new_status <> 'requires_payment' then
    raise exception 'CHECK 11 FAILED: new intent is %, expected requires_payment (recorded)', v_new_status;
  end if;
  if v_rows <> 2 then
    raise exception 'CHECK 11 FAILED: expected 2 ledger rows (superseded + new), got %', v_rows;
  end if;

  -- the new intent succeeds → post advances
  perform public.mark_post_payment_held('pi_check11_new');
  select status into v_new_status  from public.payments
    where stripe_payment_intent_id = 'pi_check11_new';
  select status into v_post_status from public.posts
    where id = 'dddddddd-0000-0000-0000-000000000011';
  if v_new_status <> 'held' then
    raise exception 'CHECK 11 FAILED: new intent did not advance to held (got %)', v_new_status;
  end if;
  if v_post_status <> 'active' then
    raise exception 'CHECK 11 FAILED: post did not advance after the edited charge (got %)', v_post_status;
  end if;
  raise notice 'CHECK 11 passed: an edited-bounty re-charge supersedes the stale row, records + advances the new one';
end $$;
rollback;
