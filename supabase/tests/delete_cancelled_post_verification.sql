-- =============================================================================
-- Cancelled-post DELETE + retention verification (NOT a migration — do not
-- place in migrations/).
--
-- SELF-ASSERTING: every check is a seeded begin…rollback block that RAISES
-- EXCEPTION on failure, so the whole file aborts non-zero the moment a MONEY-
-- STATE safety property is violated. Tier 1 properties (docs/TESTING.md): the
-- ledger row always survives a post delete (detached, never deleted), money
-- still moving blocks the delete, retention respects the same guards, and
-- clients can never execute either function.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset
--     psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/delete_cancelled_post_verification.sql
--
-- Fixtures: cancelled posts owned by seed profile 11111111-… (Alex Mercer),
-- spotter 22222222-…, seeded inside each begin…rollback block. Nothing
-- persists. Functions under test (20260921100000_a_cancelled_post_can_be_
-- deleted.sql + 20260921110000_sighting_photos_join_the_orphan_queue.sql):
-- delete_cancelled_post(post_id, owner_id, cancelled_intent_ids),
-- purge_cancelled_posts(), sighting_photos_enqueue_orphan.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — the bounty path: a cancelled post with a REFUNDED escrow row
-- deletes; the post (and its sightings) go, the ledger row SURVIVES with
-- post_id detached and post_snapshot carrying the post's identity.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('dcdcdcdc-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'cancelled', 25000, 'DC11 DEL');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('dcdcdcdc-0000-0000-0000-000000000001', 'pi_del_1', 'refunded', 25000);
insert into public.sightings (post_id, spotter_id, status, area_label, location_unavailable)
values ('dcdcdcdc-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222', 'unverified', 'Ancoats', true);

do $$
declare
  v_pay public.payments%rowtype;
begin
  perform public.delete_cancelled_post(
    'dcdcdcdc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '{}'::text[]);

  if exists (select 1 from public.posts where id = 'dcdcdcdc-0000-0000-0000-000000000001') then
    raise exception 'CHECK 1 FAILED: the post still exists';
  end if;
  if exists (select 1 from public.sightings
             where post_id = 'dcdcdcdc-0000-0000-0000-000000000001') then
    raise exception 'CHECK 1 FAILED: sightings did not cascade';
  end if;

  select * into v_pay from public.payments where stripe_payment_intent_id = 'pi_del_1';
  if not found then
    raise exception 'CHECK 1 FAILED: the ledger row was DELETED — money that moved lost its record';
  end if;
  if v_pay.post_id is not null then
    raise exception 'CHECK 1 FAILED: the ledger row still references the deleted post';
  end if;
  if v_pay.post_snapshot ->> 'post_id' <> 'dcdcdcdc-0000-0000-0000-000000000001'
     or v_pay.post_snapshot ->> 'plate' <> 'DC11 DEL' then
    raise exception 'CHECK 1 FAILED: post_snapshot does not identify the deleted post (got %)',
      v_pay.post_snapshot;
  end if;
  raise notice 'CHECK 1 passed: delete detaches the refunded ledger row and removes the post';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 — the fee path: a cancelled FREE listing (fee COLLECTED, no bounty)
-- deletes the same way; the fee row survives detached.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('dcdcdcdc-0000-0000-0000-000000000002',
        '11111111-1111-1111-1111-111111111111', 'cancelled', null, 'DC12 DEL');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
values ('dcdcdcdc-0000-0000-0000-000000000002', 'pi_del_2', 'collected', 500, 'listing_fee');

do $$
declare
  v_pay public.payments%rowtype;
begin
  perform public.delete_cancelled_post(
    'dcdcdcdc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '{}'::text[]);

  if exists (select 1 from public.posts where id = 'dcdcdcdc-0000-0000-0000-000000000002') then
    raise exception 'CHECK 2 FAILED: the fee post still exists';
  end if;
  select * into v_pay from public.payments where stripe_payment_intent_id = 'pi_del_2';
  if not found or v_pay.post_id is not null then
    raise exception 'CHECK 2 FAILED: the collected fee row was deleted or still attached';
  end if;
  raise notice 'CHECK 2 passed: a collected fee row survives its post, detached';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — NOT_OWNER: a stranger's id (and a missing post) both refuse with
-- the same code, and nothing moves.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('dcdcdcdc-0000-0000-0000-000000000003',
        '11111111-1111-1111-1111-111111111111', 'cancelled', 25000, 'DC13 DEL');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('dcdcdcdc-0000-0000-0000-000000000003', 'pi_del_3', 'refunded', 25000);

do $$
begin
  begin
    perform public.delete_cancelled_post(
      'dcdcdcdc-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', '{}'::text[]);
    raise exception 'CHECK 3 FAILED: a stranger deleted someone else''s post';
  exception when others then
    if sqlerrm <> 'NOT_OWNER' then raise; end if;
  end;
  begin
    perform public.delete_cancelled_post(
      'dcdcdcdc-0000-0000-0000-0000000000ff', '11111111-1111-1111-1111-111111111111', '{}'::text[]);
    raise exception 'CHECK 3 FAILED: deleting a missing post did not refuse';
  exception when others then
    -- Same code as "not yours": a post id must never be an existence oracle.
    if sqlerrm <> 'NOT_OWNER' then raise; end if;
  end;
  if not exists (select 1 from public.posts where id = 'dcdcdcdc-0000-0000-0000-000000000003') then
    raise exception 'CHECK 3 FAILED: the refused delete removed the post anyway';
  end if;
  raise notice 'CHECK 3 passed: NOT_OWNER for a stranger and for a missing post alike';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 — NOT_CANCELLED: a live post refuses, whoever asks. Deactivation is
-- the only door to deletion.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('dcdcdcdc-0000-0000-0000-000000000004',
        '11111111-1111-1111-1111-111111111111', 'active', 25000, 'DC14 DEL');

do $$
begin
  begin
    perform public.delete_cancelled_post(
      'dcdcdcdc-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '{}'::text[]);
    raise exception 'CHECK 4 FAILED: an ACTIVE post was deleted';
  exception when others then
    if sqlerrm <> 'NOT_CANCELLED' then raise; end if;
  end;
  raise notice 'CHECK 4 passed: only a cancelled post can be deleted';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 — MONEY_IN_FLIGHT: a HELD escrow row (a refund hold mid-window, or
-- any unsettled charge) blocks the delete, and the ledger row is NOT detached
-- by the refused attempt.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('dcdcdcdc-0000-0000-0000-000000000005',
        '11111111-1111-1111-1111-111111111111', 'cancelled', 25000, 'DC15 DEL');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('dcdcdcdc-0000-0000-0000-000000000005', 'pi_del_5', 'held', 25000);

do $$
declare
  v_pay public.payments%rowtype;
begin
  begin
    perform public.delete_cancelled_post(
      'dcdcdcdc-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '{}'::text[]);
    raise exception 'CHECK 5 FAILED: a post with HELD escrow was deleted';
  exception when others then
    if sqlerrm <> 'MONEY_IN_FLIGHT' then raise; end if;
  end;
  select * into v_pay from public.payments where stripe_payment_intent_id = 'pi_del_5';
  if v_pay.post_id is null or v_pay.post_snapshot is not null then
    raise exception 'CHECK 5 FAILED: the refused delete detached the held ledger row';
  end if;
  raise notice 'CHECK 5 passed: held escrow blocks the delete and nothing detaches';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 6 — an UNEXPIRED refund hold blocks even when the payment has somehow
-- settled: the 72-hour dispute window owns the sightings until it lapses.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('dcdcdcdc-0000-0000-0000-000000000006',
        '11111111-1111-1111-1111-111111111111', 'cancelled', 25000, 'DC16 DEL');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('dcdcdcdc-0000-0000-0000-000000000006', 'pi_del_6', 'refunded', 25000);
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('dcdcdcdc-1111-0000-0000-000000000006', 'dcdcdcdc-0000-0000-0000-000000000006',
        '22222222-2222-2222-2222-222222222222', 'unverified', 'Ancoats', true);
insert into public.refund_holds (post_id, owner_id, exit_path, sighting_ids, expires_at)
values ('dcdcdcdc-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
        'deactivate', array['dcdcdcdc-1111-0000-0000-000000000006']::uuid[],
        now() + interval '48 hours');

do $$
begin
  begin
    perform public.delete_cancelled_post(
      'dcdcdcdc-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '{}'::text[]);
    raise exception 'CHECK 6 FAILED: a post inside its dispute window was deleted';
  exception when others then
    if sqlerrm <> 'MONEY_IN_FLIGHT' then raise; end if;
  end;
  raise notice 'CHECK 6 passed: an open dispute window blocks the delete';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 7 — an OPEN dispute blocks (DISPUTE_OPEN), even after the hold expired.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('dcdcdcdc-0000-0000-0000-000000000007',
        '11111111-1111-1111-1111-111111111111', 'cancelled', 25000, 'DC17 DEL');
-- Refunded, not held, so the DISPUTE guard is the ONLY thing refusing — a
-- held row would trip MONEY_IN_FLIGHT first and leave this guard untested.
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('dcdcdcdc-0000-0000-0000-000000000007', 'pi_del_7', 'refunded', 25000);
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('dcdcdcdc-1111-0000-0000-000000000007', 'dcdcdcdc-0000-0000-0000-000000000007',
        '22222222-2222-2222-2222-222222222222', 'unverified', 'Ancoats', true);
insert into public.refund_holds (post_id, owner_id, exit_path, sighting_ids, expires_at)
values ('dcdcdcdc-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
        'deactivate', array['dcdcdcdc-1111-0000-0000-000000000007']::uuid[],
        now() - interval '1 hour');
insert into public.refund_disputes (post_id, sighting_id, spotter_id, status)
values ('dcdcdcdc-0000-0000-0000-000000000007', 'dcdcdcdc-1111-0000-0000-000000000007',
        '22222222-2222-2222-2222-222222222222', 'open');

do $$
begin
  begin
    perform public.delete_cancelled_post(
      'dcdcdcdc-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', '{}'::text[]);
    raise exception 'CHECK 7 FAILED: a post with an OPEN dispute was deleted';
  exception when others then
    if sqlerrm <> 'DISPUTE_OPEN' then raise; end if;
  end;
  raise notice 'CHECK 7 passed: an open dispute blocks the delete';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 8 — a SETTLED hold (expired, dispute rejected) no longer blocks: the
-- delete goes through, the hold + dispute are archived into post_snapshot and
-- their rows removed — including the dispute whose sighting FK would otherwise
-- veto the sightings cascade.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('dcdcdcdc-0000-0000-0000-000000000008',
        '11111111-1111-1111-1111-111111111111', 'cancelled', 25000, 'DC18 DEL');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('dcdcdcdc-0000-0000-0000-000000000008', 'pi_del_8', 'refunded', 25000);
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('dcdcdcdc-1111-0000-0000-000000000008', 'dcdcdcdc-0000-0000-0000-000000000008',
        '22222222-2222-2222-2222-222222222222', 'unverified', 'Ancoats', true);
insert into public.refund_holds (post_id, owner_id, exit_path, sighting_ids, expires_at)
values ('dcdcdcdc-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
        'deactivate', array['dcdcdcdc-1111-0000-0000-000000000008']::uuid[],
        now() - interval '10 days');
insert into public.refund_disputes (post_id, sighting_id, spotter_id, status, resolved_at)
values ('dcdcdcdc-0000-0000-0000-000000000008', 'dcdcdcdc-1111-0000-0000-000000000008',
        '22222222-2222-2222-2222-222222222222', 'rejected', now() - interval '9 days');

do $$
declare
  v_pay public.payments%rowtype;
begin
  perform public.delete_cancelled_post(
    'dcdcdcdc-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', '{}'::text[]);

  if exists (select 1 from public.posts where id = 'dcdcdcdc-0000-0000-0000-000000000008') then
    raise exception 'CHECK 8 FAILED: the post survived a settled-hold delete';
  end if;
  if exists (select 1 from public.refund_holds
             where post_id = 'dcdcdcdc-0000-0000-0000-000000000008')
     or exists (select 1 from public.refund_disputes
             where post_id = 'dcdcdcdc-0000-0000-0000-000000000008') then
    raise exception 'CHECK 8 FAILED: hold/dispute rows survived the delete';
  end if;

  select * into v_pay from public.payments where stripe_payment_intent_id = 'pi_del_8';
  if v_pay.post_snapshot -> 'refund_hold' ->> 'exit_path' <> 'deactivate' then
    raise exception 'CHECK 8 FAILED: the hold was not archived into post_snapshot (got %)',
      v_pay.post_snapshot -> 'refund_hold';
  end if;
  if jsonb_array_length(v_pay.post_snapshot -> 'refund_disputes') <> 1
     or v_pay.post_snapshot -> 'refund_disputes' -> 0 ->> 'status' <> 'rejected' then
    raise exception 'CHECK 8 FAILED: the rejected dispute was not archived (got %)',
      v_pay.post_snapshot -> 'refund_disputes';
  end if;
  raise notice 'CHECK 8 passed: a settled hold is archived into the snapshot and the post deletes';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 9 — RETENTION: purge_cancelled_posts deletes the 31-days-closed post,
-- keeps the 5-days-closed one, SKIPS (without raising) a 31-days-closed post
-- whose escrow is still held, and reports exactly what it deleted.
-- -----------------------------------------------------------------------------
begin;
-- 31 days closed, settled → should purge. (closed_at supplied on INSERT is
-- honoured by posts_set_closed_at for server-side back-dated fixtures.)
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, closed_at)
values ('dcdcdcdc-0000-0000-0000-000000000009',
        '11111111-1111-1111-1111-111111111111', 'cancelled', 25000, 'DC19 DEL',
        now() - interval '31 days');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('dcdcdcdc-0000-0000-0000-000000000009', 'pi_del_9a', 'refunded', 25000);
-- 5 days closed → inside the tombstone window, must stay.
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, closed_at)
values ('dcdcdcdc-0000-0000-0000-00000000000a',
        '11111111-1111-1111-1111-111111111111', 'cancelled', 25000, 'DC20 DEL',
        now() - interval '5 days');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('dcdcdcdc-0000-0000-0000-00000000000a', 'pi_del_9b', 'refunded', 25000);
-- 31 days closed but escrow still HELD → the guard skips it, the run continues.
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, closed_at)
values ('dcdcdcdc-0000-0000-0000-00000000000b',
        '11111111-1111-1111-1111-111111111111', 'cancelled', 25000, 'DC21 DEL',
        now() - interval '31 days');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('dcdcdcdc-0000-0000-0000-00000000000b', 'pi_del_9c', 'held', 25000);

do $$
declare
  v_result jsonb;
begin
  select public.purge_cancelled_posts() into v_result;

  if exists (select 1 from public.posts where id = 'dcdcdcdc-0000-0000-0000-000000000009') then
    raise exception 'CHECK 9 FAILED: the 31-day settled post was not purged';
  end if;
  if not exists (select 1 from public.posts where id = 'dcdcdcdc-0000-0000-0000-00000000000a') then
    raise exception 'CHECK 9 FAILED: the 5-day post was purged inside the tombstone window';
  end if;
  if not exists (select 1 from public.posts where id = 'dcdcdcdc-0000-0000-0000-00000000000b') then
    raise exception 'CHECK 9 FAILED: a post with HELD escrow was purged by retention';
  end if;
  -- Exactly ONE fixture purged and ONE skipped. Seed data cannot add to the
  -- counts (purging requires closed_at 30+ days old, and the freshly-reset
  -- seed has no such posts) — but assert >= rather than = so a future seed
  -- change reads as a seed change, not as a retention bug.
  if coalesce((v_result ->> 'purged')::integer, 0) < 1 then
    raise exception 'CHECK 9 FAILED: purge reported % (expected purged >= 1)', v_result;
  end if;
  -- The skip must be COUNTED, not just tolerated: the sweep summary is the
  -- only place a permanently blocked post is ever visible.
  if coalesce((v_result ->> 'skipped')::integer, 0) < 1 then
    raise exception 'CHECK 9 FAILED: the blocked post was not counted as skipped (got %)', v_result;
  end if;
  raise notice 'CHECK 9 passed: retention purges at 31 days, keeps at 5, skips + counts held escrow';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 10 — GRANTS: neither function is executable by anon or authenticated.
-- delete_cancelled_post's ownership proof lives in the Edge Function's JWT
-- check; purge_cancelled_posts checks nothing at all — client-executable would
-- mean any signed-in user could mass-delete cancelled posts.
-- -----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated', 'public.delete_cancelled_post(uuid, uuid, text[])', 'execute')
     or has_function_privilege('anon', 'public.delete_cancelled_post(uuid, uuid, text[])', 'execute') then
    raise exception 'CHECK 10 FAILED: delete_cancelled_post is client-executable';
  end if;
  if has_function_privilege('authenticated', 'public.purge_cancelled_posts()', 'execute')
     or has_function_privilege('anon', 'public.purge_cancelled_posts()', 'execute') then
    raise exception 'CHECK 10 FAILED: purge_cancelled_posts is client-executable';
  end if;
  if not has_function_privilege('service_role', 'public.delete_cancelled_post(uuid, uuid, text[])', 'execute')
     or not has_function_privilege('service_role', 'public.purge_cancelled_posts()', 'execute') then
    raise exception 'CHECK 10 FAILED: service_role cannot execute the delete path';
  end if;
  raise notice 'CHECK 10 passed: service_role only, both functions';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 11 — THE PROOF RULE (20260816110000, applied here): a cancelled post
-- carrying a stray 'failed' row (a bounty edit superseded its intent before
-- the real payment) refuses with INTENT_NOT_CANCELLED on an empty proof list,
-- and deletes when the proof names that intent — the failed row is DELETED
-- (money never moved), the refunded row is DETACHED (money did).
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('dcdcdcdc-0000-0000-0000-00000000000c',
        '11111111-1111-1111-1111-111111111111', 'cancelled', 25000, 'DC22 DEL');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('dcdcdcdc-0000-0000-0000-00000000000c', 'pi_del_11_live', 'refunded', 25000),
       ('dcdcdcdc-0000-0000-0000-00000000000c', 'pi_del_11_stray', 'failed', 25000);

do $$
declare
  v_pay public.payments%rowtype;
begin
  -- Unproven: the stray row is not named, so the delete must not happen.
  begin
    perform public.delete_cancelled_post(
      'dcdcdcdc-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', '{}'::text[]);
    raise exception 'CHECK 11 FAILED: deleted despite an unproven failed intent';
  exception when others then
    if sqlerrm <> 'INTENT_NOT_CANCELLED' then raise; end if;
  end;
  if not exists (select 1 from public.posts where id = 'dcdcdcdc-0000-0000-0000-00000000000c') then
    raise exception 'CHECK 11 FAILED: the refused delete removed the post anyway';
  end if;

  -- Proven: the caller watched pi_del_11_stray die at Stripe.
  perform public.delete_cancelled_post(
    'dcdcdcdc-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
    array['pi_del_11_stray']);

  if exists (select 1 from public.posts where id = 'dcdcdcdc-0000-0000-0000-00000000000c') then
    raise exception 'CHECK 11 FAILED: the proven delete did not remove the post';
  end if;
  if exists (select 1 from public.payments where stripe_payment_intent_id = 'pi_del_11_stray') then
    raise exception 'CHECK 11 FAILED: the proven-dead failed row was kept (it should be deleted — money never moved)';
  end if;
  select * into v_pay from public.payments where stripe_payment_intent_id = 'pi_del_11_live';
  if not found or v_pay.post_id is not null then
    raise exception 'CHECK 11 FAILED: the refunded row was deleted or still attached';
  end if;
  raise notice 'CHECK 11 passed: stray intents need Stripe proof; proven ones delete, moved money detaches';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 12 — payout_reviews: an UNRESOLVED review blocks (PAYMENT_REVIEW_OPEN);
-- a RESOLVED one does not — it is archived into post_snapshot and its row
-- removed (its FK is ON DELETE RESTRICT, so keeping it would veto the delete).
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('dcdcdcdc-0000-0000-0000-00000000000d',
        '11111111-1111-1111-1111-111111111111', 'cancelled', 25000, 'DC23 DEL');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('dcdcdcdc-0000-0000-0000-00000000000d', 'pi_del_12', 'refunded', 25000);
insert into public.payout_reviews (post_id, owner_id, spotter_id, reasons)
values ('dcdcdcdc-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222', array['shared_device']);

do $$
declare
  v_pay public.payments%rowtype;
begin
  begin
    perform public.delete_cancelled_post(
      'dcdcdcdc-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', '{}'::text[]);
    raise exception 'CHECK 12 FAILED: deleted under an UNRESOLVED payout review';
  exception when others then
    if sqlerrm <> 'PAYMENT_REVIEW_OPEN' then raise; end if;
  end;

  update public.payout_reviews
     set resolution = 'approved', resolved_at = now()
   where post_id = 'dcdcdcdc-0000-0000-0000-00000000000d';

  perform public.delete_cancelled_post(
    'dcdcdcdc-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', '{}'::text[]);

  if exists (select 1 from public.posts where id = 'dcdcdcdc-0000-0000-0000-00000000000d') then
    raise exception 'CHECK 12 FAILED: a resolved review still blocked the delete';
  end if;
  if exists (select 1 from public.payout_reviews
             where post_id = 'dcdcdcdc-0000-0000-0000-00000000000d') then
    raise exception 'CHECK 12 FAILED: the resolved review row survived (its RESTRICT FK should have required removal)';
  end if;
  select * into v_pay from public.payments where stripe_payment_intent_id = 'pi_del_12';
  if v_pay.post_snapshot -> 'payout_review' ->> 'resolution' <> 'approved' then
    raise exception 'CHECK 12 FAILED: the review was not archived into post_snapshot (got %)',
      v_pay.post_snapshot -> 'payout_review';
  end if;
  raise notice 'CHECK 12 passed: unresolved review blocks; resolved review archives and deletes';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 13 — STORAGE FOLLOWS: deleting a cancelled post cascades its sighting
-- photos, and the 20260921110000 trigger queues each path so the sweep can
-- remove the bytes from the private bucket. Without this, every routine post
-- delete would strand spotter JPEGs forever.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('dcdcdcdc-0000-0000-0000-00000000000e',
        '11111111-1111-1111-1111-111111111111', 'cancelled', 25000, 'DC24 DEL');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('dcdcdcdc-0000-0000-0000-00000000000e', 'pi_del_13', 'refunded', 25000);
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('dcdcdcdc-1111-0000-0000-00000000000e', 'dcdcdcdc-0000-0000-0000-00000000000e',
        '22222222-2222-2222-2222-222222222222', 'unverified', 'Ancoats', true);
insert into public.sighting_photos (sighting_id, path, captured_at, position)
values ('dcdcdcdc-1111-0000-0000-00000000000e',
        'dcdcdcdc-0000-0000-0000-00000000000e/22222222-2222-2222-2222-222222222222/check13.jpg',
        now(), 0);

do $$
begin
  perform public.delete_cancelled_post(
    'dcdcdcdc-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111', '{}'::text[]);

  if not exists (
    select 1 from public.orphaned_sighting_photos
    where path = 'dcdcdcdc-0000-0000-0000-00000000000e/22222222-2222-2222-2222-222222222222/check13.jpg'
  ) then
    raise exception 'CHECK 13 FAILED: the cascaded sighting photo was not queued — its bytes would be stranded';
  end if;
  raise notice 'CHECK 13 passed: cascaded sighting photos are queued for the storage sweep';
end $$;
rollback;
