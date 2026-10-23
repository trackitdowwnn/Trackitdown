-- =============================================================================
-- WHAT:  Verification for 20261023120000_an_account_can_be_deleted.sql. NOT a
--        migration.
-- WHY:   Deletion used to FAIL for anyone with money history (RESTRICT FKs),
--        with only "try again" to show. These prove the account now goes —
--        auth row and all — while the money records stay, detached from the
--        person; and that every reason it can't go yet is named.
--
-- CHECKS: 1 ⚠️ an OWNER with refunded + collected payments, an expired hold, a
-- settled dispute and review, and a stray unpaid draft: deleted; ledger rows
-- survive detached with a post_snapshot; the proved stray is gone · 2 ⚠️ a
-- SPOTTER paid a reward, with a settled review and dispute on someone else's
-- listing: deleted; their sightings go in the data step itself; the payment
-- keeps the record (payee_snapshot), the review and dispute stay anonymised
-- (statement cleared), the other owner's listing is untouched ·
-- 3 each blocker — LIVE_LISTING, MONEY_HELD, REWARD_ON_ITS_WAY, DISPUTE_OPEN,
-- REVIEW_OPEN — named by account_deletion_blockers() for the caller and
-- refused by delete_account_data; 3f ⚠️ an UPHELD (settled) dispute blocks
-- neither side; 3a LIVE_LISTING = a live listing HOLDING reward money (not also
-- MONEY_HELD) or a claimed recovery · 6 ⚠️ a live listing with NO money held —
-- free, abandoned reward attempts, a lapsed reward — goes with the account once
-- the attempts are proved dead (20261023140000) · 4 an unproven stray intent refuses
-- (INTENT_NOT_CANCELLED) · 5 who may call what.
-- HOW:   Self-asserting, RAISE on failure (CI's db job). Each check seeds its
--        own users and rows inside begin…rollback; nothing persists. The auth
--        row is deleted the way delete-account's admin call does (a row
--        delete), so the cascade is proven too.
-- LINKS: supabase/migrations/20261023120000_an_account_can_be_deleted.sql;
--        supabase/migrations/20261023140000_a_listing_without_money_goes_with_its_account.sql.
-- =============================================================================

-- A throwaway user (auth row + profile), as seed.sql makes them.
create or replace function pg_temp.make_user(p_id uuid)
returns void language plpgsql as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    'acct-del-' || left(p_id::text, 8) || '-' || right(p_id::text, 4) || '@trackitdown.test', '',
    now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''
  );
  insert into public.profiles (id, display_name, first_name)
  values (p_id, 'Test', 'Test')
  on conflict (id) do nothing;
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 1 — an owner with full money history goes; the money records stay.
-- -----------------------------------------------------------------------------
begin;
select pg_temp.make_user('ad000000-0000-0000-0000-00000000000a'); -- owner O
select pg_temp.make_user('ad000000-0000-0000-0000-00000000000b'); -- spotter S

insert into public.posts (id, owner_id, status, bounty_amount_pence, plate) values
  ('ad000001-0000-0000-0000-000000000001', 'ad000000-0000-0000-0000-00000000000a', 'cancelled', 25000, 'AD01 ONE'),
  ('ad000001-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-00000000000a', 'expired',   null,  'AD01 TWO'),
  ('ad000001-0000-0000-0000-000000000003', 'ad000000-0000-0000-0000-00000000000a', 'draft',     25000, 'AD01 DRF');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind) values
  ('ad000001-0000-0000-0000-000000000001', 'pi_acctdel_1', 'refunded',  25000, 'bounty_escrow'),
  ('ad000001-0000-0000-0000-000000000002', 'pi_acctdel_2', 'collected', 500,   'listing_fee'),
  ('ad000001-0000-0000-0000-000000000003', 'pi_acctdel_3', 'requires_payment', 25000, 'bounty_escrow');
-- An expired refund hold on the refunded post.
insert into public.refund_holds (post_id, owner_id, payment_id, exit_path, system_initiated, sighting_ids, expires_at)
select 'ad000001-0000-0000-0000-000000000001', 'ad000000-0000-0000-0000-00000000000a', id,
       'deactivate', true, '{}'::uuid[], now() - interval '1 day'
  from public.payments where stripe_payment_intent_id = 'pi_acctdel_1';
-- A settled dispute and an approved review by S on O's expired listing.
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('ad000002-0000-0000-0000-000000000002', 'ad000001-0000-0000-0000-000000000002',
        'ad000000-0000-0000-0000-00000000000b', 'unverified', 'Ancoats', true);
insert into public.refund_disputes (post_id, sighting_id, spotter_id, status, resolved_at)
values ('ad000001-0000-0000-0000-000000000002', 'ad000002-0000-0000-0000-000000000002',
        'ad000000-0000-0000-0000-00000000000b', 'rejected', now());
insert into public.payout_reviews (post_id, owner_id, spotter_id, reasons, resolution, resolved_at)
values ('ad000001-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-00000000000a',
        'ad000000-0000-0000-0000-00000000000b', array['shared_device'], 'approved', now());

do $$
declare
  v_summary jsonb;
begin
  -- The stray draft intent is proved dead, as delete-account proves it at Stripe.
  v_summary := public.delete_account_data('ad000000-0000-0000-0000-00000000000a', array['pi_acctdel_3']);
  if (v_summary ->> 'posts_deleted')::int <> 3 then
    raise exception 'CHECK 1 FAILED: expected 3 listings deleted, got %', v_summary;
  end if;

  -- The auth row goes, and with it everything that cascades — no FK refuses.
  delete from auth.users where id = 'ad000000-0000-0000-0000-00000000000a';

  if exists (select 1 from public.profiles where id = 'ad000000-0000-0000-0000-00000000000a')
     or exists (select 1 from public.posts where owner_id = 'ad000000-0000-0000-0000-00000000000a') then
    raise exception 'CHECK 1 FAILED: the owner''s profile or listings survived';
  end if;

  -- Money that moved: kept, detached, with the snapshot naming the old post.
  if (select count(*) from public.payments
       where stripe_payment_intent_id in ('pi_acctdel_1', 'pi_acctdel_2')
         and post_id is null
         and post_snapshot ->> 'owner_id' = 'ad000000-0000-0000-0000-00000000000a') <> 2 then
    raise exception 'CHECK 1 FAILED: a moved-money ledger row was lost or not detached';
  end if;
  -- The settled review and dispute ride in the snapshot, not as live rows.
  if (select post_snapshot -> 'payout_review' ->> 'resolution' from public.payments
       where stripe_payment_intent_id = 'pi_acctdel_2') <> 'approved' then
    raise exception 'CHECK 1 FAILED: the settled payout review was not archived into the snapshot';
  end if;
  -- Money that never moved, proved dead: gone.
  if exists (select 1 from public.payments where stripe_payment_intent_id = 'pi_acctdel_3') then
    raise exception 'CHECK 1 FAILED: the proved stray intent survived';
  end if;
end $$;
rollback;

-- -----------------------------------------------------------------------------
-- CHECK 2 — a spotter who was paid goes; the record of the payout stays.
-- -----------------------------------------------------------------------------
begin;
select pg_temp.make_user('ad000000-0000-0000-0000-00000000000b'); -- spotter S
select pg_temp.make_user('ad000000-0000-0000-0000-00000000000c'); -- another owner X

insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('ad000001-0000-0000-0000-00000000000c', 'ad000000-0000-0000-0000-00000000000c', 'expired', 25000, 'AD02 XXX');
insert into public.stripe_connected_accounts (id, profile_id, stripe_account_id, onboarding_complete, payouts_enabled)
values ('ad000003-0000-0000-0000-00000000000b', 'ad000000-0000-0000-0000-00000000000b', 'acct_acctdel_spotter', true, true);
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind, payee_account_id, stripe_transfer_id)
values ('ad000001-0000-0000-0000-00000000000c', 'pi_acctdel_4', 'released', 25000, 'bounty_escrow',
        'ad000003-0000-0000-0000-00000000000b', 'tr_acctdel_4');
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('ad000002-0000-0000-0000-00000000000c', 'ad000001-0000-0000-0000-00000000000c',
        'ad000000-0000-0000-0000-00000000000b', 'unverified', 'Ancoats', true);
insert into public.refund_disputes (post_id, sighting_id, spotter_id, status, resolved_at, statement)
values ('ad000001-0000-0000-0000-00000000000c', 'ad000002-0000-0000-0000-00000000000c',
        'ad000000-0000-0000-0000-00000000000b', 'rejected', now(), 'I saw it on Great Ancoats St');
insert into public.payout_reviews (post_id, owner_id, spotter_id, reasons, resolution, resolved_at)
values ('ad000001-0000-0000-0000-00000000000c', 'ad000000-0000-0000-0000-00000000000c',
        'ad000000-0000-0000-0000-00000000000b', array['shared_device'], 'approved', now());
-- A listing of X's deleted EARLIER: its dispute and review by S were archived
-- into the ledger snapshot, beside another spotter's (whose words stay).
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind, post_snapshot)
values (null, 'pi_acctdel_5', 'refunded', 25000, 'bounty_escrow', jsonb_build_object(
  'owner_id', 'ad000000-0000-0000-0000-00000000000c',
  'refund_disputes', jsonb_build_array(
    jsonb_build_object('spotter_id', 'ad000000-0000-0000-0000-00000000000b',
                       'sighting_id', 'ad000002-0000-0000-0000-0000000000aa',
                       'statement', 'S''s own words', 'status', 'rejected'),
    jsonb_build_object('spotter_id', 'ad000000-0000-0000-0000-0000000000ee',
                       'sighting_id', 'ad000002-0000-0000-0000-0000000000ab',
                       'statement', 'someone else''s words', 'status', 'rejected')),
  'payout_review', jsonb_build_object('spotter_id', 'ad000000-0000-0000-0000-00000000000b',
                                      'resolution', 'approved')));

do $$
declare
  v_summary jsonb;
  v_snap    jsonb;
begin
  v_summary := public.delete_account_data('ad000000-0000-0000-0000-00000000000b', '{}');

  -- The archived copies lose S too (security re-review M1) — and only S.
  v_snap := (select post_snapshot from public.payments where stripe_payment_intent_id = 'pi_acctdel_5');
  if v_snap::text like '%ad000000-0000-0000-0000-00000000000b%'
     or v_snap::text like '%S''s own words%'
     or v_snap::text like '%ad000002-0000-0000-0000-0000000000aa%' then
    raise exception 'CHECK 2 FAILED: S survives in an archived snapshot: %', v_snap;
  end if;
  if v_snap -> 'refund_disputes' -> 1 ->> 'statement' is distinct from 'someone else''s words'
     or v_snap -> 'refund_disputes' -> 0 ->> 'status' is distinct from 'rejected'
     or v_snap -> 'payout_review' ->> 'resolution' is distinct from 'approved' then
    raise exception 'CHECK 2 FAILED: scrubbing S damaged the rest of the snapshot: %', v_snap;
  end if;

  -- Their sightings go IN the data step, not later with the auth row — so no
  -- owner can credit one in between (security review H2).
  if exists (select 1 from public.sightings where spotter_id = 'ad000000-0000-0000-0000-00000000000b')
     or (v_summary ->> 'sightings_deleted')::int <> 1 then
    raise exception 'CHECK 2 FAILED: the spotter''s sightings outlived the data step: %', v_summary;
  end if;

  delete from auth.users where id = 'ad000000-0000-0000-0000-00000000000b';

  if exists (select 1 from public.stripe_connected_accounts where id = 'ad000003-0000-0000-0000-00000000000b') then
    raise exception 'CHECK 2 FAILED: the spotter''s payout account row survived';
  end if;
  -- The payout: still there, on X's listing, reconcilable by Stripe id.
  if not exists (
    select 1 from public.payments
     where stripe_payment_intent_id = 'pi_acctdel_4'
       and post_id = 'ad000001-0000-0000-0000-00000000000c'
       and payee_account_id is null
       and payee_snapshot ->> 'stripe_account_id' = 'acct_acctdel_spotter'
       and stripe_transfer_id = 'tr_acctdel_4'
  ) then
    raise exception 'CHECK 2 FAILED: the payout record was lost or not detached: %', v_summary;
  end if;
  -- X's records stay, without the spotter.
  if not exists (select 1 from public.payout_reviews
                  where post_id = 'ad000001-0000-0000-0000-00000000000c' and spotter_id is null) then
    raise exception 'CHECK 2 FAILED: the settled review on X''s listing was lost or kept the spotter';
  end if;
  -- …and without their words, marked told so nothing tries to tell them.
  if not exists (select 1 from public.refund_disputes
                  where post_id = 'ad000001-0000-0000-0000-00000000000c'
                    and spotter_id is null and sighting_id is null
                    and statement is null and outcome_notified_at is not null) then
    raise exception 'CHECK 2 FAILED: the settled dispute on X''s listing was lost or kept the spotter';
  end if;
  if not exists (select 1 from public.posts where id = 'ad000001-0000-0000-0000-00000000000c') then
    raise exception 'CHECK 2 FAILED: the other owner''s listing was touched';
  end if;
end $$;
rollback;

-- -----------------------------------------------------------------------------
-- CHECK 3 — every reason it can't go yet: named for the caller, and refused.
-- B is the would-be deleter; X owns the listing the spotter-side cases sit on.
-- -----------------------------------------------------------------------------
create or replace function pg_temp.expect_blocked(p_user uuid, p_code text)
returns void language plpgsql as $$
declare
  v_blockers jsonb;
begin
  -- As the signed-in user: the screen's own call.
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_blockers := public.account_deletion_blockers();
  execute 'reset role';
  if not exists (select 1 from jsonb_array_elements(v_blockers) b where b ->> 'code' = p_code) then
    raise exception 'CHECK 3 FAILED: % not named; blockers were %', p_code, v_blockers;
  end if;
  -- And the deletion itself refuses, naming it.
  begin
    perform public.delete_account_data(p_user, '{}');
    raise exception 'CHECK 3 FAILED: deletion went through despite %', p_code;
  exception
    when raise_exception then
      if sqlerrm not like 'ACCOUNT_BLOCKED:%' || p_code || '%' then
        raise exception 'CHECK 3 FAILED: refused for the wrong reason (%), expected %', sqlerrm, p_code;
      end if;
  end;
end $$;

-- 3a LIVE_LISTING — a live listing HOLDING reward money (20261023140000: a
-- live listing with none goes with the account — CHECK 6).
begin;
select pg_temp.make_user('ad000000-0000-0000-0000-0000000000d1');
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('ad000001-0000-0000-0000-0000000000d1', 'ad000000-0000-0000-0000-0000000000d1', 'active', 25000, 'AD3A LIV');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
values ('ad000001-0000-0000-0000-0000000000d1', 'pi_acctdel_d1', 'held', 25000, 'bounty_escrow');
select pg_temp.expect_blocked('ad000000-0000-0000-0000-0000000000d1', 'LIVE_LISTING');
-- One listing, one reason: its held money isn't ALSO named MONEY_HELD.
do $$
begin
  if exists (select 1 from jsonb_array_elements(
               public.account_deletion_blockers_for('ad000000-0000-0000-0000-0000000000d1')) b
              where b ->> 'code' = 'MONEY_HELD') then
    raise exception 'CHECK 3a FAILED: a live listing''s held money was named twice';
  end if;
end $$;
rollback;

-- 3a' LIVE_LISTING — a claimed recovery blocks even with no money on it.
begin;
select pg_temp.make_user('ad000000-0000-0000-0000-0000000000d6');
insert into public.posts (owner_id, status, bounty_amount_pence, plate)
values ('ad000000-0000-0000-0000-0000000000d6', 'recovery_claimed', null, 'AD3A RCL');
select pg_temp.expect_blocked('ad000000-0000-0000-0000-0000000000d6', 'LIVE_LISTING');
rollback;

-- 3b MONEY_HELD (a cancelled listing whose money is still held)
begin;
select pg_temp.make_user('ad000000-0000-0000-0000-0000000000d2');
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('ad000001-0000-0000-0000-0000000000d2', 'ad000000-0000-0000-0000-0000000000d2', 'cancelled', 25000, 'AD3B HLD');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
values ('ad000001-0000-0000-0000-0000000000d2', 'pi_acctdel_d2', 'held', 25000, 'bounty_escrow');
select pg_temp.expect_blocked('ad000000-0000-0000-0000-0000000000d2', 'MONEY_HELD');
rollback;

-- 3c REWARD_ON_ITS_WAY (their sighting credited on someone else's listing,
-- whose payout hasn't happened yet)
begin;
select pg_temp.make_user('ad000000-0000-0000-0000-0000000000d3');
select pg_temp.make_user('ad000000-0000-0000-0000-0000000000c3');
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('ad000001-0000-0000-0000-0000000000c3', 'ad000000-0000-0000-0000-0000000000c3', 'recovery_claimed', 25000, 'AD3C RWD');
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('ad000002-0000-0000-0000-0000000000d3', 'ad000001-0000-0000-0000-0000000000c3',
        'ad000000-0000-0000-0000-0000000000d3', 'credited', 'Ancoats', true);
select pg_temp.expect_blocked('ad000000-0000-0000-0000-0000000000d3', 'REWARD_ON_ITS_WAY');
rollback;

-- 3d DISPUTE_OPEN (their open dispute on someone else's listing)
begin;
select pg_temp.make_user('ad000000-0000-0000-0000-0000000000d4');
select pg_temp.make_user('ad000000-0000-0000-0000-0000000000c4');
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('ad000001-0000-0000-0000-0000000000c4', 'ad000000-0000-0000-0000-0000000000c4', 'cancelled', 25000, 'AD3D DSP');
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('ad000002-0000-0000-0000-0000000000d4', 'ad000001-0000-0000-0000-0000000000c4',
        'ad000000-0000-0000-0000-0000000000d4', 'unverified', 'Ancoats', true);
insert into public.refund_disputes (post_id, sighting_id, spotter_id, status)
values ('ad000001-0000-0000-0000-0000000000c4', 'ad000002-0000-0000-0000-0000000000d4',
        'ad000000-0000-0000-0000-0000000000d4', 'open');
select pg_temp.expect_blocked('ad000000-0000-0000-0000-0000000000d4', 'DISPUTE_OPEN');
rollback;

-- 3e REVIEW_OPEN (an unresolved payout review involving them)
begin;
select pg_temp.make_user('ad000000-0000-0000-0000-0000000000d5');
select pg_temp.make_user('ad000000-0000-0000-0000-0000000000c5');
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('ad000001-0000-0000-0000-0000000000c5', 'ad000000-0000-0000-0000-0000000000c5', 'cancelled', 25000, 'AD3E REV');
insert into public.payout_reviews (post_id, owner_id, spotter_id, reasons)
values ('ad000001-0000-0000-0000-0000000000c5', 'ad000000-0000-0000-0000-0000000000c5',
        'ad000000-0000-0000-0000-0000000000d5', array['shared_device']);
select pg_temp.expect_blocked('ad000000-0000-0000-0000-0000000000d5', 'REVIEW_OPEN');
rollback;

-- 3f an UPHELD dispute is settled, not open: it never blocks (security review
-- H1 — 'upheld' is final, so counting it blocked both sides for ever). The
-- owner (U) and the spotter (V) on U's expired listing can each go.
begin;
select pg_temp.make_user('ad000000-0000-0000-0000-0000000000f1'); -- owner U
select pg_temp.make_user('ad000000-0000-0000-0000-0000000000f2'); -- spotter V
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('ad000001-0000-0000-0000-0000000000f1', 'ad000000-0000-0000-0000-0000000000f1', 'expired', 25000, 'AD3F UPH');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
values ('ad000001-0000-0000-0000-0000000000f1', 'pi_acctdel_f1', 'refunded', 25000, 'bounty_escrow');
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('ad000002-0000-0000-0000-0000000000f2', 'ad000001-0000-0000-0000-0000000000f1',
        'ad000000-0000-0000-0000-0000000000f2', 'unverified', 'Ancoats', true);
insert into public.refund_disputes (post_id, sighting_id, spotter_id, status, resolved_at)
values ('ad000001-0000-0000-0000-0000000000f1', 'ad000002-0000-0000-0000-0000000000f2',
        'ad000000-0000-0000-0000-0000000000f2', 'upheld', now());
do $$
begin
  -- The spotter first: the settled dispute stays on U's listing, anonymised.
  if jsonb_array_length(public.account_deletion_blockers_for('ad000000-0000-0000-0000-0000000000f2')) <> 0 then
    raise exception 'CHECK 3f FAILED: an upheld dispute blocked its spotter: %',
      public.account_deletion_blockers_for('ad000000-0000-0000-0000-0000000000f2');
  end if;
  perform public.delete_account_data('ad000000-0000-0000-0000-0000000000f2', '{}');
  if not exists (select 1 from public.refund_disputes
                  where post_id = 'ad000001-0000-0000-0000-0000000000f1'
                    and status = 'upheld' and spotter_id is null) then
    raise exception 'CHECK 3f FAILED: the upheld dispute was lost or kept its spotter';
  end if;

  -- Then the owner: the listing's own guard lets a settled dispute through
  -- too, and the dispute rides into the ledger snapshot.
  perform public.delete_account_data('ad000000-0000-0000-0000-0000000000f1', '{}');
  if (select post_snapshot -> 'refund_disputes' -> 0 ->> 'status' from public.payments
       where stripe_payment_intent_id = 'pi_acctdel_f1') is distinct from 'upheld' then
    raise exception 'CHECK 3f FAILED: the owner''s upheld dispute was not archived into the snapshot';
  end if;
end $$;
rollback;

-- -----------------------------------------------------------------------------
-- CHECK 4 — an unpaid draft's intent must be PROVED dead first.
-- -----------------------------------------------------------------------------
begin;
select pg_temp.make_user('ad000000-0000-0000-0000-0000000000e1');
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('ad000001-0000-0000-0000-0000000000e1', 'ad000000-0000-0000-0000-0000000000e1', 'draft', 25000, 'AD04 STR');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
values ('ad000001-0000-0000-0000-0000000000e1', 'pi_acctdel_e1', 'requires_payment', 25000, 'bounty_escrow');
do $$
begin
  begin
    perform public.delete_account_data('ad000000-0000-0000-0000-0000000000e1', '{}');
    raise exception 'CHECK 4 FAILED: deleted with an unproven stray intent';
  exception
    when raise_exception then
      if sqlerrm <> 'INTENT_NOT_CANCELLED' then
        raise exception 'CHECK 4 FAILED: refused for the wrong reason: %', sqlerrm;
      end if;
  end;
end $$;
rollback;

-- -----------------------------------------------------------------------------
-- CHECK 6 — ⚠️ a LIVE listing with no money held goes with the account
-- (20261023140000). The prod case: a free listing (fee paid) carrying two
-- abandoned "add a reward" attempts — one failed, one never paid.
-- -----------------------------------------------------------------------------
begin;
select pg_temp.make_user('ad000000-0000-0000-0000-0000000000f6');
select pg_temp.make_user('ad000000-0000-0000-0000-0000000000f7'); -- a spotter
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate) values
  ('ad000001-0000-0000-0000-0000000000f6', 'ad000000-0000-0000-0000-0000000000f6', 'active', null,  'AD06 FRE'),
  -- A lapsed reward: set once, refunded since — no money left on it.
  ('ad000001-0000-0000-0000-0000000000f7', 'ad000000-0000-0000-0000-0000000000f6', 'active', 25000, 'AD06 LPS');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind) values
  ('ad000001-0000-0000-0000-0000000000f6', 'pi_acctdel_f6_fee',  'collected',        500,   'listing_fee'),
  ('ad000001-0000-0000-0000-0000000000f6', 'pi_acctdel_f6_bad',  'failed',           25000, 'bounty_escrow'),
  ('ad000001-0000-0000-0000-0000000000f6', 'pi_acctdel_f6_open', 'requires_payment', 25000, 'bounty_escrow'),
  ('ad000001-0000-0000-0000-0000000000f7', 'pi_acctdel_f7_ref',  'refunded',         25000, 'bounty_escrow');
-- As in prod, the lapsed reward left its (expired) reward_end hold behind —
-- a RESTRICT row the delete must clear.
insert into public.refund_holds (post_id, owner_id, payment_id, exit_path, system_initiated, sighting_ids, expires_at)
select 'ad000001-0000-0000-0000-0000000000f7', 'ad000000-0000-0000-0000-0000000000f6', id,
       'reward_end', true, '{}'::uuid[], now() - interval '1 day'
  from public.payments where stripe_payment_intent_id = 'pi_acctdel_f7_ref';
-- Someone helped: a sighting on the live listing.
insert into public.sightings (post_id, spotter_id, status, area_label, location_unavailable)
values ('ad000001-0000-0000-0000-0000000000f6', 'ad000000-0000-0000-0000-0000000000f7', 'unverified', 'Ancoats', true);

do $$
declare
  v_summary jsonb;
begin
  -- 6a — nothing blocks.
  if jsonb_array_length(public.account_deletion_blockers_for('ad000000-0000-0000-0000-0000000000f6')) <> 0 then
    raise exception 'CHECK 6a FAILED: a live listing with no money held still blocks: %',
      public.account_deletion_blockers_for('ad000000-0000-0000-0000-0000000000f6');
  end if;

  -- 6b — the never-paid attempt NOT proved dead: refused, nothing deleted.
  begin
    perform public.delete_account_data('ad000000-0000-0000-0000-0000000000f6', array['pi_acctdel_f6_bad']);
    raise exception 'CHECK 6b FAILED: deleted with an unproven reward attempt';
  exception
    when raise_exception then
      if sqlerrm <> 'INTENT_NOT_CANCELLED' then
        raise exception 'CHECK 6b FAILED: refused for the wrong reason: %', sqlerrm;
      end if;
  end;

  -- 6c — both proved dead (as delete-account proves them at Stripe): gone.
  v_summary := public.delete_account_data('ad000000-0000-0000-0000-0000000000f6',
                                          array['pi_acctdel_f6_bad', 'pi_acctdel_f6_open']);
  if (v_summary ->> 'posts_deleted')::int <> 2 then
    raise exception 'CHECK 6c FAILED: expected both live listings deleted: %', v_summary;
  end if;
  if exists (select 1 from public.posts where owner_id = 'ad000000-0000-0000-0000-0000000000f6')
     or exists (select 1 from public.sightings where post_id = 'ad000001-0000-0000-0000-0000000000f6') then
    raise exception 'CHECK 6c FAILED: a listing or its sighting survived';
  end if;
  -- The fee and the refunded reward: kept, detached, remembered as live.
  if (select count(*) from public.payments
       where stripe_payment_intent_id in ('pi_acctdel_f6_fee', 'pi_acctdel_f7_ref')
         and post_id is null
         and post_snapshot ->> 'post_status' = 'active') <> 2 then
    raise exception 'CHECK 6c FAILED: a moved-money row was lost or not detached';
  end if;
  -- The abandoned attempts: gone.
  if exists (select 1 from public.payments
              where stripe_payment_intent_id in ('pi_acctdel_f6_bad', 'pi_acctdel_f6_open')) then
    raise exception 'CHECK 6c FAILED: an abandoned reward attempt survived';
  end if;
end $$;
rollback;

-- -----------------------------------------------------------------------------
-- CHECK 7 — ⚠️ the per-listing guard ITSELF refuses a live listing holding
-- money. It's the backstop for a listing that went live with money after
-- delete_account_data read the blockers, so it's called directly here — the
-- blocker check would otherwise refuse first and the guard would never run.
-- -----------------------------------------------------------------------------
begin;
select pg_temp.make_user('ad000000-0000-0000-0000-0000000000a7');
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate) values
  ('ad000001-0000-0000-0000-0000000000a1', 'ad000000-0000-0000-0000-0000000000a7', 'active',               25000, 'AD07 HLD'),
  ('ad000001-0000-0000-0000-0000000000a2', 'ad000000-0000-0000-0000-0000000000a7', 'active',               null,  'AD07 SUP'),
  ('ad000001-0000-0000-0000-0000000000a3', 'ad000000-0000-0000-0000-0000000000a7', 'pending_verification', 25000, 'AD07 PVH');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind, superseded_at) values
  ('ad000001-0000-0000-0000-0000000000a1', 'pi_acctdel_a1', 'held',       25000, 'bounty_escrow', null),
  -- A stray capture on a fee listing, owed back: superseded money only.
  ('ad000001-0000-0000-0000-0000000000a2', 'pi_acctdel_a2', 'superseded', 25000, 'bounty_escrow', now()),
  ('ad000001-0000-0000-0000-0000000000a3', 'pi_acctdel_a3', 'held',       25000, 'bounty_escrow', null);

do $$
declare
  v_post uuid;
begin
  foreach v_post in array array[
    'ad000001-0000-0000-0000-0000000000a1',
    'ad000001-0000-0000-0000-0000000000a2',
    'ad000001-0000-0000-0000-0000000000a3']::uuid[]
  loop
    begin
      perform public.delete_post_for_account(v_post, 'ad000000-0000-0000-0000-0000000000a7', '{}');
      raise exception 'CHECK 7 FAILED: a live listing holding money (%) was deleted', v_post;
    exception
      when raise_exception then
        if sqlerrm <> 'LIVE_LISTING' then
          raise exception 'CHECK 7 FAILED: % refused for the wrong reason: %', v_post, sqlerrm;
        end if;
    end;
  end loop;

  -- And the screen's list agrees: three listings, one reason, no MONEY_HELD.
  if (select (b ->> 'count')::int from jsonb_array_elements(
        public.account_deletion_blockers_for('ad000000-0000-0000-0000-0000000000a7')) b
       where b ->> 'code' = 'LIVE_LISTING') is distinct from 3 then
    raise exception 'CHECK 7 FAILED: blockers disagree with the guard: %',
      public.account_deletion_blockers_for('ad000000-0000-0000-0000-0000000000a7');
  end if;
end $$;
rollback;

-- -----------------------------------------------------------------------------
-- CHECK 5 — who may call what.
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  if not has_function_privilege('authenticated', 'public.account_deletion_blockers()', 'execute')
     or has_function_privilege('anon', 'public.account_deletion_blockers()', 'execute') then
    raise exception 'CHECK 5 FAILED: account_deletion_blockers() must be signed-in only';
  end if;
  foreach v_fn in array array[
    'public.account_deletion_blockers_for(uuid)',
    'public.delete_post_for_account(uuid, uuid, text[])',
    'public.delete_account_data(uuid, text[])'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'CHECK 5 FAILED: % is callable by an API role', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'CHECK 5 FAILED: % is not callable by service_role', v_fn;
    end if;
  end loop;
end $$;
