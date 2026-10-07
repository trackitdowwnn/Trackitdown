-- =============================================================================
-- WHAT:  A deadline names its LAST DAY. Every reward term and payout deadline
--        is stored as the instant it ends — midnight at the START of the next
--        London day (reward_term_end) — and every push printed that
--        instant's date: the day AFTER the last one. An owner told "ends on
--        7 December" lost the reward at 00:00 on 7 December; a spotter told
--        "add your bank details by 24 October" was already a day late on the
--        24th.
--          1. last_day_text(end) — the London date of the last whole day
--             before an end instant ('23 October').
--          2. claim_reward_term_notices, claim_reward_reminders,
--             claim_payout_reminders — restated, the date through it.
-- WHY:   reward_term_end's own comment: "so the date owners are told is the
--        whole of the last day". The storage was right, the wording wasn't.
--        Found 2026-10-07 reading a live payout deadline before
--        PAYOUT_DEADLINE_ENABLED was switched on. Nothing moved on a wrong
--        day: no 60-day term has ended yet, and the payout deadline was off.
--        The app carries the same fix (src/shared/lib/dateTimeLabel.ts,
--        formatLastDay): the listing banner, the listing's term line
--        (rewardTerm.ts), My Posts, and the change-reward screen.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. `create or replace` on THREE
--        existing functions, each RESTATED IN FULL (extracted mechanically
--        from its latest definition; the only change in each is the one
--        date expression, diffed); one new helper. No data touched.
-- LINKS: supabase/migrations/20261005140000_a_reward_has_a_term.sql
--          (reward_term_end, the two term claims);
--        supabase/migrations/20261007100000_a_credited_reward_has_a_deadline.sql
--          (claim_payout_reminders);
--        supabase/tests/last_day_verification.sql.
-- =============================================================================


-- =============================================================================
-- 1. last_day_text — the last whole day before an end instant
-- =============================================================================
-- One microsecond before the end is still the last day: an end of
-- 2026-10-24 00:00 (London) is '23 October'. STABLE, not immutable: a named
-- time zone's rules are data.
create or replace function public.last_day_text(p_end timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char((p_end - interval '1 microsecond') at time zone 'Europe/London', 'FMDD FMMonth');
$$;

comment on function public.last_day_text(timestamptz) is
  'The London date of the last whole day before an end instant, as push copy (''23 October''). Every term_ends_at and payout_deadline is midnight at the START of the day after the last one (reward_term_end), so its own date is one day late. Display only. Not directly grantable.';

revoke all on function public.last_day_text(timestamptz) from public, anon, authenticated;


-- =============================================================================
-- 2. The three claims that word a deadline
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20261005140000 (extracted mechanically). The ONLY
-- change: the date is public.last_day_text(…).
create or replace function public.claim_reward_term_notices(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_term       constant interval := interval '60 days';
  c_min_notice constant interval := interval '14 days';
  c_legacy_cap constant interval := interval '80 days';
  c_min_floor  constant interval := interval '3 days';
  c_hard_line  constant interval := interval '85 days';
  v_rows       jsonb;
begin
  with due as (
    select p.id
      from public.payments p
      join public.posts po on po.id = p.post_id
     where p.status = 'held'
       and p.kind = 'bounty_escrow'
       and p.term_ends_at is null
       and po.status in ('active', 'pending_verification')
     order by coalesce(p.captured_at, p.created_at)
     limit greatest(coalesce(p_limit, 200), 0)
       for update of p skip locked
  ),
  claimed as (
    update public.payments pay
       set term_ends_at = least(
             public.reward_term_end(greatest(
               least(
                 coalesce(pay.captured_at, pay.created_at) + c_legacy_cap,
                 greatest(coalesce(pay.captured_at, pay.created_at) + c_term, now() + c_min_notice)
               ),
               now() + c_min_floor
             )),
             coalesce(pay.captured_at, pay.created_at) + c_hard_line
           ),
           term_notice_at = now(),
           legacy_term    = true
      from due
     where pay.id = due.id
       and pay.term_ends_at is null
       and pay.status = 'held'
    returning pay.id, pay.post_id, pay.term_ends_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_id', c.id,
           'post_id',    c.post_id,
           'user_id',    po.owner_id,
           'title',      'Rewards now run for 60 days',
           'body',       'Your reward on your ' || coalesce(nullif(left(
                            trim(coalesce(po.colour, '') || ' ' ||
                                 coalesce(po.make, '')   || ' ' ||
                                 coalesce(po.model, '')), 48), ''), 'car')
                         || ' listing now ends on '
                         || public.last_day_text(c.term_ends_at)
                         || '. You can renew it any time from your listing.'
         )), '[]'::jsonb)
    into v_rows
    from claimed c
    join public.posts po on po.id = c.post_id;

  return v_rows;
end $$;


-- ⚠️ RESTATED IN FULL from 20261005140000 (extracted mechanically). The ONLY
-- change: the date is public.last_day_text(…).
create or replace function public.claim_reward_reminders(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_first  constant interval := interval '10 days';
  c_second constant interval := interval '3 days';
  c_quiet  constant interval := interval '1 day';
  v_rows   jsonb;
begin
  with due as (
    select p.id,
           (p.term_ends_at <= now() + c_second) as last_days
      from public.payments p
      join public.posts po on po.id = p.post_id
     where p.status = 'held'
       and p.kind = 'bounty_escrow'
       and p.term_ends_at is not null
       and p.term_ends_at > now()
       and po.status in ('active', 'pending_verification')
       and (p.term_notice_at is null or p.term_notice_at < now() - c_quiet)
       and (
         (p.term_ends_at <= now() + c_second and p.reminded_3d_at is null)
         or (p.term_ends_at <= now() + c_first and p.reminded_10d_at is null)
       )
     order by p.term_ends_at
     limit greatest(coalesce(p_limit, 200), 0)
       for update of p skip locked
  ),
  claimed as (
    update public.payments pay
       set reminded_10d_at = coalesce(pay.reminded_10d_at, now()),
           reminded_3d_at  = case when due.last_days then coalesce(pay.reminded_3d_at, now())
                                  else pay.reminded_3d_at end
      from due
     where pay.id = due.id
       -- Re-check under the claim: a concurrent sweep must not remind twice.
       and ((due.last_days and pay.reminded_3d_at is null)
            or (not due.last_days and pay.reminded_10d_at is null))
    returning pay.id, pay.post_id, pay.term_ends_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_id', c.id,
           'post_id',    c.post_id,
           'user_id',    po.owner_id,
           'title',      'Your ' || coalesce(nullif(left(
                            trim(coalesce(po.colour, '') || ' ' ||
                                 coalesce(po.make, '')   || ' ' ||
                                 coalesce(po.model, '')), 48), ''), 'car')
                         || ' reward ends on '
                         || public.last_day_text(c.term_ends_at),
           'body',       'Renew it to keep a reward on your listing. If you don''t, it''s refunded to your card.'
         )), '[]'::jsonb)
    into v_rows
    from claimed c
    join public.posts po on po.id = c.post_id;

  return v_rows;
end $$;


-- ⚠️ RESTATED IN FULL from 20261007100000 (extracted mechanically). The ONLY
-- change: the date is public.last_day_text(…).
create or replace function public.claim_payout_reminders(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  with due as (
    -- RIPE rows only, so the limit can never be spent on rows that are not
    -- due yet and starve ones that are.
    select x.id, x.deadline, (x.deadline <= now() + interval '2 days') as last_days
      from (
        select p.id, public.payout_deadline(p.id) as deadline,
               p.payout_reminded_7d_at, p.payout_reminded_2d_at,
               coalesce(s.credited_at, po.recovered_at) as credited_at
          from public.payments p
          join public.posts po on po.id = p.post_id
          join public.sightings s on s.post_id = po.id and s.status = 'credited'
         where p.status = 'held'
           and p.kind = 'bounty_escrow'
           and po.status = 'recovery_claimed'
           and p.payout_lapse_claimed_at is null
           and (p.payout_reminded_7d_at is null or p.payout_reminded_2d_at is null)
           and public.payout_awaiting_payee(p.id)
      ) x
     where x.deadline > now()
       and x.deadline <= now() + interval '7 days'
       and ((x.deadline <= now() + interval '2 days' and x.payout_reminded_2d_at is null)
            or (x.payout_reminded_7d_at is null
                and x.credited_at < now() - interval '1 day'))
     order by x.deadline
     limit greatest(coalesce(p_limit, 100), 0)
  ),
  claimed as (
    update public.payments pay
       set payout_reminded_7d_at = coalesce(pay.payout_reminded_7d_at, now()),
           payout_reminded_2d_at = case when due.last_days then coalesce(pay.payout_reminded_2d_at, now())
                                        else pay.payout_reminded_2d_at end
      from due
     where pay.id = due.id
       -- Re-checked inside the update: two concurrent sweeps cannot both send.
       and ((due.last_days and pay.payout_reminded_2d_at is null)
            or (not due.last_days and pay.payout_reminded_7d_at is null))
    returning pay.id, pay.post_id, pay.amount_pence, due.deadline, due.last_days
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_id', c.id,
           'post_id',    c.post_id,
           'user_id',    s.spotter_id,
           'title',      case when c.last_days
                           then 'Last few days to claim your ' || public.pounds_text(sp.transfer_pence)
                           else 'Your ' || public.pounds_text(sp.transfer_pence) || ' reward is waiting'
                         end,
           'body',       'Add your bank details by '
                         || public.last_day_text(c.deadline)
                         || case when c.last_days then ', or it goes back to the owner.' else ' to receive it.' end
         )), '[]'::jsonb)
    into v_rows
    from claimed c
    join public.sightings s on s.post_id = c.post_id and s.status = 'credited'
    cross join lateral public.payout_split(c.amount_pence) sp;

  return v_rows;
end $$;


-- =============================================================================
-- 3. Assert: the last day, and the grants unchanged
-- =============================================================================
do $$
declare
  f text;
begin
  -- A day ending in BST (24 Oct 00:00 BST = 23 Oct 23:00 UTC) and one in GMT.
  if public.last_day_text(public.reward_term_end('2026-10-23 12:00:00+01')) <> '23 October'
     or public.last_day_text(public.reward_term_end('2026-12-05 12:00:00+00')) <> '5 December' then
    raise exception 'last_day_text does not name the last day';
  end if;

  foreach f in array array[
    'public.claim_reward_term_notices(integer)',
    'public.claim_reward_reminders(integer)',
    'public.claim_payout_reminders(integer)'
  ] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '% is client-executable', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '% is not executable by service_role — the sweep is broken', f;
    end if;
  end loop;
end $$;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
