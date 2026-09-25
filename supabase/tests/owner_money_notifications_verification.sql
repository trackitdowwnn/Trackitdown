-- =============================================================================
-- Owner money notifications verification — refund_sent and reward_delivered
-- (ADR-0021, 20260925120000). NOT a migration — do not place in migrations/.
--
-- SELF-ASSERTING: every check RAISES EXCEPTION on failure. Every check runs in
-- begin…rollback on its own fixtures (posts c1c1c1c1-…).
--
-- The properties:
--   * each claim fires exactly once, for the owner, with the RECORDED amount;
--   * the copy names the owner's own car and never the spotter;
--   * nothing that is not a landed escrow refund / released reward claims;
--   * both kinds are writable, mutable under `money`, and service-role only.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — "£X refunded": once, to the owner, with the recorded refund.
-- A held escrow and a £5 fee never claim.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, make, colour)
values ('c1c1c1c1-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'cancelled', 40000, 'OM01 REF', 'BMW', 'Black'),
       ('c1c1c1c1-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'active',    40000, 'OM02 HLD', 'Ford', 'Blue'),
       ('c1c1c1c1-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'cancelled', null,  'OM03 FEE', 'Audi', 'Grey');
insert into public.payments
  (post_id, stripe_payment_intent_id, status, amount_pence, kind, pricing, reward_pence, service_fee_pence)
values ('c1c1c1c1-0000-0000-0000-000000000001', 'pi_om1', 'held', 42000, 'bounty_escrow', 'fee_on_top', 40000, 2000),
       ('c1c1c1c1-0000-0000-0000-000000000002', 'pi_om2', 'held', 42000, 'bounty_escrow', 'fee_on_top', 40000, 2000),
       ('c1c1c1c1-0000-0000-0000-000000000003', 'pi_om3', 'collected', 500, 'listing_fee', 'flat_fee', null, 500);
update public.payments set status = 'refunded', refunded_amount_pence = 41350
 where stripe_payment_intent_id = 'pi_om1';

do $$
declare
  v_claim jsonb;
begin
  v_claim := public.claim_refund_sent_notification('c1c1c1c1-0000-0000-0000-000000000001');
  if not (v_claim ->> 'claimed')::boolean
     or v_claim ->> 'user_id' <> '22222222-2222-2222-2222-222222222222'
     or v_claim ->> 'title' <> '£413.50 refunded'
     or v_claim ->> 'body' not like 'For your Black BMW.%5–10 working days.' then
    raise exception 'CHECK 1 FAILED: refund claim read %', v_claim;
  end if;

  if (public.claim_refund_sent_notification('c1c1c1c1-0000-0000-0000-000000000001') ->> 'claimed')::boolean then
    raise exception 'CHECK 1 FAILED: the refund was announced twice';
  end if;
  if (public.claim_refund_sent_notification('c1c1c1c1-0000-0000-0000-000000000002') ->> 'claimed')::boolean then
    raise exception 'CHECK 1 FAILED: a HELD escrow claimed a refund push';
  end if;
  if (public.claim_refund_sent_notification('c1c1c1c1-0000-0000-0000-000000000003') ->> 'claimed')::boolean then
    raise exception 'CHECK 1 FAILED: a £5 fee — never refunded — claimed a refund push';
  end if;
  raise notice 'CHECK 1 passed: refund_sent claims once, for the owner, with the recorded refund';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 — "£X sent to your spotter": once, to the owner, with the recorded
-- transfer — and nothing about who the spotter is.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, make, colour)
values ('c1c1c1c1-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'recovered', 40000, 'OM04 PAY', 'BMW', 'Black');
insert into public.payments
  (post_id, stripe_payment_intent_id, status, amount_pence, kind, pricing, reward_pence, service_fee_pence)
values ('c1c1c1c1-0000-0000-0000-000000000004', 'pi_om4', 'held', 42000, 'bounty_escrow', 'fee_on_top', 40000, 2000);
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('c1c1c1c1-1111-0000-0000-000000000004', 'c1c1c1c1-0000-0000-0000-000000000004',
        '33333333-3333-3333-3333-333333333333', 'credited', 'Camden', true);

do $$
declare
  v_claim jsonb;
begin
  if (public.claim_reward_delivered_notification('c1c1c1c1-0000-0000-0000-000000000004') ->> 'claimed')::boolean then
    raise exception 'CHECK 2 FAILED: a reward still HELD claimed a delivered push';
  end if;

  update public.payments set status = 'released', transfer_amount_pence = 40000, platform_fee_pence = 2000
   where stripe_payment_intent_id = 'pi_om4';

  v_claim := public.claim_reward_delivered_notification('c1c1c1c1-0000-0000-0000-000000000004');
  if not (v_claim ->> 'claimed')::boolean
     or v_claim ->> 'user_id' <> '22222222-2222-2222-2222-222222222222'
     or v_claim ->> 'title' <> '£400.00 sent to your spotter'
     or v_claim ->> 'body' <> 'The reward for your Black BMW is on its way to them.' then
    raise exception 'CHECK 2 FAILED: reward claim read %', v_claim;
  end if;
  -- ⚠️ Nothing about the spotter: not their id, not their name.
  if v_claim::text like '%33333333%'
     or v_claim::text ilike '%' || (select coalesce(display_name, '~none~') from public.profiles
                                      where id = '33333333-3333-3333-3333-333333333333') || '%' then
    raise exception 'CHECK 2 FAILED: the spotter reached the owner''s push: %', v_claim;
  end if;

  if (public.claim_reward_delivered_notification('c1c1c1c1-0000-0000-0000-000000000004') ->> 'claimed')::boolean then
    raise exception 'CHECK 2 FAILED: the reward was announced twice';
  end if;
  raise notice 'CHECK 2 passed: reward_delivered claims once, for the owner, with no trace of the spotter';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — THE KINDS ARE WIRED: both writable in both kind constraints,
-- both mutable under `money`, both claims service-role only.
-- -----------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_kind text;
  v_fn text;
begin
  foreach v_kind in array array['refund_sent', 'reward_delivered'] loop
    foreach v_def in array array[
      pg_get_constraintdef((select oid from pg_constraint
                             where conname = 'notifications_kind_chk'
                               and conrelid = 'public.notifications'::regclass)),
      pg_get_constraintdef((select oid from pg_constraint
                             where conname = 'push_sends_kind_chk'
                               and conrelid = 'public.push_sends'::regclass))
    ] loop
      if position(v_kind in v_def) = 0 then
        raise exception 'CHECK 3 FAILED: % is missing from a kind constraint — it would fail at write or delivery', v_kind;
      end if;
    end loop;
    if public.notification_category(v_kind) is distinct from 'money' then
      raise exception 'CHECK 3 FAILED: % maps to %, expected money', v_kind, public.notification_category(v_kind);
    end if;
  end loop;

  foreach v_fn in array array[
    'public.claim_refund_sent_notification(uuid)',
    'public.claim_reward_delivered_notification(uuid)'
  ] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'CHECK 3 FAILED: a client can call % — anyone could stamp a claim and silence it', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception 'CHECK 3 FAILED: service_role cannot call % — the senders are broken', v_fn;
    end if;
  end loop;
  raise notice 'CHECK 3 passed: both owner money kinds are writable, mutable under money, and service-role only';
end $$;
