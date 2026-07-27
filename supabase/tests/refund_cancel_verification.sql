-- =============================================================================
-- Bounty-escrow REFUND / deactivate slice verification (NOT a migration — do not
-- place in migrations/).
--
-- SELF-ASSERTING: every check is a seeded begin…rollback block that RAISES
-- EXCEPTION on failure, so the whole file aborts non-zero the moment a MONEY-
-- STATE safety property is violated. Tier 1 properties (docs/TESTING.md): the
-- refund transition never regresses a later state, is idempotent under webhook
-- redelivery, and clients can never execute the money function.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset
--     psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/refund_cancel_verification.sql
--
-- Fixtures: a PAID post (status active or pending_verification) with a matching
-- 'held' payments row is seeded inside each begin…rollback block, owned by seed
-- profile 11111111-… (Alex Mercer), bounty £250 (25000 pence). Nothing persists.
-- Function under test (20260729100000_post_refund_cancel.sql):
--   mark_post_payment_refunded(payment_intent_id, refund_id, refunded_amount_pence).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — a HELD payment on an ACTIVE post: mark_post_payment_refunded flips
-- the payment held -> refunded (recording refund id + refunded amount) AND the
-- post active -> cancelled.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('cccccccc-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'active', 25000, 'RF11 CAN');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('cccccccc-0000-0000-0000-000000000001', 'pi_refund_1', 'held', 25000);

do $$
declare
  v_pay    public.payments%rowtype;
  v_status public.post_status;
begin
  perform public.mark_post_payment_refunded('pi_refund_1', 're_refund_1', 24230);

  select * into v_pay from public.payments where stripe_payment_intent_id = 'pi_refund_1';
  if v_pay.status <> 'refunded' then
    raise exception 'CHECK 1 FAILED: payment status is %, expected refunded', v_pay.status;
  end if;
  if v_pay.stripe_refund_id <> 're_refund_1' then
    raise exception 'CHECK 1 FAILED: refund id not recorded (got %)', v_pay.stripe_refund_id;
  end if;
  if v_pay.refunded_amount_pence <> 24230 then
    raise exception 'CHECK 1 FAILED: refunded amount is %, expected 24230', v_pay.refunded_amount_pence;
  end if;

  select status into v_status from public.posts where id = 'cccccccc-0000-0000-0000-000000000001';
  if v_status <> 'cancelled' then
    raise exception 'CHECK 1 FAILED: post status is %, expected cancelled', v_status;
  end if;
  raise notice 'CHECK 1 passed: held+active -> refunded payment + cancelled post';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 — a PENDING_VERIFICATION post (paid, awaiting moderation) is also
-- refund-eligible: it cancels just like an active one.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('cccccccc-0000-0000-0000-000000000002',
        '11111111-1111-1111-1111-111111111111', 'pending_verification', 25000, 'RF12 CAN');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('cccccccc-0000-0000-0000-000000000002', 'pi_refund_2', 'held', 25000);

do $$
declare
  v_status public.post_status;
begin
  perform public.mark_post_payment_refunded('pi_refund_2', 're_refund_2', 24230);
  select status into v_status from public.posts where id = 'cccccccc-0000-0000-0000-000000000002';
  if v_status <> 'cancelled' then
    raise exception 'CHECK 2 FAILED: pending_verification post is %, expected cancelled', v_status;
  end if;
  raise notice 'CHECK 2 passed: pending_verification is refund-eligible and cancels';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — IDEMPOTENT: a second delivery of the same refund (retry / webhook
-- redelivery) is a no-op — the payment stays refunded and the post stays
-- cancelled; nothing is double-processed or regressed.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('cccccccc-0000-0000-0000-000000000003',
        '11111111-1111-1111-1111-111111111111', 'active', 25000, 'RF13 CAN');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('cccccccc-0000-0000-0000-000000000003', 'pi_refund_3', 'held', 25000);

do $$
declare
  v_pay    public.payments%rowtype;
  v_status public.post_status;
begin
  perform public.mark_post_payment_refunded('pi_refund_3', 're_refund_3', 24230);
  -- second delivery, e.g. Edge Function + charge.refunded webhook both fire
  perform public.mark_post_payment_refunded('pi_refund_3', 're_refund_3', 24230);

  select * into v_pay from public.payments where stripe_payment_intent_id = 'pi_refund_3';
  select status into v_status from public.posts where id = 'cccccccc-0000-0000-0000-000000000003';
  if v_pay.status <> 'refunded' or v_pay.refunded_amount_pence <> 24230 then
    raise exception 'CHECK 3 FAILED: idempotent re-call changed the payment (% / %)',
      v_pay.status, v_pay.refunded_amount_pence;
  end if;
  if v_status <> 'cancelled' then
    raise exception 'CHECK 3 FAILED: idempotent re-call changed the post status (%)', v_status;
  end if;
  raise notice 'CHECK 3 passed: a duplicate refund delivery is a safe no-op';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 — NEVER-REGRESS. A late/duplicate refund event must NOT (a) pull a
-- post that has moved on (recovery_claimed) back to cancelled, nor (b) touch a
-- payment that is no longer 'held' (already released to a spotter).
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('cccccccc-0000-0000-0000-000000000004',
        '11111111-1111-1111-1111-111111111111', 'recovery_claimed', 25000, 'RF14 CAN');
-- The escrow was already released to the winning spotter — status 'released'.
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('cccccccc-0000-0000-0000-000000000004', 'pi_refund_4', 'released', 25000);

do $$
declare
  v_pay    public.payments%rowtype;
  v_status public.post_status;
begin
  -- A stray refund event for this intent must change NOTHING.
  perform public.mark_post_payment_refunded('pi_refund_4', 're_refund_4', 24230);

  select * into v_pay from public.payments where stripe_payment_intent_id = 'pi_refund_4';
  select status into v_status from public.posts where id = 'cccccccc-0000-0000-0000-000000000004';
  if v_pay.status <> 'released' or v_pay.stripe_refund_id is not null then
    raise exception 'CHECK 4 FAILED: a stray refund regressed a released payment (% / %)',
      v_pay.status, v_pay.stripe_refund_id;
  end if;
  if v_status <> 'recovery_claimed' then
    raise exception 'CHECK 4 FAILED: a stray refund regressed the post to % (expected recovery_claimed)', v_status;
  end if;
  raise notice 'CHECK 4 passed: a late refund never regresses a released payment / advanced post';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 — UNKNOWN intent id: a refund event for an intent we never recorded is
-- a benign no-op (returns silently, does not raise).
-- -----------------------------------------------------------------------------
do $$
begin
  perform public.mark_post_payment_refunded('pi_does_not_exist', 're_nope', 100);
  raise notice 'CHECK 5 passed: unknown intent id is a benign no-op';
exception when others then
  raise exception 'CHECK 5 FAILED: unknown intent id raised %', sqlerrm;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 6 — GRANTS. anon + authenticated must NOT be able to EXECUTE the refund
-- function (money-state transition); service_role must.
-- -----------------------------------------------------------------------------
do $$
declare
  v_sig text := 'public.mark_post_payment_refunded(text, text, integer)';
begin
  if has_function_privilege('anon', v_sig, 'EXECUTE') then
    raise exception 'CHECK 6 FAILED: anon can EXECUTE % (should be revoked)', v_sig;
  end if;
  if has_function_privilege('authenticated', v_sig, 'EXECUTE') then
    raise exception 'CHECK 6 FAILED: authenticated can EXECUTE % (should be revoked)', v_sig;
  end if;
  if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
    raise exception 'CHECK 6 FAILED: service_role CANNOT EXECUTE % (should be granted)', v_sig;
  end if;
  raise notice 'CHECK 6 passed: refund fn is service-role only (anon + authenticated denied)';
end $$;
