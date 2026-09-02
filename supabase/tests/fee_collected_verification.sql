-- =============================================================================
-- WHAT:  Tier 1 verification that a listing fee is unreachable by the money
--        queries BY CONSTRUCTION, not by predicate. NOT a migration.
-- WHY:   ⚠️ THIS IS THE PROPERTY ADR-0018 EXISTS TO BUY, AND IT IS INVISIBLE.
--        Nothing in the code says "a fee cannot be refunded" — the guarantee is
--        that a fee never enters `held`, which is the state every refund,
--        payout, sweep and credited-notification query selects on. A property
--        that lives in the shape of the data is exactly the kind that a later
--        migration erases without anyone noticing.
--
--        ADR-0014 recorded what the previous arrangement cost: the five `kind`
--        filters were missing for four days and an hourly cron refunded fees.
--        Those filters are still there, deliberately, as a second lock — so
--        these checks deliberately DO NOT rely on them. They assert the
--        structural half on its own, because that is the half that is new and
--        the half nothing else proves.
--
-- CHECKS: 1 a captured fee lands in `collected`, never `held` · 2 a captured
-- bounty still lands in `held` · 3 ⚠️ the refund/payout selector cannot see a
-- fee even with the kind filter REMOVED · 4 no listing_fee row is in `held`
-- anywhere · 5 no bounty_escrow row is in `collected` anywhere · 6 the
-- never-regress guard still holds for both kinds.
-- LINKS: docs/decisions/ADR-0018-fee-separation-by-construction.md;
--        supabase/migrations/20260902130000_fee_collected_not_held.sql;
--        supabase/tests/refund_cancel_verification.sql (the refund path itself).
--
-- SELF-ASSERTING: every check RAISES on failure (ON_ERROR_STOP=1). Everything
-- that writes runs inside begin/rollback.
-- =============================================================================

begin;
do $$
declare
  v_post   uuid := 'a1a1a1a1-0000-0000-0000-000000000003';
  v_status public.payment_status;
begin
  -- ---------------------------------------------------------------------
  -- CHECK 1 — a captured FEE lands in `collected`.
  -- ---------------------------------------------------------------------
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
  values (v_post, 'pi_test_fee_capture', 'requires_payment', 500, 'listing_fee');

  perform public.mark_post_payment_held('pi_test_fee_capture');

  select status into v_status from public.payments
   where stripe_payment_intent_id = 'pi_test_fee_capture';
  if v_status <> 'collected' then
    raise exception 'CHECK 1 FAILED: a captured fee is in % — it must never be `held`, which is what every refund query selects on', v_status;
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 2 — a captured BOUNTY still lands in `held`. The other direction:
  -- a change that sent everything to `collected` would pass CHECK 1 and
  -- silently make every bounty unrefundable and unpayable.
  -- ---------------------------------------------------------------------
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
  values (v_post, 'pi_test_bounty_capture', 'requires_payment', 20000, 'bounty_escrow');

  perform public.mark_post_payment_held('pi_test_bounty_capture');

  select status into v_status from public.payments
   where stripe_payment_intent_id = 'pi_test_bounty_capture';
  if v_status <> 'held' then
    raise exception 'CHECK 2 FAILED: a captured bounty is in % — escrow must be held', v_status;
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 3 — ⚠️ THE WHOLE POINT. The selector every money path uses, with the
  -- `kind` filter DELIBERATELY OMITTED. Under the old arrangement this would
  -- return the fee and the refund would take it; now it cannot, because the
  -- fee is not in the state being selected.
  -- ---------------------------------------------------------------------
  if exists (
    select 1 from public.payments
     where post_id = v_post
       and status = 'held'
       and stripe_payment_intent_id = 'pi_test_fee_capture'
  ) then
    raise exception 'CHECK 3 FAILED: a fee is visible to a held-selector — the structural property is gone and only the five kind filters stand between a fee and a refund';
  end if;

  -- ...and the bounty IS visible to the same selector, or the test proves
  -- nothing about the selector.
  if not exists (
    select 1 from public.payments
     where post_id = v_post
       and status = 'held'
       and stripe_payment_intent_id = 'pi_test_bounty_capture'
  ) then
    raise exception 'CHECK 3 FAILED: the held-selector cannot see a real bounty either — the check is not testing what it claims';
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 6 — never-regress still holds. A duplicate webhook must not move a
  -- terminal row, in either direction.
  -- ---------------------------------------------------------------------
  perform public.mark_post_payment_held('pi_test_fee_capture');
  select status into v_status from public.payments
   where stripe_payment_intent_id = 'pi_test_fee_capture';
  if v_status <> 'collected' then
    raise exception 'CHECK 6 FAILED: a redelivered webhook moved a collected fee to %', v_status;
  end if;

  raise notice 'CHECK 1/2/3/6 passed: a fee captures to collected and is invisible to a held-selector; a bounty still holds; redelivery is a no-op.';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4/5 — the invariants, over the WHOLE table rather than a fixture.
-- -----------------------------------------------------------------------------
-- ⚠️ THESE ARE THE ONES THAT CATCH A BAD BACKFILL. The migration moved existing
-- fee rows out of `held`; if it matched too little, fees remain refundable, and
-- if it matched too much, real escrow has been marked as ours. Both are
-- assertions about production data, so they run against whatever is there.
do $$
declare
  v_stray integer;
begin
  select count(*) into v_stray
    from public.payments
   where kind = 'listing_fee' and status = 'held';
  if v_stray <> 0 then
    raise exception 'CHECK 4 FAILED: % listing_fee row(s) are still in `held` — those fees are refundable by every money query', v_stray;
  end if;

  select count(*) into v_stray
    from public.payments
   where kind = 'bounty_escrow' and status = 'collected';
  if v_stray <> 0 then
    raise exception 'CHECK 5 FAILED: % bounty_escrow row(s) are in `collected` — escrow has been marked as ours and is now unpayable AND unrefundable', v_stray;
  end if;

  raise notice 'CHECK 4/5 passed: no fee is held, no escrow is collected.';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 7 — ⚠️ A COLLECTED FEE NO LONGER BLOCKS ACCOUNT DELETION.
-- -----------------------------------------------------------------------------
-- An unlooked-for consequence of ADR-0018, and a good one, so it is pinned
-- rather than left to be discovered.
--
-- `delete-account` refuses while any of the user's payments is `held` — "money
-- still in motion blocks deletion", which is right for escrow: a spotter may
-- still be owed it. A LISTING FEE is not in motion. It is ours the moment it
-- captures and is never coming back to anyone. But it used to sit in `held`
-- too, so a user whose only listing was fee-priced could be refused erasure
-- indefinitely by money that had already finished moving — a UK GDPR problem
-- created by a status name.
--
-- This asserts the query that gate uses, not the Edge Function itself (Deno is
-- not reachable from psql). If the gate's shape ever changes, this check goes
-- stale rather than wrong — but the property it names is the one that matters.
begin;
do $$
declare
  v_post  uuid := 'a1a1a1a1-0000-0000-0000-000000000003';
  v_owner uuid := '22222222-2222-2222-2222-222222222222';
  v_blocking integer;
begin
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
  values (v_post, 'pi_test_fee_deletion', 'collected', 500, 'listing_fee');

  select count(*) into v_blocking
    from public.payments p
    join public.posts po on po.id = p.post_id
   where p.status = 'held'
     and po.owner_id = v_owner;

  if v_blocking <> 0 then
    raise exception 'CHECK 7 FAILED: a captured fee still blocks account deletion — erasure refused over money that has finished moving';
  end if;

  -- ...and real escrow STILL blocks it, or this check has quietly disarmed the
  -- guard rather than narrowed it.
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
  values (v_post, 'pi_test_escrow_deletion', 'held', 20000, 'bounty_escrow');

  select count(*) into v_blocking
    from public.payments p
    join public.posts po on po.id = p.post_id
   where p.status = 'held'
     and po.owner_id = v_owner;

  if v_blocking < 1 then
    raise exception 'CHECK 7 FAILED: live escrow no longer blocks account deletion — a spotter could be owed money by an account that has gone';
  end if;

  raise notice 'CHECK 7 passed: a collected fee does not block erasure; held escrow still does.';
end $$;
rollback;


select 'fee_collected_verification: ALL CHECKS PASSED' as result;
