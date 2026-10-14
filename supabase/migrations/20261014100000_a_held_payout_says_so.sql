-- -----------------------------------------------------------------------------
-- WHAT:  `my_pending_credit()` gains `under_review`: true while the reward's
--        payout is held for a check (a payout_reviews row short of approved).
-- WHY:   2026-10-14. A payable spotter whose payout tripped the collusion check
--        saw "Your £X reward — On its way… your bank may take a few days" for
--        as long as the review took — a promise about money that was not
--        moving. The tracker now says "A quick check before we send it".
--
-- SAFETY: the spotter learns THAT a check is under way, never why — the
--        reasons column stays service-role only (it would teach a fraudster
--        which signal caught them). Rejected reads exactly like pending:
--        "rejected" leaves the money held for manual action, so the honest
--        word for both is "being checked", and the difference is no one's to
--        learn from this screen. Same rule as payout_awaiting_payee: a review
--        `is distinct from 'approved'` holds the payout.
--        Caller-scoped exactly as before (auth.uid() is the spotter filter).
--
-- SHAPE: a new OUT column changes the return type, which `create or replace`
--        cannot do — so drop and create, then re-grant. Nothing in SQL calls
--        it; the app reads post_id and transfer_pence by name, so an app that
--        predates this ignores the new column.
-- LINKS: supabase/migrations/20260804110000_my_pending_credit.sql (the
--          definition replaced); 20260803140000_payout_collusion_check.sql
--          (payout_reviews); 20261007100000_a_credited_reward_has_a_deadline.sql
--          (payout_awaiting_payee — the same review rule);
--        src/features/payments/lib/payoutProgress.ts (the consumer).
-- -----------------------------------------------------------------------------

drop function if exists public.my_pending_credit();

create function public.my_pending_credit()
returns table (post_id uuid, transfer_pence integer, under_review boolean)
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
         )
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
  'The caller''s credited-but-unpaid bounty (post id + their 95% share via payout_split), and under_review: true while a payout_reviews row short of approved holds it (never why). Or no rows. Caller-scoped on auth.uid(); `limit 1` keeps it one row. Powers the "You''ve earned £X" context and the tracker''s last step on /payouts.';

revoke all on function public.my_pending_credit() from public;
revoke all on function public.my_pending_credit() from anon;
grant execute on function public.my_pending_credit() to authenticated;
