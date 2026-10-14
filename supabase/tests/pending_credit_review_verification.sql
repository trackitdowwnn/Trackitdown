-- =============================================================================
-- WHAT:  Verification for my_pending_credit()'s `under_review`
--        (20261014100000_a_held_payout_says_so.sql). NOT a migration.
-- WHY:   The flag is what stops the Payouts tracker telling a spotter their
--        reward is "on its way" while a collusion review holds it. Its rule
--        must match the money gate's (a review short of approved holds the
--        payout), and the function is still a security-definer window into the
--        payments ledger: losing auth.uid() hands everyone's credit to everyone.
--
-- CHECKS: 1 no review → not under review, amount and post as before · 2 a
-- pending review → under review · 3 ⚠️ a REJECTED review reads exactly like
-- pending · 4 approved → not under review · 5 ⚠️ another user sees nothing of
-- it · 6 grants: anon cannot execute, authenticated can · 7 the old columns
-- are still there, by name, for apps that predate the new one.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        Owner 11111111-…, spotter 44444444-… (seed profiles).
-- LINKS: supabase/migrations/20261014100000_a_held_payout_says_so.sql.
-- =============================================================================

begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, recovered_at)
values ('ee000000-0000-0000-0000-000000000041', '11111111-1111-1111-1111-111111111111',
        'recovery_claimed', 20000, 'PR04 REV', now());
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence, captured_at)
values ('ee000041-0000-0000-0000-00000000000a', 'ee000000-0000-0000-0000-000000000041',
        'pi_pending_credit_review', 'held', 20000, now() - interval '3 days');
-- created_at in the future of every seed row, so `limit 1` picks this one.
insert into public.sightings (post_id, spotter_id, status, area_label, location_unavailable,
                              credited_at, created_at)
values ('ee000000-0000-0000-0000-000000000041', '44444444-4444-4444-4444-444444444444',
        'credited', 'Camden', true, now(), now() + interval '1 minute');

do $$
declare
  v_row record;
  v_post constant uuid := 'ee000000-0000-0000-0000-000000000041';
begin
  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);

  -- CHECK 1 — no review: the credit as before, not under review.
  select * into v_row from public.my_pending_credit();
  if v_row.post_id is distinct from v_post then
    raise exception 'CHECK 1 FAILED: expected the test post, got %', v_row.post_id;
  end if;
  if v_row.transfer_pence is distinct from (select transfer_pence from public.payout_split(20000)) then
    raise exception 'CHECK 1 FAILED: % pence is not the 95%% split of £200', v_row.transfer_pence;
  end if;
  if v_row.under_review is distinct from false then
    raise exception 'CHECK 1 FAILED: under_review is % with no review at all', v_row.under_review;
  end if;

  -- CHECK 2 — a pending review holds it.
  insert into public.payout_reviews (post_id, owner_id, spotter_id, reasons)
  values (v_post, '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444',
          array['test']);
  select * into v_row from public.my_pending_credit();
  if v_row.under_review is distinct from true then
    raise exception 'CHECK 2 FAILED: a pending review did not read as under review — the tracker would say "on its way"';
  end if;

  -- CHECK 3 — ⚠️ rejected reads exactly like pending: the money is still held
  -- (for manual action), and which one it is is no one's to learn here.
  update public.payout_reviews set resolution = 'rejected', resolved_at = now() where post_id = v_post;
  select * into v_row from public.my_pending_credit();
  if v_row.under_review is distinct from true then
    raise exception 'CHECK 3 FAILED: a rejected review read differently from a pending one';
  end if;

  -- CHECK 4 — approved releases the hold.
  update public.payout_reviews set resolution = 'approved', resolved_at = now() where post_id = v_post;
  select * into v_row from public.my_pending_credit();
  if v_row.under_review is distinct from false then
    raise exception 'CHECK 4 FAILED: an approved review still reads as under review';
  end if;

  -- CHECK 5 — ⚠️ another user sees nothing of this credit or its review.
  update public.payout_reviews set resolution = null, resolved_at = null where post_id = v_post;
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  if exists (select 1 from public.my_pending_credit() c where c.post_id = v_post) then
    raise exception 'CHECK 5 FAILED: the OWNER read the spotter''s pending credit';
  end if;
  perform set_config('request.jwt.claims',
    '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
  if exists (select 1 from public.my_pending_credit()) then
    raise exception 'CHECK 5 FAILED: an unrelated user read a pending credit';
  end if;

  raise notice 'pending credit review CHECKS 1-5 passed';
end $$;

-- CHECK 6 — grants.
do $$
begin
  if has_function_privilege('anon', 'public.my_pending_credit()', 'execute') then
    raise exception 'CHECK 6 FAILED: anon can execute my_pending_credit';
  end if;
  if not has_function_privilege('authenticated', 'public.my_pending_credit()', 'execute') then
    raise exception 'CHECK 6 FAILED: authenticated cannot execute my_pending_credit';
  end if;
  raise notice 'pending credit review CHECK 6 passed';
end $$;

-- CHECK 7 — the old columns, by name, for apps that predate under_review.
do $$
declare
  v_args text;
begin
  select pg_get_function_result('public.my_pending_credit()'::regprocedure) into v_args;
  if v_args not like '%post_id uuid%' or v_args not like '%transfer_pence integer%'
     or v_args not like '%under_review boolean%' then
    raise exception 'CHECK 7 FAILED: unexpected result shape: %', v_args;
  end if;
  raise notice 'pending credit review CHECK 7 passed';
end $$;

rollback;
