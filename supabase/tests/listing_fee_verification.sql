-- =============================================================================
-- Free listings / fixed listing fee verification (NOT a migration — do not
-- place in migrations/).
--
-- WHAT:  Tier 1 MONEY gates for the second pricing mode as it ACTUALLY SHIPPED
--        (20260819100000_a_listing_can_be_free). A post carries EITHER a
--        £10–£5,000 bounty (escrowed, 95/5 on recovery) OR a flat £5 listing
--        fee (platform revenue on capture, never refunded).
--
--        WHETHER THE POST HAS A BOUNTY IS THE PRICING MODE. There is no flag
--        and no snapshot column: a NULL bounty is a free listing.
--
-- THIS FILE WAS REWRITTEN ON 2026-08-22, and the reason is the point of it.
--        It previously tested a 499p design — a posts.listing_fee_pence
--        snapshot, current_listing_fee_pence(), record_listing_fee_intent, a
--        collected payment status — that existed only in this repository. The
--        database had shipped a different implementation eight days earlier.
--        Every check passed, against a schema nobody was running. A suite that
--        agrees with the repo instead of the database is not a gate.
--
-- AND ONE PROPERTY MOVED OUT OF SQL, WHICH IS A REAL WEAKENING.
--        The 499p design gave a fee a terminal status no refund query could
--        match, so a fee was invisible to the refund paths BY CONSTRUCTION and
--        this file could prove it. The shipped design puts a fee in held
--        alongside escrow and separates them by payments.kind, which only the
--        Edge Functions apply. This file cannot test that. It is enforced in
--        TypeScript instead:
--            supabase/functions/_shared/refundEscrow.ts
--            supabase/functions/_shared/releasePayout.ts
--            supabase/functions/release-held-refunds/index.ts   (the CRON)
--        all filter kind = bounty_escrow. If one of those loses its filter,
--        nothing here will notice. Said plainly rather than assumed.
--
-- CHECKS: 1 a null bounty makes a draft; 2 the charge is server-priced for a
--         FEE; 3 the charge is server-priced for a BOUNTY; 4 the ledger CHECK
--         is structural; 5 capture takes a fee post live; 6 cancel_fee_listing;
--         7 cancel_fee_listing refuses the cases it must; 8 grants.
--
-- SELF-ASSERTING: every check is a DO block that RAISES on failure, so the file
-- aborts non-zero the moment a property is violated (psql -v ON_ERROR_STOP=1).
--
-- LINKS: supabase/migrations/20260819100000_a_listing_can_be_free.sql;
--        supabase/migrations/20260822100000_a_fee_listing_can_come_down.sql;
--        docs/decisions/ADR-0014-no-bounty-listings.md; docs/TESTING.md.
-- =============================================================================

-- A free-listing draft owned by Beth. Returns its id.
create or replace function pg_temp.seed_free_listing()
returns uuid
language plpgsql
as $fn$
declare
  v_doc jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  v_doc := public.create_post(
    null, 'Ford', 'Fiesta', 'Blue', 2019, 'Hatchback', null, null,
    null, null, 'street', 'no',
    now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
    null::int,                              -- NO BOUNTY (positional arg 17)
    array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
    null, null);
  reset role;
  return (v_doc ->> 'post_id')::uuid;
end;
$fn$;

-- The same, with a bounty.
create or replace function pg_temp.seed_bounty_listing(p_pence integer)
returns uuid
language plpgsql
as $fn$
declare
  v_doc jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  v_doc := public.create_post(
    null, 'Ford', 'Focus', 'Red', 2020, 'Hatchback', null, null,
    null, null, 'street', 'no',
    now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
    p_pence,
    array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
    null, null);
  reset role;
  return (v_doc ->> 'post_id')::uuid;
end;
$fn$;


-- -----------------------------------------------------------------------------
-- CHECK 1 -- a NULL bounty is lawful and produces a DRAFT with no reward. NULL,
-- never 0: a zero would flow through every sum, sort and render as a real
-- "0 bounty", which is the bug the nullable column exists to prevent.
-- -----------------------------------------------------------------------------
begin;
do $c$
declare
  v_id     uuid;
  v_bounty integer;
  v_status public.post_status;
begin
  v_id := pg_temp.seed_free_listing();
  select bounty_amount_pence, status into v_bounty, v_status
  from public.posts where id = v_id;

  if v_bounty is not null then
    raise exception 'CHECK 1 FAILED: a free listing stored bounty_amount_pence = %', v_bounty;
  end if;
  if v_status <> 'draft' then
    raise exception 'CHECK 1 FAILED: create_post produced status %, expected draft', v_status;
  end if;
  raise notice 'CHECK 1 passed: a null bounty is lawful and makes a draft with no reward';
end $c$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 -- THE CHARGE IS SERVER-PRICED, fee side. record_post_payment_intent
-- derives the price from the POST, so a caller cannot name what it pays. The
-- fee is exactly 500 -- not a range, not a maximum.
-- -----------------------------------------------------------------------------
begin;
do $c$
declare
  v_id   uuid;
  v_kind public.payment_kind;
  v_amt  integer;
begin
  v_id := pg_temp.seed_free_listing();

  -- Anything that is not the fee is refused, INCLUDING 499 -- the price this
  -- repo believed in for four days.
  begin
    perform public.record_post_payment_intent(v_id, 'pi_wrong', 499);
    raise exception 'CHECK 2 FAILED: a 499p charge was accepted on a 500p listing';
  exception when others then
    if sqlerrm not like '%BOUNTY_MISMATCH%' then raise; end if;
  end;

  begin
    perform public.record_post_payment_intent(v_id, 'pi_wrong2', 25000);
    raise exception 'CHECK 2 FAILED: a bounty-sized charge was accepted on a free listing';
  exception when others then
    if sqlerrm not like '%BOUNTY_MISMATCH%' then raise; end if;
  end;

  -- The fee itself records, and carries the kind that keeps it out of escrow.
  perform public.record_post_payment_intent(v_id, 'pi_fee', 500);
  select kind, amount_pence into v_kind, v_amt
  from public.payments where stripe_payment_intent_id = 'pi_fee';

  if v_kind is distinct from 'listing_fee' then
    raise exception 'CHECK 2 FAILED: the fee row carries kind = %, expected listing_fee', v_kind;
  end if;
  if v_amt <> 500 then
    raise exception 'CHECK 2 FAILED: the fee row recorded % pence', v_amt;
  end if;
  raise notice 'CHECK 2 passed: a free listing owes exactly 500p and records as listing_fee';
end $c$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 -- THE CHARGE IS SERVER-PRICED, bounty side, and the two modes cannot
-- cross. A bounty listing settled for 500p would be a car listed for a
-- fiftieth of its advertised reward.
-- -----------------------------------------------------------------------------
begin;
do $c$
declare
  v_id   uuid;
  v_kind public.payment_kind;
begin
  v_id := pg_temp.seed_bounty_listing(25000);

  begin
    perform public.record_post_payment_intent(v_id, 'pi_fee_on_bounty', 500);
    raise exception 'CHECK 3 FAILED: a 25000p bounty listing was charged the 500p fee';
  exception when others then
    if sqlerrm not like '%BOUNTY_MISMATCH%' then raise; end if;
  end;

  perform public.record_post_payment_intent(v_id, 'pi_bounty', 25000);
  select kind into v_kind
  from public.payments where stripe_payment_intent_id = 'pi_bounty';

  if v_kind is distinct from 'bounty_escrow' then
    raise exception 'CHECK 3 FAILED: the bounty row carries kind = %, expected bounty_escrow', v_kind;
  end if;
  raise notice 'CHECK 3 passed: a bounty listing owes its own bounty and records as bounty_escrow';
end $c$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 -- THE LEDGER CHECK IS STRUCTURAL, not merely enforced by the
-- function above. The range is split BY KIND on purpose: 500p is below the
-- 1000p bounty floor, so widening one range to admit the fee would also admit a
-- 500p escrow -- a bounty below the floor every other layer enforces.
-- -----------------------------------------------------------------------------
begin;
do $c$
declare
  v_id uuid;
begin
  v_id := pg_temp.seed_free_listing();

  begin
    insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
    values (v_id, 'pi_bad_fee', 'requires_payment', 400, 'listing_fee');
    raise exception 'CHECK 4 FAILED: a 400p listing_fee row was accepted -- the fee is one price, not a maximum';
  exception when check_violation then null;
  end;

  begin
    insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
    values (v_id, 'pi_bad_escrow', 'requires_payment', 500, 'bounty_escrow');
    raise exception 'CHECK 4 FAILED: a 500p bounty_escrow row was accepted -- that is a bounty below the floor';
  exception when check_violation then null;
  end;

  raise notice 'CHECK 4 passed: payments_amount_pence_check pins a fee at 500 and keeps escrow above the floor';
end $c$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 -- CAPTURE TAKES A FEE POST LIVE. One handler serves both modes: a
-- fee post goes draft -> active exactly as an escrowed one does, because it
-- must reach spotters the same way. The listing is the thing that was bought.
-- -----------------------------------------------------------------------------
begin;
do $c$
declare
  v_id     uuid;
  v_status public.post_status;
  v_pay    public.payment_status;
begin
  v_id := pg_temp.seed_free_listing();
  perform public.record_post_payment_intent(v_id, 'pi_fee', 500);
  perform public.mark_post_payment_held('pi_fee');

  select status into v_status from public.posts where id = v_id;
  select status into v_pay from public.payments where stripe_payment_intent_id = 'pi_fee';

  if v_status <> 'active' then
    raise exception 'CHECK 5 FAILED: a paid free listing sits at %, expected active', v_status;
  end if;
  -- ⚠️ EXPECTATION CHANGED 2026-09-02 BY ADR-0018, from `held` to `collected`.
  -- This is a deliberate contract change, not a test bent to fit code: a fee
  -- sitting in `held` was what forced five separate money selectors to filter
  -- `kind = 'bounty_escrow'` to avoid refunding it, and ADR-0014 records those
  -- filters going missing for four days while an hourly cron refunded fees.
  -- `held` now means escrow and only escrow, so a fee is unreachable by those
  -- queries by construction. fee_collected_verification asserts that half.
  if v_pay <> 'collected' then
    raise exception 'CHECK 5 FAILED: the captured fee sits at %, expected collected (ADR-0018 — a fee must never enter `held`, which every refund query selects on)', v_pay;
  end if;

  -- Never-regress: a replayed webhook must not undo anything.
  perform public.mark_post_payment_held('pi_fee');
  select status into v_status from public.posts where id = v_id;
  if v_status <> 'active' then
    raise exception 'CHECK 5 FAILED: a replayed capture moved the post to %', v_status;
  end if;
  raise notice 'CHECK 5 passed: a fee capture takes the post live and replays are no-ops';
end $c$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 6 -- cancel_fee_listing TAKES IT DOWN AND MOVES NO MONEY. The fee
-- bought a listing and the listing was delivered (ADR-0014); the client
-- discloses that before payment. So the payments row must be untouched.
-- -----------------------------------------------------------------------------
begin;
do $c$
declare
  v_id     uuid;
  v_status public.post_status;
  v_before public.payments%rowtype;
  v_after  public.payments%rowtype;
begin
  v_id := pg_temp.seed_free_listing();
  perform public.record_post_payment_intent(v_id, 'pi_fee', 500);
  perform public.mark_post_payment_held('pi_fee');

  select * into v_before from public.payments where stripe_payment_intent_id = 'pi_fee';
  perform public.cancel_fee_listing(v_id);

  select status into v_status from public.posts where id = v_id;
  select * into v_after from public.payments where stripe_payment_intent_id = 'pi_fee';

  if v_status <> 'cancelled' then
    raise exception 'CHECK 6 FAILED: the listing sits at %, expected cancelled', v_status;
  end if;
  if v_after is distinct from v_before then
    raise exception 'CHECK 6 FAILED: the payments row changed -- this exit must move no money';
  end if;

  -- Idempotent: a double tap, or a retry after a lost response.
  perform public.cancel_fee_listing(v_id);
  raise notice 'CHECK 6 passed: a fee listing comes down, the fee stays put, and a retry is a no-op';
end $c$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 7 -- cancel_fee_listing REFUSES THE TWO CASES THAT WOULD LOSE MONEY.
-- A bounty-priced post has a refund owed and must take the escrow exit; a
-- fee-priced post carrying HELD escrow is real money with no refund path
-- through here, so it stops and a human looks.
-- -----------------------------------------------------------------------------
begin;
do $c$
declare
  v_bounty uuid;
  v_fee    uuid;
begin
  v_bounty := pg_temp.seed_bounty_listing(25000);
  perform public.record_post_payment_intent(v_bounty, 'pi_b', 25000);
  perform public.mark_post_payment_held('pi_b');
  begin
    perform public.cancel_fee_listing(v_bounty);
    raise exception 'CHECK 7 FAILED: a bounty listing was cancelled with no refund';
  exception when others then
    if sqlerrm not like '%NOT_FEE_LISTING%' then raise; end if;
  end;

  -- Fee-PRICED but escrow-FUNDED: a stale bounty intent that captured after a
  -- draft pricing switch.
  v_fee := pg_temp.seed_free_listing();
  perform public.record_post_payment_intent(v_fee, 'pi_f', 500);
  perform public.mark_post_payment_held('pi_f');
  update public.payments set kind = 'bounty_escrow', amount_pence = 25000
   where stripe_payment_intent_id = 'pi_f';
  begin
    perform public.cancel_fee_listing(v_fee);
    raise exception 'CHECK 7 FAILED: a post carrying held escrow was cancelled with no refund';
  exception when others then
    if sqlerrm not like '%POST_HAS_BOUNTY%' then raise; end if;
  end;
  raise notice 'CHECK 7 passed: cancel_fee_listing refuses a bounty post and a post holding escrow';
end $c$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 8 -- GRANTS. cancel_fee_listing performs NO ownership check of its own:
-- deactivate-post proves the caller owns the post before calling. That split is
-- only safe while no client can reach it, and this project ships ALTER DEFAULT
-- PRIVILEGES handing EXECUTE on new functions to anon and authenticated, so the
-- revoke is load-bearing rather than tidiness.
-- -----------------------------------------------------------------------------
do $c$
begin
  if has_function_privilege('authenticated', 'public.cancel_fee_listing(uuid)', 'execute')
     or has_function_privilege('anon', 'public.cancel_fee_listing(uuid)', 'execute') then
    raise exception 'CHECK 8 FAILED: cancel_fee_listing is client-executable and checks no ownership';
  end if;
  if not has_function_privilege('service_role', 'public.cancel_fee_listing(uuid)', 'execute') then
    raise exception 'CHECK 8 FAILED: service_role cannot execute cancel_fee_listing';
  end if;
  raise notice 'CHECK 8 passed: cancel_fee_listing is service-role only';
end $c$;
