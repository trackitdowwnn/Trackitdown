-- =============================================================================
-- WHAT:  Verification for 20261007120000_a_deadline_names_its_last_day.sql:
--        every push that names a deadline names its LAST DAY — the day
--        before the stored end instant when that instant is a midnight
--        (reward_term_end), the same day when it is not (the capture + 85
--        hard line).
-- WHY:   Each deadline was printed as the day AFTER the last one, so an owner
--        renewing, or a spotter adding bank details, "by" the date they were
--        given was a day late. These checks pin the date in the copy, not
--        just its presence (reward_term_verification only matches '%').
-- HOW:   Self-asserting, begin…rollback per check, RAISE on failure (CI's db
--        job). Owner 11111111-…, spotter 44444444-… (seed profiles).
-- LINKS: supabase/migrations/20261007120000_a_deadline_names_its_last_day.sql.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — last_day_text: a midnight end names the day before (in BST and
-- in GMT); any other instant names its own day.
-- -----------------------------------------------------------------------------
do $$
begin
  if public.last_day_text('2026-10-23 23:00:00+00') <> '23 October'      -- 00:00 BST 24 Oct
     or public.last_day_text('2026-12-06 00:00:00+00') <> '5 December'   -- 00:00 GMT 6 Dec
     or public.last_day_text('2026-12-30 15:00:00+00') <> '30 December'  -- a capped end
     or public.last_day_text(public.reward_term_end('2026-11-02 09:00:00+00')) <> '2 November' then
    raise exception 'CHECK 1 FAILED: last_day_text does not name the last day';
  end if;
  raise notice 'CHECK 1 passed: a midnight end names the day before; any other instant its own day';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 2 — the owner's term notice and term reminder name the last day.
-- -----------------------------------------------------------------------------
begin;
update public.payments set reminded_10d_at = now(), reminded_3d_at = now()
 where status = 'held' and kind = 'bounty_escrow';
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, colour, make, model)
values ('1d000000-0000-0000-0000-000000000021', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'LD02 NTC', 'Blue', 'Ford',  'Fiesta'),
       ('1d000000-0000-0000-0000-000000000022', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'LD02 REM', 'Red',  'Honda', 'Jazz');
-- A legacy reward (no term yet) for the notice; a dated one 2 days out for
-- the reminder, ending at a London midnight as every term does.
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, captured_at)
values ('1d000000-0000-0000-0000-000000000021', 'pi_ld2_ntc', 'held', 20000, now() - interval '10 days');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, term_ends_at, term_notice_at)
values ('1d000000-0000-0000-0000-000000000022', 'pi_ld2_rem', 'held', 20000,
        public.reward_term_end(now() + interval '2 days'), now() - interval '30 days');

do $$
declare
  v_rows jsonb;
  v_end  timestamptz;
  v_body text;
  v_title text;
begin
  select e ->> 'body' into v_body
    from jsonb_array_elements(public.claim_reward_term_notices(200)) e
   where e ->> 'post_id' = '1d000000-0000-0000-0000-000000000021';
  select term_ends_at into v_end from public.payments where stripe_payment_intent_id = 'pi_ld2_ntc';
  if v_body is null
     or v_body not like '%listing now ends on ' || public.last_day_text(v_end) || '.%'
     or v_body like '%ends on ' || to_char(v_end at time zone 'Europe/London', 'FMDD FMMonth') || '.%' then
    raise exception 'CHECK 2 FAILED: the term notice names % (the term ends %)', v_body, v_end;
  end if;

  select e ->> 'title' into v_title
    from jsonb_array_elements(public.claim_reward_reminders(200)) e
   where e ->> 'post_id' = '1d000000-0000-0000-0000-000000000022';
  select term_ends_at into v_end from public.payments where stripe_payment_intent_id = 'pi_ld2_rem';
  if v_title is distinct from 'Your Red Honda Jazz reward ends on ' || public.last_day_text(v_end) then
    raise exception 'CHECK 2 FAILED: the term reminder says % (the term ends %)', v_title, v_end;
  end if;
  raise notice 'CHECK 2 passed: the owner''s notice and reminder name the last day';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — the spotter's payout reminder names the last day.
-- -----------------------------------------------------------------------------
begin;
update public.stripe_connected_accounts set payouts_enabled = false where profile_id = '44444444-4444-4444-4444-444444444444';
update public.payments set payout_reminded_7d_at = now(), payout_reminded_2d_at = now()
 where status = 'held' and (payout_reminded_7d_at is null or payout_reminded_2d_at is null);
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, recovered_at)
values ('1d000000-0000-0000-0000-000000000031', '11111111-1111-1111-1111-111111111111', 'recovery_claimed', 20000, 'LD03 PAY', now() - interval '30 days');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, captured_at)
values ('1d000000-0000-0000-0000-000000000031', 'pi_ld3', 'held', 20000, now() - interval '75 days');
insert into public.sightings (post_id, spotter_id, status, area_label, location_unavailable, credited_at)
values ('1d000000-0000-0000-0000-000000000031', '44444444-4444-4444-4444-444444444444', 'credited', 'Camden', true, now() - interval '30 days');

do $$
declare
  v_body     text;
  v_deadline timestamptz;
begin
  select public.payout_deadline(id) into v_deadline from public.payments where stripe_payment_intent_id = 'pi_ld3';
  select e ->> 'body' into v_body
    from jsonb_array_elements(public.claim_payout_reminders(100)) e
   where e ->> 'post_id' = '1d000000-0000-0000-0000-000000000031';
  if v_body is distinct from 'Add your bank details by ' || public.last_day_text(v_deadline) || ' to receive it.' then
    raise exception 'CHECK 3 FAILED: the payout reminder says % (the deadline is %)', v_body, v_deadline;
  end if;
  raise notice 'CHECK 3 passed: the payout reminder names the last day';
end $$;
rollback;
