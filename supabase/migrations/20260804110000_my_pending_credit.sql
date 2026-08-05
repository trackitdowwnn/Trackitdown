-- -----------------------------------------------------------------------------
-- WHAT:  `my_pending_credit()` — the CALLER's credited-but-unpaid bounty, if
--        they have one: which post, and how much of it is theirs.
-- WHY:   The earn moment. The `credited` push lands ("You've earned £X") and
--        its tap opens /payouts — which until now had no way to know WHY the
--        spotter arrived, so it greeted the best moment in the product with
--        generic setup copy. This read powers the context line and the amount.
--
-- MONEY: the amount comes from `payout_split`, the one definition of the 95/5
--        arithmetic — the same rule the credited push's copy follows, so the
--        push and the screen can never disagree about the number.
--
-- SAFETY: caller-scoped by construction (auth.uid() is the spotter filter —
--        no parameter names a user), and it returns the caller's OWN pending
--        credit only. Nothing about the owner, the car, or anyone else's
--        credits. Refusals and absences are identical: an empty result.
-- LINKS: supabase/migrations/20260804100000_credited_notification.sql (the
--          push whose tap lands here);
--        supabase/migrations/20260802220000_release_payout.sql (payout_split);
--        src/features/payments/screens/PayoutsScreen.tsx (the consumer).
-- -----------------------------------------------------------------------------

create or replace function public.my_pending_credit()
returns table (post_id uuid, transfer_pence integer)
language sql
security definer
set search_path = ''
as $$
  select s.post_id,
         (select split.transfer_pence
            from public.payout_split(p.amount_pence) as split)
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
  'The caller''s credited-but-unpaid bounty (post id + their 95% share via payout_split), or no rows. Caller-scoped on auth.uid(); single winner per post and `limit 1` across posts keeps it one row. Powers the "You''ve earned £X" context on /payouts.';

revoke all on function public.my_pending_credit() from public;
revoke all on function public.my_pending_credit() from anon;
grant execute on function public.my_pending_credit() to authenticated;
