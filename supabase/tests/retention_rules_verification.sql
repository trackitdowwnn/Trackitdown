-- =============================================================================
-- WHAT:  Verification for the retention rules
--        (20261022100000_retention_rules.sql). NOT a migration.
-- WHY:   Each of these deletes or clears personal data on a clock, unattended.
--        The properties that matter: each takes only what is due, never
--        anything with money still moving, the ledger survives a listing's
--        deletion, and no client can call any of them.
--
-- CHECKS: 1 purge_closed_sighting_details clears the street name and every
-- free-text field on a listing closed 91 days, keeps the structured answers,
-- leaves a 30-day-closed listing alone, and every 91-day listing with money
-- moving (held, superseded, unresolved review, open dispute, live hold) or a
-- payment under 180 days old (chargeback reach); a 200-day-old payment does
-- not hold the words back ·
-- 2 purge_old_closed_posts deletes a recovered listing closed 13 months (the
-- ledger row DETACHED with a snapshot, never deleted), keeps an 11-month one,
-- never selects one carrying an unproven intent — old_closed_posts_with_
-- stray_intents lists it for the sweep, and with Stripe's proof it deletes —
-- and leaves cancelled listings to their own purge · 3 delete_old_closed_post refuses NOT_DUE and
-- NOT_RECOVERED · 4 purge_stale_push_tokens removes a 271-day token, keeps a
-- fresh one · 5 purge_old_webhook_events removes a 31-day id, keeps a 1-day
-- one · 6 ⚠️ all six are service_role only.
-- HOW:   Self-asserting, RAISE on failure (CI's db job, ON_ERROR_STOP=1);
--        every fixture inside begin…rollback. Seed profiles: owner 11111111-…,
--        spotter 22222222-…. Back-dated closed_at is honoured on INSERT
--        (posts_set_closed_at), as delete_cancelled_post_verification relies on.
-- LINKS: supabase/migrations/20261022100000_retention_rules.sql;
--        supabase/tests/delete_cancelled_post_verification.sql (the harness).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — the words and street names go 90 days after a listing closes.
-- -----------------------------------------------------------------------------
begin;
-- Closed 91 days, settled: due.
insert into public.posts (id, owner_id, status, plate, closed_at)
values ('aeaeaeae-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'recovered_no_spotter', 'RT11 RET',
        now() - interval '91 days');
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable,
                              note, context_flags, damage_kinds, damage_note,
                              missing_parts, missing_parts_note)
values ('aeaeaeae-1111-0000-0000-000000000001', 'aeaeaeae-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222', 'unverified', 'Ancoats', true,
        'By the bins', array['damage_visible'], array['missing_parts'], 'Glass on the road',
        array['doors'], 'Both front doors off');
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable,
                              withdraw_reason, withdraw_note)
values ('aeaeaeae-1111-0000-0000-000000000002', 'aeaeaeae-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222', 'withdrawn', 'Ancoats', true,
        'other', 'Wrong street');
-- Closed 30 days: not due.
insert into public.posts (id, owner_id, status, plate, closed_at)
values ('aeaeaeae-0000-0000-0000-000000000002',
        '11111111-1111-1111-1111-111111111111', 'recovered_no_spotter', 'RT12 RET',
        now() - interval '30 days');
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable, note)
values ('aeaeaeae-1111-0000-0000-000000000003', 'aeaeaeae-0000-0000-0000-000000000002',
        '22222222-2222-2222-2222-222222222222', 'unverified', 'Deansgate', true, 'Kept');
-- Closed 91 days but money still HELD: the words may be evidence — kept.
insert into public.posts (id, owner_id, status, plate, bounty_amount_pence, closed_at)
values ('aeaeaeae-0000-0000-0000-000000000003',
        '11111111-1111-1111-1111-111111111111', 'recovered_no_spotter', 'RT13 RET', 25000,
        now() - interval '91 days');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('aeaeaeae-0000-0000-0000-000000000003', 'pi_ret_held', 'held', 25000);
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable, note)
values ('aeaeaeae-1111-0000-0000-000000000004', 'aeaeaeae-0000-0000-0000-000000000003',
        '22222222-2222-2222-2222-222222222222', 'unverified', 'Salford', true, 'Evidence');
-- Every other guard, one listing each, all closed 91 days. 05: superseded
-- money · 06: unresolved payout review · 07: open dispute · 08: live hold ·
-- 09: a refunded payment made 10 days ago (chargeback reach) · 0a: a refunded
-- payment made 200 days ago — NOT a guard, the words go.
insert into public.posts (id, owner_id, status, plate, bounty_amount_pence, closed_at)
select ('aeaeaeae-0000-0000-0000-0000000000' || n)::uuid,
       '11111111-1111-1111-1111-111111111111', 'recovered_no_spotter', 'RT1' || n || ' RET', 25000,
       now() - interval '91 days'
  from unnest(array['05', '06', '07', '08', '09', '0a']) as n;
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable, note)
select ('aeaeaeae-1111-0000-0000-0000000000' || n)::uuid,
       ('aeaeaeae-0000-0000-0000-0000000000' || n)::uuid,
       '22222222-2222-2222-2222-222222222222', 'unverified', 'Ancoats', true, 'Guarded ' || n
  from unnest(array['05', '06', '07', '08', '09', '0a']) as n;
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, created_at)
values ('aeaeaeae-0000-0000-0000-000000000005', 'pi_ret_sup', 'superseded', 25000, now() - interval '200 days'),
       ('aeaeaeae-0000-0000-0000-000000000009', 'pi_ret_recent', 'refunded', 25000, now() - interval '10 days'),
       ('aeaeaeae-0000-0000-0000-00000000000a', 'pi_ret_aged', 'refunded', 25000, now() - interval '200 days');
insert into public.payout_reviews (post_id, owner_id, spotter_id, reasons)
values ('aeaeaeae-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222', array['shared_device']);
insert into public.refund_disputes (post_id, sighting_id, spotter_id, status)
values ('aeaeaeae-0000-0000-0000-000000000007', 'aeaeaeae-1111-0000-0000-000000000007',
        '22222222-2222-2222-2222-222222222222', 'open');
insert into public.refund_holds (post_id, owner_id, exit_path, sighting_ids, expires_at)
values ('aeaeaeae-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
        'deactivate', array['aeaeaeae-1111-0000-0000-000000000008']::uuid[],
        now() + interval '48 hours');

do $$
declare
  v_s public.sightings%rowtype;
  v_n text;
begin
  perform public.purge_closed_sighting_details();

  select * into v_s from public.sightings where id = 'aeaeaeae-1111-0000-0000-000000000001';
  if v_s.area_label is not null or v_s.note is not null
     or v_s.damage_note is not null or v_s.missing_parts_note is not null then
    raise exception 'CHECK 1 FAILED: the 91-day sighting kept words or a street name: % / % / % / %',
      v_s.area_label, v_s.note, v_s.damage_note, v_s.missing_parts_note;
  end if;
  -- The structured answers are not personal words: they stay.
  if v_s.damage_kinds is distinct from array['missing_parts']::text[]
     or v_s.missing_parts is distinct from array['doors']::text[] then
    raise exception 'CHECK 1 FAILED: the structured answers were cleared too';
  end if;

  select * into v_s from public.sightings where id = 'aeaeaeae-1111-0000-0000-000000000002';
  if v_s.withdraw_note is not null or v_s.area_label is not null then
    raise exception 'CHECK 1 FAILED: the withdrawal note survived (%)', v_s.withdraw_note;
  end if;
  if v_s.withdraw_reason is distinct from 'other' then
    raise exception 'CHECK 1 FAILED: the closed-list reason was cleared';
  end if;

  select * into v_s from public.sightings where id = 'aeaeaeae-1111-0000-0000-000000000003';
  if v_s.note is distinct from 'Kept' or v_s.area_label is distinct from 'Deansgate' then
    raise exception 'CHECK 1 FAILED: a 30-day-closed listing lost its sighting details';
  end if;

  select * into v_s from public.sightings where id = 'aeaeaeae-1111-0000-0000-000000000004';
  if v_s.note is distinct from 'Evidence' then
    raise exception 'CHECK 1 FAILED: words were cleared on a listing with HELD money';
  end if;

  foreach v_n in array array['05', '06', '07', '08', '09'] loop
    select * into v_s from public.sightings where id = ('aeaeaeae-1111-0000-0000-0000000000' || v_n)::uuid;
    if v_s.note is distinct from 'Guarded ' || v_n then
      raise exception 'CHECK 1 FAILED: guarded listing % lost its words (superseded / review / dispute / hold / recent payment)', v_n;
    end if;
  end loop;
  select * into v_s from public.sightings where id = 'aeaeaeae-1111-0000-0000-00000000000a';
  if v_s.note is not null then
    raise exception 'CHECK 1 FAILED: a 200-day-old payment held the words back — the 180-day rule is too wide';
  end if;

  raise notice 'CHECK 1 passed: 90-day words and street names cleared; answers kept; young listings, every money guard and the 180-day chargeback reach respected';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 — recovered listings go 12 months after closing; the ledger stays.
-- -----------------------------------------------------------------------------
begin;
-- Closed 13 months, settled: due.
insert into public.posts (id, owner_id, status, plate, bounty_amount_pence, closed_at)
values ('aeaeaeae-0000-0000-0000-000000000011',
        '11111111-1111-1111-1111-111111111111', 'recovered_no_spotter', 'RT21 RET', 25000,
        now() - interval '13 months');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('aeaeaeae-0000-0000-0000-000000000011', 'pi_ret_old', 'refunded', 25000);
insert into public.sightings (post_id, spotter_id, status, area_label, location_unavailable)
values ('aeaeaeae-0000-0000-0000-000000000011',
        '22222222-2222-2222-2222-222222222222', 'unverified', 'Ancoats', true);
-- Closed 11 months: not due.
insert into public.posts (id, owner_id, status, plate, closed_at)
values ('aeaeaeae-0000-0000-0000-000000000012',
        '11111111-1111-1111-1111-111111111111', 'recovered', 'RT22 RET',
        now() - interval '11 months');
-- Closed 13 months but an UNPROVEN intent on the ledger: never selected.
insert into public.posts (id, owner_id, status, plate, bounty_amount_pence, closed_at)
values ('aeaeaeae-0000-0000-0000-000000000013',
        '11111111-1111-1111-1111-111111111111', 'recovered_no_spotter', 'RT23 RET', 25000,
        now() - interval '13 months');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('aeaeaeae-0000-0000-0000-000000000013', 'pi_ret_stray', 'requires_payment', 25000);
-- CANCELLED 13 months: purge_cancelled_posts' business, not this one's.
insert into public.posts (id, owner_id, status, plate, closed_at)
values ('aeaeaeae-0000-0000-0000-000000000014',
        '11111111-1111-1111-1111-111111111111', 'cancelled', 'RT24 RET',
        now() - interval '13 months');

do $$
declare
  v_result jsonb;
  v_pay    public.payments%rowtype;
begin
  select public.purge_old_closed_posts() into v_result;

  if exists (select 1 from public.posts where id = 'aeaeaeae-0000-0000-0000-000000000011') then
    raise exception 'CHECK 2 FAILED: the 13-month recovered listing was not deleted';
  end if;
  if exists (select 1 from public.sightings where post_id = 'aeaeaeae-0000-0000-0000-000000000011') then
    raise exception 'CHECK 2 FAILED: its sightings did not cascade';
  end if;
  select * into v_pay from public.payments where stripe_payment_intent_id = 'pi_ret_old';
  if not found then
    raise exception 'CHECK 2 FAILED: the ledger row was DELETED — money that moved lost its record';
  end if;
  if v_pay.post_id is not null or v_pay.post_snapshot ->> 'plate' is distinct from 'RT21 RET' then
    raise exception 'CHECK 2 FAILED: the ledger row was not detached with a snapshot (post %, snapshot %)',
      v_pay.post_id, v_pay.post_snapshot;
  end if;

  if not exists (select 1 from public.posts where id = 'aeaeaeae-0000-0000-0000-000000000012') then
    raise exception 'CHECK 2 FAILED: an 11-month listing was deleted';
  end if;
  if not exists (select 1 from public.posts where id = 'aeaeaeae-0000-0000-0000-000000000013') then
    raise exception 'CHECK 2 FAILED: a listing with an unproven intent was deleted';
  end if;
  if not exists (select 1 from public.posts where id = 'aeaeaeae-0000-0000-0000-000000000014') then
    raise exception 'CHECK 2 FAILED: a CANCELLED listing was deleted by the recovered-listing purge';
  end if;

  if coalesce((v_result ->> 'purged')::integer, 0) < 1 then
    raise exception 'CHECK 2 FAILED: purge reported % (expected purged >= 1)', v_result;
  end if;
  -- The unproven-intent listing is never SELECTED, so it is not a skip:
  -- `skipped` stays an alarm, not routine.
  if coalesce((v_result ->> 'skipped')::integer, 0) <> 0 then
    raise exception 'CHECK 2 FAILED: expected no skips, got %', v_result;
  end if;

  -- The stray-intent listing is the sweep's: listed with its intent id …
  if not exists (
       select 1
         from jsonb_array_elements(public.old_closed_posts_with_stray_intents(50)) e
        where e ->> 'post_id' = 'aeaeaeae-0000-0000-0000-000000000013'
          and e -> 'intent_ids' = '["pi_ret_stray"]'::jsonb) then
    raise exception 'CHECK 2 FAILED: the stray-intent listing was not handed to the sweep with its intent';
  end if;
  -- … and, with Stripe's proof, it deletes; the never-captured row goes
  -- (money never moved), exactly as delete_cancelled_post does.
  perform public.delete_old_closed_post('aeaeaeae-0000-0000-0000-000000000013',
    '11111111-1111-1111-1111-111111111111', array['pi_ret_stray']);
  if exists (select 1 from public.posts where id = 'aeaeaeae-0000-0000-0000-000000000013') then
    raise exception 'CHECK 2 FAILED: the proven stray-intent listing was not deleted';
  end if;
  if exists (select 1 from public.payments where stripe_payment_intent_id = 'pi_ret_stray') then
    raise exception 'CHECK 2 FAILED: the proven never-captured ledger row survived';
  end if;

  raise notice 'CHECK 2 passed: 13-month recovered listing deleted, ledger detached with a snapshot; young and cancelled listings untouched; the stray-intent one goes only with proof';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — the delete refuses what is not due, and what is not recovered.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, plate, closed_at)
values ('aeaeaeae-0000-0000-0000-000000000021',
        '11111111-1111-1111-1111-111111111111', 'recovered', 'RT31 RET',
        now() - interval '11 months');
insert into public.posts (id, owner_id, status, plate, closed_at)
values ('aeaeaeae-0000-0000-0000-000000000022',
        '11111111-1111-1111-1111-111111111111', 'cancelled', 'RT32 RET',
        now() - interval '13 months');

do $$
begin
  begin
    perform public.delete_old_closed_post('aeaeaeae-0000-0000-0000-000000000021',
      '11111111-1111-1111-1111-111111111111', '{}'::text[]);
    raise exception 'CHECK 3a FAILED: an 11-month listing was deleted';
  exception when others then
    if sqlerrm <> 'NOT_DUE' then
      raise exception 'CHECK 3a FAILED: expected NOT_DUE, got: %', sqlerrm;
    end if;
  end;

  begin
    perform public.delete_old_closed_post('aeaeaeae-0000-0000-0000-000000000022',
      '11111111-1111-1111-1111-111111111111', '{}'::text[]);
    raise exception 'CHECK 3b FAILED: a cancelled listing was deleted';
  exception when others then
    if sqlerrm <> 'NOT_RECOVERED' then
      raise exception 'CHECK 3b FAILED: expected NOT_RECOVERED, got: %', sqlerrm;
    end if;
  end;

  raise notice 'CHECK 3 passed: NOT_DUE and NOT_RECOVERED refused';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 — push tokens no phone has refreshed in 270 days go.
-- -----------------------------------------------------------------------------
begin;
insert into public.push_tokens (token, user_id, platform, updated_at)
values ('ExponentPushToken[retention-stale]', '11111111-1111-1111-1111-111111111111',
        'android', now() - interval '271 days'),
       ('ExponentPushToken[retention-fresh]', '11111111-1111-1111-1111-111111111111',
        'android', now() - interval '1 day');

do $$
begin
  perform public.purge_stale_push_tokens();
  if exists (select 1 from public.push_tokens where token = 'ExponentPushToken[retention-stale]') then
    raise exception 'CHECK 4 FAILED: a 271-day token survived';
  end if;
  if not exists (select 1 from public.push_tokens where token = 'ExponentPushToken[retention-fresh]') then
    raise exception 'CHECK 4 FAILED: a fresh token was deleted — that phone would stop getting pushes';
  end if;
  raise notice 'CHECK 4 passed: stale token removed, fresh one kept';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 — webhook dedup ids past any retry go.
-- -----------------------------------------------------------------------------
begin;
insert into public.stripe_webhook_events (event_id, processed_at)
values ('evt_retention_old', now() - interval '31 days'),
       ('evt_retention_new', now() - interval '1 day');

do $$
begin
  perform public.purge_old_webhook_events();
  if exists (select 1 from public.stripe_webhook_events where event_id = 'evt_retention_old') then
    raise exception 'CHECK 5 FAILED: a 31-day webhook id survived';
  end if;
  if not exists (select 1 from public.stripe_webhook_events where event_id = 'evt_retention_new') then
    raise exception 'CHECK 5 FAILED: a 1-day webhook id was deleted — a retry could be processed twice';
  end if;
  raise notice 'CHECK 5 passed: old dedup id removed, recent one kept';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 6 — ⚠️ GRANTS: every one of these deletes data and checks no caller;
-- client-executable would mean any user could run retention on demand.
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.purge_closed_sighting_details()',
    'public.delete_old_closed_post(uuid, uuid, text[])',
    'public.purge_old_closed_posts()',
    'public.old_closed_posts_with_stray_intents(integer)',
    'public.purge_stale_push_tokens()',
    'public.purge_old_webhook_events()'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('public', v_fn, 'execute') then
      raise exception 'CHECK 6 FAILED: % is client-executable', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'CHECK 6 FAILED: service_role cannot execute % — the sweep would fail', v_fn;
    end if;
  end loop;
  raise notice 'CHECK 6 passed: all six service_role only';
end $$;
