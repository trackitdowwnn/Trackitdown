-- =============================================================================
-- No-bounty listings / fixed listing fee verification (NOT a migration — do not
-- place in migrations/).
--
-- WHAT:  Tier 1 MONEY gates for ADR-0014 — the second pricing mode. A post
--        carries EITHER a £50–£5,000 bounty (escrowed, 95/5 on recovery) OR a
--        fixed £4.99 listing fee (platform revenue on capture, never refunded).
--
-- WHY:   Three properties carry this feature, and each is a silent failure if
--        it breaks:
--          1. THE TWO PATHS CANNOT CROSS. A bounty charged as a fee, or a fee
--             captured into escrow, is real money in the wrong ledger state.
--          2. A LISTING FEE NEVER ENTERS 'held'. Every refund/payout query in
--             the codebase filters on held, so a fee that reached it would
--             become refundable money that was never meant to be — and, worse,
--             an escrowed BOUNTY marked 'collected' would become invisible to
--             every refund path, i.e. silently kept.
--          3. NULL IS NOT ZERO. A no-reward post must never be ranked, matched
--             or displayed as though it offered £0.
--
-- CHECKS: 1 create_post stamps the fee · 2 the pricing-mode invariant ·
--         3 FEE_MISMATCH · 4 POST_NOT_DRAFT (incl. wrong pricing mode) ·
--         5 idempotent fee intent · 6 collect -> active + never-regress ·
--         7 the dispatcher routes by kind · 8 capture handlers refuse each
--         other's rows · 9 no refund path sees a collected row ·
--         10 cancel_fee_listing · 11 cancel_fee_listing refuses a bounty post ·
--         12 claim_recovery closes a fee post and moves no money ·
--         13 min-bounty alerts skip no-reward posts · 14 highest_bounties
--         excludes no-reward posts · 15 grants (deny-by-default) ·
--         16 cancel_fee_listing asks the LEDGER, not the price columns ·
--         17 a stale intent cannot capture against a re-priced post.
--
-- SELF-ASSERTING: every check is a DO block (or a seeded begin…rollback block)
-- that RAISES on failure, so the file aborts non-zero the moment a property is
-- violated (psql -v ON_ERROR_STOP=1). Meant to GATE CI, not to be eyeballed.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset
--     psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/listing_fee_verification.sql
--
-- Fixtures: seed profiles Alex 11111111-… and Beth 22222222-…, spotter Carl
-- 33333333-…. Posts are created inside begin…rollback blocks except where a
-- check needs a committed row, which it then cleans up itself.
--
-- LINKS: supabase/migrations/20260820100000_listing_fee_payment_status.sql;
--        supabase/migrations/20260820110000_no_bounty_listing_fee.sql;
--        supabase/migrations/20260820120000_highest_bounties_excludes_no_reward.sql;
--        docs/decisions/ADR-0014-no-bounty-listings.md; docs/DOMAIN.md;
--        docs/TESTING.md (Tier 1 = money/safety); scripts/test-db.sh.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — create_post with a NULL bounty produces a draft priced at the
-- server's own fee. The price is never a parameter: it is read from
-- current_listing_fee_pence(), so a client cannot name what it pays.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_doc    jsonb;
  v_id     uuid;
  v_bounty integer;
  v_fee    integer;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;

  v_doc := public.create_post(
    null, 'Ford', 'Fiesta', 'Blue', 2019, 'Hatchback', null, null,
    null, null, 'street', 'no',
    now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
    null::int,                              -- NO BOUNTY (cast: positional arg 17)
    array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
    null, null);

  reset role;
  v_id := (v_doc ->> 'post_id')::uuid;

  select bounty_amount_pence, listing_fee_pence into v_bounty, v_fee
  from public.posts where id = v_id;

  if v_bounty is not null then
    raise exception 'CHECK 1 FAILED: a no-bounty post stored bounty_amount_pence = %', v_bounty;
  end if;
  if v_fee is distinct from 499 then
    raise exception 'CHECK 1 FAILED: listing_fee_pence is %, expected 499 (£4.99)', v_fee;
  end if;
  if v_fee is distinct from public.current_listing_fee_pence() then
    raise exception 'CHECK 1 FAILED: the stamped fee does not match current_listing_fee_pence()';
  end if;
  raise notice 'CHECK 1 passed: a null bounty produces a draft stamped with the server-side listing fee';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 — THE INVARIANT. Exactly one pricing mode per post. A row with BOTH
-- prices (charged twice) or NEITHER (live for free) must be impossible at the
-- table level, not merely avoided by the functions above it.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_both boolean := false;
  v_none boolean := false;
begin
  begin
    insert into public.posts (id, owner_id, status, bounty_amount_pence, listing_fee_pence)
    values ('eeee0000-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111', 'draft', 25000, 499);
  exception when check_violation then
    v_both := true;
  end;

  begin
    insert into public.posts (id, owner_id, status, bounty_amount_pence, listing_fee_pence)
    values ('eeee0000-0000-0000-0000-000000000002',
            '11111111-1111-1111-1111-111111111111', 'draft', null, null);
  exception when check_violation then
    v_none := true;
  end;

  if not v_both then
    raise exception 'CHECK 2 FAILED: a post with BOTH a bounty and a listing fee was accepted (it would be charged twice)';
  end if;
  if not v_none then
    raise exception 'CHECK 2 FAILED: a post with NEITHER price was accepted (it would go live for free)';
  end if;
  raise notice 'CHECK 2 passed: posts_one_pricing_mode_check enforces exactly one price per post';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — record_listing_fee_intent validates against the post's OWN STAMPED
-- fee, not against current_listing_fee_pence(). A wrong amount raises
-- FEE_MISMATCH and writes NO ledger row (the mirror of BOUNTY_MISMATCH: the
-- charge amount is server-authoritative and never trusted from the caller).
--
-- THE FIXTURE IS STAMPED AT 599, NOT 499, ON PURPOSE. With 499 this check would
-- pass even if the function compared against current_listing_fee_pence() —
-- because the two would be equal, and the whole reason listing_fee_pence is
-- SNAPSHOTTED is that a price change must never re-price an existing draft.
-- 599 makes the two sources disagree, so only the snapshot reading survives.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, listing_fee_pence, plate)
values ('eeee0000-0000-0000-0000-000000000003',
        '11111111-1111-1111-1111-111111111111', 'draft', null, 599, 'FE03 LST');

do $$
declare
  v_raised boolean := false;
  v_rows   integer;
begin
  begin
    -- TODAY'S price (499) against a draft stamped at 599. If the function read
    -- the live constant instead of the post, this would succeed.
    perform public.record_listing_fee_intent(
      'eeee0000-0000-0000-0000-000000000003', 'pi_fee_wrong', 499);
  exception when others then
    if sqlerrm not like '%FEE_MISMATCH%' then
      raise exception 'CHECK 3 FAILED: expected FEE_MISMATCH, got: %', sqlerrm;
    end if;
    v_raised := true;
  end;

  if not v_raised then
    raise exception 'CHECK 3 FAILED: today''s price was accepted against a draft stamped at a DIFFERENT fee — the charge validates against current_listing_fee_pence(), not the post''s snapshot, so a price change would retro-price existing drafts';
  end if;

  select count(*) into v_rows from public.payments
  where post_id = 'eeee0000-0000-0000-0000-000000000003';
  if v_rows <> 0 then
    raise exception 'CHECK 3 FAILED: a mismatched amount still wrote % ledger row(s)', v_rows;
  end if;

  -- ...and the POSITIVE control: the stamped amount IS accepted. Without this,
  -- a function that rejected everything would pass the assertions above.
  perform public.record_listing_fee_intent(
    'eeee0000-0000-0000-0000-000000000003', 'pi_fee_stamped', 599);
  select count(*) into v_rows from public.payments
  where post_id = 'eeee0000-0000-0000-0000-000000000003' and amount_pence = 599;
  if v_rows <> 1 then
    raise exception 'CHECK 3 FAILED: the post''s own stamped fee was not accepted (% rows)', v_rows;
  end if;
  raise notice 'CHECK 3 passed: the fee is validated against the post''s SNAPSHOT, not the live price';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 — THE PATHS CANNOT CROSS (charge side). record_listing_fee_intent
-- refuses a BOUNTY-priced post, and record_post_payment_intent refuses a
-- FEE-priced one. Either crossing would charge the wrong amount for the post.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, listing_fee_pence, plate)
values ('eeee0000-0000-0000-0000-000000000004',
        '11111111-1111-1111-1111-111111111111', 'draft', 25000, null, 'BO04 UNT'),
       ('eeee0000-0000-0000-0000-000000000005',
        '11111111-1111-1111-1111-111111111111', 'draft', null, 499, 'FE05 LST');

do $$
declare
  v_fee_on_bounty boolean := false;
  v_bounty_on_fee boolean := false;
  v_rows integer;
begin
  begin
    perform public.record_listing_fee_intent(
      'eeee0000-0000-0000-0000-000000000004', 'pi_cross_1', 499);
  exception when others then
    if sqlerrm not like '%POST_NOT_DRAFT%' then
      raise exception 'CHECK 4 FAILED: expected POST_NOT_DRAFT for a fee charge on a bounty post, got: %', sqlerrm;
    end if;
    v_fee_on_bounty := true;
  end;

  begin
    perform public.record_post_payment_intent(
      'eeee0000-0000-0000-0000-000000000005', 'pi_cross_2', 25000);
  exception when others then
    if sqlerrm not like '%POST_NOT_DRAFT%' then
      raise exception 'CHECK 4 FAILED: expected POST_NOT_DRAFT for an escrow charge on a fee post, got: %', sqlerrm;
    end if;
    v_bounty_on_fee := true;
  end;

  if not v_fee_on_bounty then
    raise exception 'CHECK 4 FAILED: a listing-fee charge was opened against a BOUNTY post';
  end if;
  if not v_bounty_on_fee then
    raise exception 'CHECK 4 FAILED: an escrow charge was opened against a FEE post';
  end if;

  select count(*) into v_rows from public.payments
  where post_id in ('eeee0000-0000-0000-0000-000000000004',
                    'eeee0000-0000-0000-0000-000000000005');
  if v_rows <> 0 then
    raise exception 'CHECK 4 FAILED: a crossed charge still wrote % ledger row(s)', v_rows;
  end if;
  raise notice 'CHECK 4 passed: neither record_* function can be pointed at the other pricing mode';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 — record_listing_fee_intent is IDEMPOTENT: a retry (a second intent
-- id for the same post) reuses the live row rather than opening a second charge.
-- The property that stops a declined-then-retried PaymentSheet double-charging.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, listing_fee_pence, plate)
values ('eeee0000-0000-0000-0000-000000000006',
        '11111111-1111-1111-1111-111111111111', 'draft', null, 499, 'FE06 LST');

do $$
declare
  v_rows   integer;
  v_intent text;
  v_kind   public.payment_kind;
begin
  perform public.record_listing_fee_intent(
    'eeee0000-0000-0000-0000-000000000006', 'pi_fee_first', 499);
  perform public.record_listing_fee_intent(
    'eeee0000-0000-0000-0000-000000000006', 'pi_fee_second', 499);

  select count(*) into v_rows from public.payments
  where post_id = 'eeee0000-0000-0000-0000-000000000006';
  select stripe_payment_intent_id, kind into v_intent, v_kind from public.payments
  where post_id = 'eeee0000-0000-0000-0000-000000000006';

  if v_rows <> 1 then
    raise exception 'CHECK 5 FAILED: expected exactly 1 fee ledger row after two record calls, got %', v_rows;
  end if;
  if v_intent <> 'pi_fee_first' then
    raise exception 'CHECK 5 FAILED: the retained row is %, expected the first intent', v_intent;
  end if;
  if v_kind <> 'listing_fee' then
    raise exception 'CHECK 5 FAILED: the fee row was recorded as kind = %', v_kind;
  end if;
  raise notice 'CHECK 5 passed: record_listing_fee_intent is idempotent and records kind = listing_fee';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 6 — mark_listing_fee_collected takes the post LIVE and the payment to
-- the TERMINAL 'collected' state, and NEVER regresses: a duplicate or late
-- webhook delivery must not pull a closed post back to active.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, listing_fee_pence, plate)
values ('eeee0000-0000-0000-0000-000000000007',
        '11111111-1111-1111-1111-111111111111', 'draft', null, 499, 'FE07 LST');

do $$
declare
  v_pay    public.payment_status;
  v_status public.post_status;
begin
  perform public.record_listing_fee_intent(
    'eeee0000-0000-0000-0000-000000000007', 'pi_fee_collect', 499);
  perform public.mark_listing_fee_collected('pi_fee_collect');

  select status into v_pay from public.payments
  where stripe_payment_intent_id = 'pi_fee_collect';
  select status into v_status from public.posts
  where id = 'eeee0000-0000-0000-0000-000000000007';

  if v_pay <> 'collected' then
    raise exception 'CHECK 6 FAILED: payment status is %, expected collected', v_pay;
  end if;
  if v_status <> 'active' then
    raise exception 'CHECK 6 FAILED: post status is %, expected active (live-on-payment)', v_status;
  end if;

  -- The post closes, then a RETRIED webhook for the same intent arrives.
  update public.posts set status = 'cancelled'
  where id = 'eeee0000-0000-0000-0000-000000000007';
  perform public.mark_listing_fee_collected('pi_fee_collect');

  select status into v_status from public.posts
  where id = 'eeee0000-0000-0000-0000-000000000007';
  if v_status <> 'cancelled' then
    raise exception 'CHECK 6 FAILED: a redelivered webhook regressed a cancelled post to %', v_status;
  end if;

  -- An intent we never recorded is a benign no-op, not an error.
  perform public.mark_listing_fee_collected('pi_never_recorded');
  raise notice 'CHECK 6 passed: fee capture goes draft -> active / collected, never regresses, unknown intent is a no-op';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 7 — the DISPATCHER routes by kind. mark_post_payment_succeeded is the
-- only function the webhook calls on payment_intent.succeeded, so if it routed
-- wrongly every charge would land in the wrong ledger state.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, listing_fee_pence, plate)
values ('eeee0000-0000-0000-0000-000000000008',
        '11111111-1111-1111-1111-111111111111', 'draft', 25000, null, 'BO08 UNT'),
       ('eeee0000-0000-0000-0000-000000000009',
        '11111111-1111-1111-1111-111111111111', 'draft', null, 499, 'FE09 LST');

do $$
declare
  v_bounty_pay public.payment_status;
  v_fee_pay    public.payment_status;
begin
  perform public.record_post_payment_intent(
    'eeee0000-0000-0000-0000-000000000008', 'pi_disp_bounty', 25000);
  perform public.record_listing_fee_intent(
    'eeee0000-0000-0000-0000-000000000009', 'pi_disp_fee', 499);

  perform public.mark_post_payment_succeeded('pi_disp_bounty');
  perform public.mark_post_payment_succeeded('pi_disp_fee');

  select status into v_bounty_pay from public.payments
  where stripe_payment_intent_id = 'pi_disp_bounty';
  select status into v_fee_pay from public.payments
  where stripe_payment_intent_id = 'pi_disp_fee';

  if v_bounty_pay <> 'held' then
    raise exception 'CHECK 7 FAILED: a bounty escrow routed to % instead of held', v_bounty_pay;
  end if;
  if v_fee_pay <> 'collected' then
    raise exception 'CHECK 7 FAILED: a listing fee routed to % instead of collected', v_fee_pay;
  end if;

  perform public.mark_post_payment_succeeded('pi_unknown_intent');  -- benign no-op
  raise notice 'CHECK 7 passed: mark_post_payment_succeeded routes each kind to its own handler';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 8 — THE PATHS CANNOT CROSS (capture side). Each capture handler refuses
-- the other's rows, in BOTH directions:
--   * a fee marked 'held' would become refundable money that was never meant to be;
--   * a BOUNTY marked 'collected' would vanish from every refund query — the
--     owner's £50–£5,000 silently kept. That is the worse of the two.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, listing_fee_pence, plate)
values ('eeee0000-0000-0000-0000-00000000000a',
        '11111111-1111-1111-1111-111111111111', 'draft', 25000, null, 'BO0A UNT'),
       ('eeee0000-0000-0000-0000-00000000000b',
        '11111111-1111-1111-1111-111111111111', 'draft', null, 499, 'FE0B LST');

do $$
declare
  v_bounty_pay public.payment_status;
  v_fee_pay    public.payment_status;
begin
  perform public.record_post_payment_intent(
    'eeee0000-0000-0000-0000-00000000000a', 'pi_cross_bounty', 25000);
  perform public.record_listing_fee_intent(
    'eeee0000-0000-0000-0000-00000000000b', 'pi_cross_fee', 499);

  -- Point each handler at the WRONG row.
  perform public.mark_listing_fee_collected('pi_cross_bounty');
  perform public.mark_post_payment_held('pi_cross_fee');

  select status into v_bounty_pay from public.payments
  where stripe_payment_intent_id = 'pi_cross_bounty';
  select status into v_fee_pay from public.payments
  where stripe_payment_intent_id = 'pi_cross_fee';

  if v_bounty_pay = 'collected' then
    raise exception 'CHECK 8 FAILED: an escrowed BOUNTY was marked collected — it is now invisible to every refund path';
  end if;
  if v_fee_pay = 'held' then
    raise exception 'CHECK 8 FAILED: a listing fee entered escrow — it is now refundable money that never should be';
  end if;
  raise notice 'CHECK 8 passed: neither capture handler will act on the other kind''s ledger row';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 9 — THE CENTRAL CLAIM: no refund path can see a collected fee. Every
-- refund/payout query in the codebase selects `status = 'held'`, so this asserts
-- the property those queries actually rely on rather than re-listing them.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, listing_fee_pence, plate)
values ('eeee0000-0000-0000-0000-00000000000c',
        '11111111-1111-1111-1111-111111111111', 'draft', null, 499, 'FE0C LST');

do $$
declare
  v_held integer;
  v_pay  public.payment_status;
  v_post public.post_status;
begin
  perform public.record_listing_fee_intent(
    'eeee0000-0000-0000-0000-00000000000c', 'pi_fee_norefund', 499);
  perform public.mark_listing_fee_collected('pi_fee_norefund');

  -- The exact shape of the lookup in _shared/refundEscrow.ts and
  -- _shared/releasePayout.ts.
  select count(*) into v_held from public.payments
  where post_id = 'eeee0000-0000-0000-0000-00000000000c' and status = 'held';
  if v_held <> 0 then
    raise exception 'CHECK 9 FAILED: a refund/payout lookup found % held row(s) for a fee-priced post', v_held;
  end if;

  -- And the refund recorder cannot drag it out of terminal either. A goodwill
  -- refund of £4.99 issued BY HAND in the Stripe dashboard fires
  -- charge.refunded at us, so this is a real event, not a hypothetical.
  perform public.mark_post_payment_refunded('pi_fee_norefund', 're_stray', 499);

  select status into v_pay from public.payments
  where stripe_payment_intent_id = 'pi_fee_norefund';
  if v_pay <> 'collected' then
    raise exception 'CHECK 9 FAILED: a stray refund event moved a collected fee to %', v_pay;
  end if;

  -- BOTH HALVES. The payments guard alone is not enough: until 2026-08-20 the
  -- POSTS update in mark_post_payment_refunded fired even when the payments
  -- update matched nothing, so this stray event took a LIVE listing down while
  -- the ledger still read `collected` — no refund, no record, and the owner's
  -- car no longer being looked for.
  select status into v_post from public.posts
  where id = 'eeee0000-0000-0000-0000-00000000000c';
  if v_post <> 'active' then
    raise exception 'CHECK 9 FAILED: a stray refund event cancelled a live listing (now %) without refunding anything', v_post;
  end if;
  raise notice 'CHECK 9 passed: a collected listing fee is invisible to every refund path, and a stray refund event touches neither the ledger nor the post';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 10 — cancel_fee_listing takes a live fee listing down, moves no money,
-- and is idempotent. The no-refund counterpart of mark_post_payment_refunded.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, listing_fee_pence, plate)
values ('eeee0000-0000-0000-0000-00000000000d',
        '11111111-1111-1111-1111-111111111111', 'active', null, 499, 'FE0D LST');

do $$
declare
  v_status public.post_status;
  v_holds  integer;
  v_closed timestamptz;
begin
  perform public.cancel_fee_listing('eeee0000-0000-0000-0000-00000000000d');

  select status, closed_at into v_status, v_closed from public.posts
  where id = 'eeee0000-0000-0000-0000-00000000000d';
  if v_status <> 'cancelled' then
    raise exception 'CHECK 10 FAILED: post status is %, expected cancelled', v_status;
  end if;
  -- The set_post_closed_at trigger maintains this; the function deliberately
  -- does not write it, so this asserts the two still cooperate.
  if v_closed is null then
    raise exception 'CHECK 10 FAILED: closed_at was not stamped on the transition';
  end if;

  -- NO refund hold and NO dispute window: the ADR-0011 machinery exists to stop
  -- an owner denying an earned BOUNTY, and there is none here to deny.
  select count(*) into v_holds from public.refund_holds
  where post_id = 'eeee0000-0000-0000-0000-00000000000d';
  if v_holds <> 0 then
    raise exception 'CHECK 10 FAILED: taking down a fee listing created % refund hold(s)', v_holds;
  end if;

  -- Idempotent: a retry after a dropped response is a no-op, not an error.
  perform public.cancel_fee_listing('eeee0000-0000-0000-0000-00000000000d');
  raise notice 'CHECK 10 passed: cancel_fee_listing delists, moves no money, creates no hold, and is idempotent';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 11 — cancel_fee_listing REFUSES a bounty post. This exit issues no
-- refund, so taking it with escrow held would keep the owner's £50–£5,000 with
-- no refund and no record of one — the worst silent failure available here.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, listing_fee_pence, plate)
values ('eeee0000-0000-0000-0000-00000000000e',
        '11111111-1111-1111-1111-111111111111', 'active', 25000, null, 'BO0E UNT');

do $$
declare
  v_raised boolean := false;
  v_status public.post_status;
begin
  begin
    perform public.cancel_fee_listing('eeee0000-0000-0000-0000-00000000000e');
  exception when others then
    if sqlerrm not like '%POST_HAS_BOUNTY%' then
      raise exception 'CHECK 11 FAILED: expected POST_HAS_BOUNTY, got: %', sqlerrm;
    end if;
    v_raised := true;
  end;

  if not v_raised then
    raise exception 'CHECK 11 FAILED: a BOUNTY post was taken down through the no-refund exit';
  end if;

  select status into v_status from public.posts
  where id = 'eeee0000-0000-0000-0000-00000000000e';
  if v_status <> 'active' then
    raise exception 'CHECK 11 FAILED: the refused call still changed the post to %', v_status;
  end if;
  raise notice 'CHECK 11 passed: cancel_fee_listing refuses a bounty post and leaves it untouched';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 12 — claim_recovery on a FEE post reaches a TERMINAL state directly and
-- moves no money. Without this a fee post parks in recovery_claimed forever
-- waiting on a payout that never comes — which also permanently blocks the
-- owner from deleting their account (DOMAIN.md "Account deletion").
--
-- The credited sighting and the reputation bump still happen: on a no-reward
-- listing that recognition IS the spotter's whole reward (ADR-0014).
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, listing_fee_pence, plate)
values ('eeee0000-0000-0000-0000-00000000000f',
        '22222222-2222-2222-2222-222222222222', 'active', null, 499, 'FE0F LST'),
       ('eeee0000-0000-0000-0000-000000000010',
        '22222222-2222-2222-2222-222222222222', 'active', null, 499, 'FE10 LST');

-- The paid fee for post …000f, already captured. Its presence is what gives the
-- "no money moved" assertions below something to actually be true OF.
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
values ('eeee0000-0000-0000-0000-00000000000f', 'pi_check12_fee', 'collected', 499, 'listing_fee');

insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('c1c1c1c1-0000-0000-0000-000000000001',
        'eeee0000-0000-0000-0000-00000000000f',
        '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true);

do $$
declare
  v_doc     jsonb;
  v_status  public.post_status;
  v_sight   text;
  v_before  integer;
  v_after   integer;
  v_pays    integer;
begin
  select recoveries_credited into v_before from public.profiles
  where id = '33333333-3333-3333-3333-333333333333';

  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;

  -- (a) credited: lands on `recovered`, not recovery_claimed.
  v_doc := public.claim_recovery('eeee0000-0000-0000-0000-00000000000f',
                                 'c1c1c1c1-0000-0000-0000-000000000001');
  -- (b) found another way: lands on `recovered_no_spotter`.
  perform public.claim_recovery('eeee0000-0000-0000-0000-000000000010', null);

  reset role;

  if v_doc ->> 'nextStep' <> 'done' then
    raise exception 'CHECK 12 FAILED: nextStep is %, expected done (there is no money call to make)', v_doc ->> 'nextStep';
  end if;

  select status into v_status from public.posts
  where id = 'eeee0000-0000-0000-0000-00000000000f';
  if v_status <> 'recovered' then
    raise exception 'CHECK 12 FAILED: a credited fee post is %, expected recovered', v_status;
  end if;

  select status into v_status from public.posts
  where id = 'eeee0000-0000-0000-0000-000000000010';
  if v_status <> 'recovered_no_spotter' then
    raise exception 'CHECK 12 FAILED: an uncredited fee post is %, expected recovered_no_spotter', v_status;
  end if;

  select status into v_sight from public.sightings
  where id = 'c1c1c1c1-0000-0000-0000-000000000001';
  if v_sight <> 'credited' then
    raise exception 'CHECK 12 FAILED: the sighting is %, expected credited', v_sight;
  end if;

  select recoveries_credited into v_after from public.profiles
  where id = '33333333-3333-3333-3333-333333333333';
  if v_after <> v_before + 1 then
    raise exception 'CHECK 12 FAILED: recoveries_credited went % -> %, expected +1 (reputation IS the reward here)', v_before, v_after;
  end if;

  -- NO MONEY MOVED. Asserted against a post whose fee is ALREADY `collected`:
  -- counting rows on a post that never had one would hold even if the money leg
  -- were completely broken, which is no assertion at all. The real property is
  -- that a claim leaves a collected fee exactly where it was — not released to
  -- the spotter, not refunded to the owner.
  select count(*) into v_pays from public.payments
  where post_id = 'eeee0000-0000-0000-0000-00000000000f'
    and status = 'collected';
  if v_pays <> 1 then
    raise exception 'CHECK 12 FAILED: the fee row is no longer collected after the claim (% rows)', v_pays;
  end if;

  select count(*) into v_pays from public.payments
  where post_id in ('eeee0000-0000-0000-0000-00000000000f',
                    'eeee0000-0000-0000-0000-000000000010')
    and status in ('held', 'released', 'refunded');
  if v_pays <> 0 then
    raise exception 'CHECK 12 FAILED: claiming a fee post moved money — % row(s) in a held/released/refunded state', v_pays;
  end if;

  -- ...and NO refund hold: a fee post is outside the ADR-0011 machinery.
  select count(*) into v_pays from public.refund_holds
  where post_id in ('eeee0000-0000-0000-0000-00000000000f',
                    'eeee0000-0000-0000-0000-000000000010');
  if v_pays <> 0 then
    raise exception 'CHECK 12 FAILED: claiming a fee post created % refund hold(s)', v_pays;
  end if;
  raise notice 'CHECK 12 passed: a fee post closes terminally on claim, credits the spotter, and moves no money';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 13 — a MINIMUM-BOUNTY alert must never match a no-reward post, and an
-- unfiltered alert still must. NULL >= n is unknown, so this holds for free —
-- which is exactly why it is asserted: a well-meaning `coalesce(bounty, 0)`
-- added later would silently make every no-reward post match every alert.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, listing_fee_pence,
                          plate, make, model, colour, last_seen_at, last_seen_location, last_seen_locality)
values ('eeee0000-0000-0000-0000-000000000011',
        '11111111-1111-1111-1111-111111111111', 'active', null, 499, 'FE11 LST',
        'Ford', 'Fiesta', 'Blue', now() - interval '1 hour',
        ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography, 'Manchester');

-- `name`, NOT `label`: 20260802150000_multi_alert.sql renamed the column and
-- made it NOT NULL when alerts went multi ("an alert you can have five of needs
-- a name, not an optional label"). The original definition in
-- 20260802120000_alert_zones.sql is superseded — read the LATEST migration that
-- touches a column, not the one that created it.
insert into public.alert_zones (id, user_id, name, point, radius_m, enabled, min_bounty_pence)
values ('aaaa0000-0000-0000-0000-000000000001',
        '33333333-3333-3333-3333-333333333333', 'Rich only',
        ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography, 16093, true, 50000),
       ('aaaa0000-0000-0000-0000-000000000002',
        '22222222-2222-2222-2222-222222222222', 'Anything near me',
        ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography, 16093, true, null);

do $$
declare
  v_doc   jsonb;
  v_users jsonb;
begin
  v_doc := public.match_alert_zones('eeee0000-0000-0000-0000-000000000011', 3);
  v_users := v_doc -> 'user_ids';

  if v_users @> '["33333333-3333-3333-3333-333333333333"]'::jsonb then
    raise exception 'CHECK 13 FAILED: a £500-minimum alert matched a NO-REWARD post (is a coalesce hiding the null?)';
  end if;
  if not (v_users @> '["22222222-2222-2222-2222-222222222222"]'::jsonb) then
    raise exception 'CHECK 13 FAILED: an alert with no bounty filter did NOT match a no-reward post — they are still worth spotting';
  end if;
  raise notice 'CHECK 13 passed: min-bounty alerts skip no-reward posts; unfiltered alerts still match them';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 14 — "Highest bounties nearby" must not contain no-reward listings.
-- Postgres sorts NULLs FIRST under DESC, so without the filter added in
-- 20260820120000 they would take the TOP slots of a section named for the thing
-- they lack. This is the quietest failure mode of the whole feature: nothing
-- errors, no number is wrong, the section just stops meaning its title.
-- -----------------------------------------------------------------------------
begin;
-- Two no-reward posts and one modest bounty, all in radius of the feed origin.
insert into public.posts (id, owner_id, status, bounty_amount_pence, listing_fee_pence,
                          plate, make, model, colour, last_seen_at, last_seen_location, last_seen_area)
values ('eeee0000-0000-0000-0000-000000000012',
        '11111111-1111-1111-1111-111111111111', 'active', null, 499, 'FE12 LST',
        'Ford', 'Fiesta', 'Blue', now() - interval '1 hour',
        ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography, 'Manchester'),
       ('eeee0000-0000-0000-0000-000000000013',
        '11111111-1111-1111-1111-111111111111', 'active', null, 499, 'FE13 LST',
        'Ford', 'Ka', 'Silver', now() - interval '1 hour',
        ST_SetSRID(ST_MakePoint(-2.2430, 53.4810), 4326)::geography, 'Manchester');

do $$
declare
  v_feed    jsonb;
  v_highest jsonb;
  v_post    jsonb;
begin
  -- Anon viewer (no auth.uid()), Manchester origin, 20-mile radius.
  perform set_config('request.jwt.claims', '', true);
  v_feed := public.get_home_feed(53.4808, -2.2426, 32187);

  select section into v_highest
  from jsonb_array_elements(v_feed -> 'sections') as section
  where section ->> 'id' = 'highest_bounties';

  if v_highest is null then
    -- The seed has bounty posts in Manchester, so the section must exist; its
    -- absence would mean this check silently asserts nothing.
    raise exception 'CHECK 14 FAILED: no highest_bounties section in the feed — the check cannot assert anything';
  end if;

  for v_post in select value from jsonb_array_elements(v_highest -> 'posts') loop
    if v_post ->> 'bounty_amount_pence' is null then
      raise exception 'CHECK 14 FAILED: a NO-REWARD post (%) appears in "Highest bounties nearby" — NULLs sort FIRST under DESC',
        v_post ->> 'id';
    end if;
  end loop;
  raise notice 'CHECK 14 passed: no-reward listings are excluded from the highest-bounties carousel';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 15 — DENY BY DEFAULT. The new money functions are service-role only, and
-- no client role may write the price we charge. This project's ALTER DEFAULT
-- PRIVILEGES re-grants anon at CREATE time, so every CREATE OR REPLACE is a
-- chance to silently re-open one of these.
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn   text;
  v_role text;
begin
  -- Includes the functions this migration merely REDEFINED, not just the new
  -- ones. CREATE OR REPLACE is exactly the event that re-triggers the anon
  -- grant, so a redefined function is at MORE risk than a new one, not less.
  foreach v_fn in array array[
    'record_listing_fee_intent(uuid, text, integer)',
    'mark_listing_fee_collected(text)',
    'mark_post_payment_succeeded(text)',
    'cancel_fee_listing(uuid)',
    'record_post_payment_intent(uuid, text, integer)',
    'mark_post_payment_held(text)'
  ] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_role, 'public.' || v_fn, 'execute') then
        raise exception 'CHECK 15 FAILED: % can execute % — these move money state and are service-role only', v_role, v_fn;
      end if;
    end loop;
    if not has_function_privilege('service_role', 'public.' || v_fn, 'execute') then
      raise exception 'CHECK 15 FAILED: service_role CANNOT execute % — the Edge Functions would break', v_fn;
    end if;
  end loop;

  -- The PRICE is ours, not the client's. listing_fee_pence must never appear in
  -- the posts column grants (create_post stamps it under SECURITY DEFINER).
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_column_privilege(v_role, 'public.posts', 'listing_fee_pence', 'INSERT')
       or has_column_privilege(v_role, 'public.posts', 'listing_fee_pence', 'UPDATE') then
      raise exception 'CHECK 15 FAILED: % can write posts.listing_fee_pence — a client could name its own price', v_role;
    end if;
  end loop;

  -- The three client-callable functions redefined here must stay signed-in-only
  -- (authenticated yes, anon no) — each redefinition is a chance to re-open them.
  foreach v_fn in array array[
    'create_post(text, text, text, text, int, text, text, text, text, text, text, text, timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb, text)',
    'update_post_bounty(uuid, int)',
    'claim_recovery(uuid, uuid)'
  ] loop
    if has_function_privilege('anon', 'public.' || v_fn, 'execute') then
      raise exception 'CHECK 15 FAILED: anon can execute % — the redefinition re-opened it (cf. 20260713191000)', v_fn;
    end if;
    if not has_function_privilege('authenticated', 'public.' || v_fn, 'execute') then
      raise exception 'CHECK 15 FAILED: authenticated CANNOT execute % — the app would break', v_fn;
    end if;
  end loop;

  -- The price constant: readable by a signed-in client (it is public
  -- information), never by anon.
  if has_function_privilege('anon', 'public.current_listing_fee_pence()', 'execute') then
    raise exception 'CHECK 15 FAILED: anon can execute current_listing_fee_pence()';
  end if;
  raise notice 'CHECK 15 passed: the fee money functions are service-role only and no client can write the price';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 16 — cancel_fee_listing asks the LEDGER, not the price columns.
--
-- The scenario, which is reachable: a draft carries a live bounty intent, the
-- owner edits it to no-reward (the row is superseded to 'failed'), and the stale
-- Stripe intent later succeeds because create-payment-intent's cancel is
-- best-effort. That leaves a fee-PRICED post with REAL escrow held against it.
-- Taking the no-refund exit there would keep the owner's £250 with no refund and
-- no record of one. `bounty_amount_pence is null` does NOT prove there is no
-- money; only the payments table does.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, listing_fee_pence, plate)
values ('eeee0000-0000-0000-0000-000000000014',
        '11111111-1111-1111-1111-111111111111', 'active', null, 499, 'FE14 LST');

-- Fee-priced post, bounty escrow held against it — the stale-capture outcome.
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
values ('eeee0000-0000-0000-0000-000000000014', 'pi_stale_escrow', 'held', 25000, 'bounty_escrow');

do $$
declare
  v_raised boolean := false;
  v_status public.post_status;
  v_pay    public.payment_status;
begin
  begin
    perform public.cancel_fee_listing('eeee0000-0000-0000-0000-000000000014');
  exception when others then
    if sqlerrm not like '%POST_HAS_BOUNTY%' then
      raise exception 'CHECK 16 FAILED: expected POST_HAS_BOUNTY, got: %', sqlerrm;
    end if;
    v_raised := true;
  end;

  if not v_raised then
    raise exception 'CHECK 16 FAILED: a post with HELD escrow was taken down through the no-refund exit — the owner''s money is kept with no refund and no record';
  end if;

  select status into v_status from public.posts
  where id = 'eeee0000-0000-0000-0000-000000000014';
  if v_status <> 'active' then
    raise exception 'CHECK 16 FAILED: the refused call still changed the post to %', v_status;
  end if;

  select status into v_pay from public.payments
  where stripe_payment_intent_id = 'pi_stale_escrow';
  if v_pay <> 'held' then
    raise exception 'CHECK 16 FAILED: the escrow row moved to %', v_pay;
  end if;
  raise notice 'CHECK 16 passed: cancel_fee_listing refuses any post with held escrow, whatever its price columns say';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 17 — the MODE-SWITCH RACE. A stale intent must never capture against a
-- post whose price has since changed.
--
-- The sequence is reachable without anything failing: a decline leaves the
-- ledger row 'failed' but the PaymentIntent still live at Stripe (the stale
-- sweep in create-payment-intent only cancels rows still `requires_payment`),
-- the owner then edits the draft, and the old intent is confirmed afterwards.
-- Without the amount re-check, the post goes LIVE with the wrong money behind
-- it: a bounty listing with no escrow, or a "No reward" listing holding real
-- escrow that cancel_fee_listing would later discard.
--
-- Asserted in BOTH directions, because the two failures are not symmetrical —
-- one under-escrows a public promise, the other strands the owner's money.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, listing_fee_pence, plate)
values ('eeee0000-0000-0000-0000-000000000015',
        '11111111-1111-1111-1111-111111111111', 'draft', 25000, null, 'RC15 BTF'),
       ('eeee0000-0000-0000-0000-000000000016',
        '11111111-1111-1111-1111-111111111111', 'draft', null, 499, 'RC16 FTB');

do $$
declare
  v_pay  public.payment_status;
  v_post public.post_status;
begin
  -- (a) BOUNTY -> FEE. £250 intent opened, then the draft switches to no-reward.
  perform public.record_post_payment_intent(
    'eeee0000-0000-0000-0000-000000000015', 'pi_race_bounty', 25000);
  update public.posts
     set bounty_amount_pence = null, listing_fee_pence = 499
   where id = 'eeee0000-0000-0000-0000-000000000015';

  -- The stale intent is confirmed at Stripe afterwards.
  perform public.mark_post_payment_succeeded('pi_race_bounty');

  select status into v_pay from public.payments
  where stripe_payment_intent_id = 'pi_race_bounty';
  select status into v_post from public.posts
  where id = 'eeee0000-0000-0000-0000-000000000015';

  if v_pay = 'held' then
    raise exception 'CHECK 17 FAILED: a stale £250 escrow captured against a post now priced as NO-REWARD — the listing would read "No reward" while holding the owner''s money, and cancel_fee_listing would discard it';
  end if;
  if v_post <> 'draft' then
    raise exception 'CHECK 17 FAILED: the stale capture took the post live (now %)', v_post;
  end if;

  -- (b) FEE -> BOUNTY. The mirror: a £4.99 intent against a post now at £250.
  perform public.record_listing_fee_intent(
    'eeee0000-0000-0000-0000-000000000016', 'pi_race_fee', 499);
  update public.posts
     set bounty_amount_pence = 25000, listing_fee_pence = null
   where id = 'eeee0000-0000-0000-0000-000000000016';

  perform public.mark_post_payment_succeeded('pi_race_fee');

  select status into v_pay from public.payments
  where stripe_payment_intent_id = 'pi_race_fee';
  select status into v_post from public.posts
  where id = 'eeee0000-0000-0000-0000-000000000016';

  if v_pay = 'collected' then
    raise exception 'CHECK 17 FAILED: a stale £4.99 fee captured against a post now priced at £250';
  end if;
  if v_post <> 'draft' then
    raise exception 'CHECK 17 FAILED: a £4.99 capture took a £250 BOUNTY listing live with no escrow behind it (now %)', v_post;
  end if;
  raise notice 'CHECK 17 passed: a stale intent cannot capture against a re-priced post, in either direction';
end $$;
rollback;


-- =============================================================================
-- END OF SUITE
-- =============================================================================
