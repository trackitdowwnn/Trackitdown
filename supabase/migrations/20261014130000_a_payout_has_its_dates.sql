-- -----------------------------------------------------------------------------
-- WHAT:  The dates and the car the redesigned Payouts screen shows:
--          1. my_pending_credit() also returns credited_at, and the car's make
--             and colour (never the plate).
--          2. stripe_connected_accounts.payouts_enabled_at, stamped by a
--             trigger whenever payouts switch on.
-- WHY:   2026-10-14 (payout experience redesign, PR2). The owner chose a
--        richer timeline — "a real date on every step behind you" — and a hero
--        that names what the reward was for ("for helping find a blue BMW").
--        The tracker could date only its last step; "payouts on" had no time
--        anywhere, and the credit's moment and car were never read.
--
-- SAFETY: my_pending_credit stays caller-scoped (auth.uid() is the spotter
--        filter) and gains only the make and colour of a car the spotter
--        already reported — the plate, location and owner stay out, as in
--        every spotter-facing read. The new column is read through the
--        table's existing select-own policy, as payouts_enabled is.
--
-- SHAPE: new OUT columns change my_pending_credit's return type, so drop and
--        create, then re-grant (as 20261014100000 did). Nothing in SQL calls
--        it; the app reads columns by name, so an app that predates this
--        ignores the new ones. payouts_enabled_at is NULL for accounts that
--        were payable before this — "no date shown", never a guessed one.
-- LINKS: 20261014100000_a_held_payout_says_so.sql (the definition replaced);
--        20261007100000_a_credited_reward_has_a_deadline.sql (sightings.credited_at);
--        src/features/payments/api/payoutsApi.ts (the reads).
-- -----------------------------------------------------------------------------


-- =============================================================================
-- 1. my_pending_credit — the credit's moment, and the car
-- =============================================================================
drop function if exists public.my_pending_credit();

create function public.my_pending_credit()
returns table (
  post_id        uuid,
  transfer_pence integer,
  under_review   boolean,
  credited_at    timestamptz,
  make           text,
  colour         text
)
language sql
security definer
set search_path = ''
as $$
  select s.post_id,
         (select split.transfer_pence
            from public.payout_split(p.amount_pence) as split),
         exists (
           select 1 from public.payout_reviews r
            where r.post_id = s.post_id
              and r.resolution is distinct from 'approved'
         ),
         s.credited_at,
         po.make,
         po.colour
    from public.sightings s
    join public.posts po on po.id = s.post_id
    join public.payments p on p.post_id = s.post_id
   where s.spotter_id = (select auth.uid())
     and s.status = 'credited'
     and po.status = 'recovery_claimed'
     and p.status = 'held'
   order by s.created_at desc
   limit 1;
$$;

comment on function public.my_pending_credit() is
  'The caller''s credited-but-unpaid bounty: post id, their 95% share (payout_split), under_review (a payout_reviews row short of approved holds it; never why), credited_at, and the car''s make and colour (never the plate). Or no rows. Caller-scoped on auth.uid(); `limit 1` keeps it one row. Powers the Payouts hero and tracker.';

revoke all on function public.my_pending_credit() from public;
revoke all on function public.my_pending_credit() from anon;
grant execute on function public.my_pending_credit() to authenticated;


-- =============================================================================
-- 2. payouts_enabled_at — when payouts switched on
-- =============================================================================
alter table public.stripe_connected_accounts
  add column if not exists payouts_enabled_at timestamptz;

comment on column public.stripe_connected_accounts.payouts_enabled_at is
  'When payouts last switched ON for this account (stamped by stamp_payouts_enabled_at, 2026-10-14). NULL for accounts payable before the stamp existed — the tracker then shows no date rather than a guess.';

-- Every writer goes through upsert_connected_account, but the stamp belongs to
-- the TRANSITION, not to any one writer — so a trigger, which sees old and new.
-- On an upsert's conflict path the BEFORE UPDATE trigger sees the real old row,
-- so an account already payable keeps its first stamp.
create or replace function public.stamp_payouts_enabled_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.payouts_enabled
     and (tg_op = 'INSERT' or not coalesce(old.payouts_enabled, false)) then
    new.payouts_enabled_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists stripe_connected_accounts_stamp_payouts_enabled
  on public.stripe_connected_accounts;
create trigger stripe_connected_accounts_stamp_payouts_enabled
  before insert or update of payouts_enabled on public.stripe_connected_accounts
  for each row execute function public.stamp_payouts_enabled_at();
