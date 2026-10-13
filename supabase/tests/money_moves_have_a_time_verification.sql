-- =============================================================================
-- WHAT:  Tier 1 verification for the reward timeline (PR4): the trigger that
--        stamps payments.released_at / refunded_at, and the owner's read,
--        get_my_reward_timeline(). NOT a migration.
-- WHY:   The stamps are the only record of WHEN money moved, so they must be
--        set by every route there, once, and never moved by a later write —
--        updated_at's failure (20261013100000). And the read opens the ledger
--        to the post's owner: lose the owner check and anyone reads anyone's
--        refunds; let a field through and a spotter's details reach the owner.
--
-- CHECKS: 1 a held payment carries no stamp · 2 released stamps released_at ·
-- 3 ⚠️ a later write never moves a stamp · 4 refunded stamps refunded_at, even
-- on insert · 5 the owner reads their rewards oldest first, with term, hold,
-- refund figure and credit time · 6 fees and untaken payments are not rewards
-- · 7 ⚠️ nothing that identifies a spotter · 8 ⚠️ anyone else gets
-- POST_NOT_FOUND · 9 grants.
-- LINKS: supabase/migrations/20261013110000_money_moves_have_a_time.sql;
--        supabase/migrations/20261013120000_an_owner_can_see_their_reward.sql.
--
-- SELF-ASSERTING: every check RAISES on failure (ON_ERROR_STOP=1). Everything
-- runs inside begin/rollback.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- CHECKS 1–4 — the stamps.
-- -----------------------------------------------------------------------------
do $$
declare
  v_pay  uuid;
  v_row  record;
begin
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, captured_at)
  values ('a1a1a1a1-0000-0000-0000-000000000003', 'pi_moment_1', 'held', 25000, now() - interval '10 days')
  returning id into v_pay;

  -- CHECK 1 — held: nothing has moved yet.
  select released_at, refunded_at into v_row from public.payments where id = v_pay;
  if v_row.released_at is not null or v_row.refunded_at is not null then
    raise exception 'CHECK 1 FAILED: a held payment already carries a money stamp';
  end if;

  -- CHECK 2 — released stamps released_at, and only that.
  update public.payments
     set status = 'released', stripe_transfer_id = 'tr_moment_1',
         transfer_amount_pence = 23750, platform_fee_pence = 1250
   where id = v_pay;
  select released_at, refunded_at into v_row from public.payments where id = v_pay;
  if v_row.released_at is null then
    raise exception 'CHECK 2 FAILED: the move to released stamped no released_at';
  end if;
  if v_row.refunded_at is not null then
    raise exception 'CHECK 2 FAILED: a release stamped refunded_at';
  end if;

  -- CHECK 3 — ⚠️ a later write never moves it. now() is fixed inside this
  -- transaction, so the stamp is set back a day first: any re-stamp would
  -- bring it forward to now() and be caught.
  update public.payments set released_at = now() - interval '1 day' where id = v_pay;
  update public.payments set payout_notified_at = now() where id = v_pay;          -- the "sent" push
  update public.payments set status = 'released' where id = v_pay;                -- a replayed write
  select released_at into v_row from public.payments where id = v_pay;
  if v_row.released_at > now() - interval '23 hours' then
    raise exception 'CHECK 3 FAILED: a later write moved released_at to % — the stamp must be the moment money moved, once', v_row.released_at;
  end if;

  -- CHECK 3b — each guard ALONE holds (security review: the case above needs
  -- both broken to fail). The "only while null" guard on a REAL change of
  -- status: a superseded row already carrying refunded_at keeps it.
  insert into public.payments
    (post_id, stripe_payment_intent_id, status, amount_pence, captured_at, superseded_at, refunded_at)
  values
    ('a1a1a1a1-0000-0000-0000-000000000007', 'pi_moment_preset', 'superseded', 25000,
     now() - interval '9 days', now() - interval '3 days', now() - interval '2 days')
  returning id into v_pay;
  update public.payments set status = 'refunded' where id = v_pay;
  select refunded_at into v_row from public.payments where id = v_pay;
  if v_row.refunded_at > now() - interval '47 hours' then
    raise exception 'CHECK 3b FAILED: a real change of status moved an existing refunded_at';
  end if;
  -- …and the "real change" guard: a same-status replay stamps nothing.
  update public.payments set released_at = null
   where stripe_payment_intent_id = 'pi_moment_1';
  update public.payments set status = 'released'
   where stripe_payment_intent_id = 'pi_moment_1';
  select released_at into v_row from public.payments where stripe_payment_intent_id = 'pi_moment_1';
  if v_row.released_at is not null then
    raise exception 'CHECK 3b FAILED: a same-status replay stamped released_at';
  end if;

  -- CHECK 4 — refunded stamps refunded_at, on an update AND on an insert.
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, captured_at)
  values ('a1a1a1a1-0000-0000-0000-000000000004', 'pi_moment_2', 'held', 25000, now() - interval '5 days')
  returning id into v_pay;
  update public.payments set status = 'refunded', refunded_amount_pence = 24605 where id = v_pay;
  select refunded_at into v_row from public.payments where id = v_pay;
  if v_row.refunded_at is null then
    raise exception 'CHECK 4 FAILED: the move to refunded stamped no refunded_at';
  end if;

  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, captured_at, refunded_amount_pence)
  values ('a1a1a1a1-0000-0000-0000-000000000006', 'pi_moment_3', 'refunded', 25000, now() - interval '5 days', 24605)
  returning id into v_pay;
  select refunded_at into v_row from public.payments where id = v_pay;
  if v_row.refunded_at is null then
    raise exception 'CHECK 4 FAILED: a payment inserted as refunded carries no refunded_at';
  end if;

  -- CHECK 4b — the renewal route, through the REAL writer: a superseded
  -- reward refunded by reconcile_payment_refund is stamped too.
  insert into public.payments
    (post_id, stripe_payment_intent_id, status, amount_pence, captured_at, superseded_at)
  values
    ('a1a1a1a1-0000-0000-0000-000000000008', 'pi_moment_superseded', 'superseded', 25000,
     now() - interval '20 days', now() - interval '1 day')
  returning id into v_pay;
  perform public.reconcile_payment_refund('pi_moment_superseded', 're_moment_superseded', 24605);
  select status, refunded_at into v_row from public.payments where id = v_pay;
  if v_row.status <> 'refunded' or v_row.refunded_at is null then
    raise exception 'CHECK 4b FAILED: superseded → refunded via reconcile_payment_refund left status % / refunded_at %',
      v_row.status, v_row.refunded_at;
  end if;

  raise notice 'money moments CHECKS 1-4 passed';
end $$;

-- -----------------------------------------------------------------------------
-- CHECKS 5–8 — the owner's read. Post …0005 belongs to 3333…: a reward that
-- was renewed (the old one superseded), the new one held under a refund hold,
-- a credited sighting, an open dispute, plus a £5 fee and an untaken intent
-- that must not appear.
-- -----------------------------------------------------------------------------
do $$
declare
  v_post     uuid := 'a1a1a1a1-0000-0000-0000-000000000005';
  v_owner    uuid := '33333333-3333-3333-3333-333333333333';
  v_sighting uuid := 'e1e1e1e1-0000-0000-0000-000000000005';
  v_old      uuid;
  v_new      uuid;
  v_json     jsonb;
  v_reward   jsonb;
  v_caught   boolean := false;
begin
  update public.posts set status = 'recovery_claimed' where id = v_post;

  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, captured_at, superseded_at)
  values (v_post, 'pi_tl_old', 'superseded', 20000, now() - interval '40 days', now() - interval '5 days')
  returning id into v_old;
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, captured_at, term_ends_at)
  values (v_post, 'pi_tl_new', 'held', 30000, now() - interval '5 days', now() + interval '55 days')
  returning id into v_new;
  -- Not rewards: a listing fee, and an intent never paid.
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
  values (v_post, 'pi_tl_fee', 'collected', 500, 'listing_fee');
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
  values (v_post, 'pi_tl_unpaid', 'requires_payment', 30000);

  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable, credited_at)
  values (v_sighting, v_post, '44444444-4444-4444-4444-444444444444', 'credited', 'Camden', true, now() - interval '1 day');
  insert into public.refund_holds (post_id, owner_id, exit_path, sighting_ids, expires_at, payment_id)
  values (v_post, v_owner, 'deactivate', array[v_sighting], now() + interval '2 days', v_new);
  insert into public.refund_disputes (post_id, sighting_id, spotter_id, status, statement)
  values (v_post, v_sighting, '44444444-4444-4444-4444-444444444444', 'open', 'It was me who found it');

  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  v_json := public.get_my_reward_timeline(v_post);

  -- CHECK 5 — their rewards, oldest first, with what the timeline needs.
  if jsonb_array_length(v_json -> 'rewards') <> 2 then
    raise exception 'CHECK 5/6 FAILED: % rewards, expected the 2 escrow payments taken', jsonb_array_length(v_json -> 'rewards');
  end if;
  if v_json -> 'rewards' -> 0 ->> 'status' <> 'superseded'
     or v_json -> 'rewards' -> 1 ->> 'status' <> 'held' then
    raise exception 'CHECK 5 FAILED: rewards are not oldest first: %', v_json -> 'rewards';
  end if;
  v_reward := v_json -> 'rewards' -> 1;
  if (v_reward ->> 'amountPence')::int <> 30000
     or v_reward ->> 'termEndsAt' is null
     or v_reward ->> 'holdUntil' is null
     or v_reward ->> 'holdReason' <> 'deactivate' then
    raise exception 'CHECK 5 FAILED: the held reward lacks its amount, term or hold: %', v_reward;
  end if;
  if v_json -> 'rewards' -> 0 ->> 'supersededAt' is null then
    raise exception 'CHECK 5 FAILED: the renewed reward lost its supersededAt';
  end if;
  if v_json ->> 'creditedAt' is null or (v_json ->> 'disputeOpen')::boolean is not true then
    raise exception 'CHECK 5 FAILED: creditedAt % / disputeOpen % missing', v_json ->> 'creditedAt', v_json ->> 'disputeOpen';
  end if;
  if v_json ->> 'postStatus' <> 'recovery_claimed' then
    raise exception 'CHECK 5 FAILED: postStatus %', v_json ->> 'postStatus';
  end if;

  -- CHECK 7 — ⚠️ nothing that identifies a spotter, and no transfer split.
  if v_json::text ~* '44444444|e1e1e1e1|It was me|spotter|payee|transfer|sighting_id|statement' then
    raise exception 'CHECK 7 FAILED: the owner''s timeline carries spotter or payout detail: %', v_json;
  end if;
  if (select count(*) from jsonb_object_keys(v_reward)) <> 10 then
    raise exception 'CHECK 7 FAILED: a reward''s fields widened beyond the ten it was built with: %', v_reward;
  end if;
  -- …and the top level is exactly these four: a new key carrying a hold or
  -- dispute id (random uuids, which the pattern above would miss) fails here.
  if array(select jsonb_object_keys(v_json) order by 1)
     <> array['creditedAt', 'disputeOpen', 'postStatus', 'rewards'] then
    raise exception 'CHECK 7 FAILED: the timeline''s top level widened: %',
      array(select jsonb_object_keys(v_json) order by 1);
  end if;

  -- CHECK 8 — ⚠️ anyone else: POST_NOT_FOUND, the same as a missing post.
  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
  begin
    perform public.get_my_reward_timeline(v_post);
  exception when others then
    v_caught := sqlerrm like '%POST_NOT_FOUND%';
  end;
  if not v_caught then
    raise exception 'CHECK 8 FAILED: the credited spotter read the owner''s reward timeline';
  end if;

  -- The same refusal for a post that doesn't exist — so neither is an oracle
  -- for the other — even asked by a real owner.
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  v_caught := false;
  begin
    perform public.get_my_reward_timeline(gen_random_uuid());
  exception when others then
    v_caught := sqlerrm like '%POST_NOT_FOUND%';
  end;
  if not v_caught then
    raise exception 'CHECK 8 FAILED: a missing post did not read as POST_NOT_FOUND';
  end if;

  -- And nobody signed in: NOT_AUTHENTICATED.
  perform set_config('request.jwt.claims', '', true);
  v_caught := false;
  begin
    perform public.get_my_reward_timeline(v_post);
  exception when others then
    v_caught := sqlerrm like '%NOT_AUTHENTICATED%';
  end;
  if not v_caught then
    raise exception 'CHECK 8 FAILED: a caller with no session was not refused NOT_AUTHENTICATED';
  end if;

  raise notice 'reward timeline CHECKS 5-8 passed';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 9 — grants. Anon never reaches it; the stamp trigger function is not
-- callable by clients.
-- -----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.get_my_reward_timeline(uuid)', 'execute') then
    raise exception 'CHECK 9 FAILED: anon can execute get_my_reward_timeline';
  end if;
  if not has_function_privilege('authenticated', 'public.get_my_reward_timeline(uuid)', 'execute') then
    raise exception 'CHECK 9 FAILED: authenticated cannot execute get_my_reward_timeline';
  end if;
  if has_function_privilege('authenticated', 'public.stamp_payment_money_moment()', 'execute') then
    raise exception 'CHECK 9 FAILED: clients can call the stamp trigger function';
  end if;
  raise notice 'reward timeline CHECK 9 passed';
end $$;

rollback;
