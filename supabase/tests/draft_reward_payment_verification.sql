-- =============================================================================
-- WHAT:  Verification for 20261028150000_a_draft_reward_waits_for_its_payment.sql.
--        NOT a migration.
-- WHY:   A reward changed while a charge for the old one could still succeed
--        was refunded in full at capture, the fee absorbed. The price must wait
--        for every open intent to be proven dead at Stripe.
-- CHECKS: 1 ⚠️ an open (requires_payment or failed) row refuses the edit and
-- changes nothing · 2 ⚠️ forget removes nothing it was not shown proof for (no
-- ids, a wrong id, a null element) · 3 forget removes the proven open rows
-- only, then the edit goes through · 4 forget refuses a stranger and a live
-- listing · 5 forget is service-role only.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        Owner is seed user Alex (1111…), the stranger Sam (2222…).
-- LINKS: supabase/migrations/20261028150000_a_draft_reward_waits_for_its_payment.sql,
--        supabase/functions/release-draft-intents/index.ts.
-- =============================================================================

begin;

insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('dbdb0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'draft',  25000, 'DB01 AAA'),
       ('dbdb0000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'active', 25000, 'DB02 AAA');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
values ('dbdb0000-0000-0000-0000-000000000001', 'pi_dbdb_open',   'requires_payment', 25000, 'bounty_escrow'),
       ('dbdb0000-0000-0000-0000-000000000001', 'pi_dbdb_failed', 'failed',           25000, 'bounty_escrow'),
       ('dbdb0000-0000-0000-0000-000000000001', 'pi_dbdb_fee',    'collected',        500,   'listing_fee');

select set_config('request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);

-- CHECK 1 — an open payment blocks the price.
do $$
declare
  v_err text := 'none';
begin
  set local role authenticated;
  begin
    perform public.update_post_bounty('dbdb0000-0000-0000-0000-000000000001', 30000);
  exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err <> 'PAYMENT_IN_PROGRESS' then
    raise exception 'CHECK 1 FAILED: an open payment did not block the edit (got %).', v_err;
  end if;
  if (select bounty_amount_pence from public.posts
       where id = 'dbdb0000-0000-0000-0000-000000000001') <> 25000 then
    raise exception 'CHECK 1 FAILED: the reward changed.';
  end if;
  raise notice 'CHECK 1 passed: an open payment refuses the edit (PAYMENT_IN_PROGRESS).';
end $$;

-- CHECK 2 — no proof, no removal.
do $$
declare
  v_n integer := 0;
begin
  v_n := v_n + public.forget_cancelled_draft_intents(
    'dbdb0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null);
  v_n := v_n + public.forget_cancelled_draft_intents(
    'dbdb0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', array['pi_other']);
  v_n := v_n + public.forget_cancelled_draft_intents(
    'dbdb0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', array[null]::text[]);
  if v_n <> 0 or (select count(*) from public.payments
                   where post_id = 'dbdb0000-0000-0000-0000-000000000001') <> 3 then
    raise exception 'CHECK 2 FAILED: rows were removed without proof (% removed).', v_n;
  end if;
  raise notice 'CHECK 2 passed: nothing goes without proof.';
end $$;

-- CHECK 3 — proven open rows go (the fee row stays), then the edit goes through.
do $$
declare
  v_n integer;
begin
  v_n := public.forget_cancelled_draft_intents(
    'dbdb0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    array['pi_dbdb_open', 'pi_dbdb_failed', 'pi_dbdb_fee']);
  if v_n <> 2 then
    raise exception 'CHECK 3 FAILED: expected 2 open rows removed, got %.', v_n;
  end if;
  if not exists (select 1 from public.payments where stripe_payment_intent_id = 'pi_dbdb_fee') then
    raise exception 'CHECK 3 FAILED: a collected fee row was removed.';
  end if;
end $$;
set local role authenticated;
select public.update_post_bounty('dbdb0000-0000-0000-0000-000000000001', 30000);
reset role;
do $$
begin
  if (select bounty_amount_pence from public.posts
       where id = 'dbdb0000-0000-0000-0000-000000000001') <> 30000 then
    raise exception 'CHECK 3 FAILED: the edit did not go through once the payments were cleared.';
  end if;
  raise notice 'CHECK 3 passed: proven open rows go, the fee stays, the edit goes through.';
end $$;

-- CHECK 4 — a stranger and a live listing are refused.
do $$
declare
  v_stranger text := 'none';
  v_live     text := 'none';
begin
  begin
    perform public.forget_cancelled_draft_intents(
      'dbdb0000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', array['pi_dbdb_fee']);
  exception when others then v_stranger := sqlerrm; end;
  begin
    perform public.forget_cancelled_draft_intents(
      'dbdb0000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', array['x']);
  exception when others then v_live := sqlerrm; end;
  if v_stranger <> 'NOT_OWNER' or v_live <> 'NOT_DRAFT' then
    raise exception 'CHECK 4 FAILED: stranger got %, live listing got %.', v_stranger, v_live;
  end if;
  raise notice 'CHECK 4 passed: NOT_OWNER for a stranger, NOT_DRAFT for a live listing.';
end $$;

-- CHECK 5 — grants.
do $$
declare
  v_sig text := 'public.forget_cancelled_draft_intents(uuid, uuid, text[])';
begin
  if has_function_privilege('anon', v_sig, 'execute')
     or has_function_privilege('authenticated', v_sig, 'execute') then
    raise exception 'CHECK 5 FAILED: a client role can forget payment rows.';
  end if;
  if not has_function_privilege('service_role', v_sig, 'execute') then
    raise exception 'CHECK 5 FAILED: service_role cannot call it.';
  end if;
  raise notice 'CHECK 5 passed: service-role only.';
end $$;

rollback;
