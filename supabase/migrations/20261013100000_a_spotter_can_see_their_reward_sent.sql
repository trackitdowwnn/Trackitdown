-- -----------------------------------------------------------------------------
-- WHAT:  `my_latest_payout()` — the CALLER's most recent reward that has been
--        sent to them: which post, how much, and when it was sent.
-- WHY:   PR2b of the payments UX plan (2026-10-13, owner: "not much if any
--        progress indicators"). Payouts now draws a tracker ending in "Your
--        £190 reward", but the app could only ever see a reward WAITING
--        (`my_pending_credit`, payments.status = 'held'): the moment it was
--        released, the step had nothing to stand on and the tracker vanished,
--        so the last thing a spotter saw was never "sent". This read lets the
--        last step say "Sent 13 October".
--
-- WHAT "SENT" MEANS: `released` — Stripe has transferred the spotter's share to
--        their connected account (mark_recovery_paid). It is NOT "in your
--        bank": the payout from Stripe to the bank is Stripe's own schedule,
--        and nothing here records it. The app's copy says "sent", and that its
--        bank may take a few days to show it — never "arrived".
--
-- WHEN:  `updated_at`. payments has no released_at; updated_at is the record of
--        when a payout happened — 20261005110000 says so in as many words and
--        suspends the trigger around its backfill to keep it true. A released
--        row is terminal: mark_recovery_paid's update is guarded on 'held', and
--        no later writer touches a released row.
--
-- MONEY: `transfer_amount_pence` as RECORDED at release — the number Stripe
--        actually moved (mark_recovery_paid re-derives and checks it against
--        payout_split before writing). Not recomputed here.
--
-- SAFETY: the payments ledger stays service-role only (payments_foundation's
--        SAFETY note): this is a narrow security-definer read, caller-scoped by
--        construction — auth.uid() selects the caller's own connected account,
--        and no parameter names a user. Three columns, one row, the caller's
--        own money only: nothing about the owner, the car, the payment intent
--        or the platform's fee. `bounty_escrow` only — a listing fee is never
--        anyone's payout. Absent and refused read the same: no rows.
-- LINKS: supabase/migrations/20260804110000_my_pending_credit.sql (its sibling:
--          the reward still waiting);
--        supabase/migrations/20260802220000_release_payout.sql
--          (mark_recovery_paid, the one writer of 'released');
--        src/features/payments/lib/payoutProgress.ts (the consumer);
--        supabase/tests/my_latest_payout_verification.sql.
-- -----------------------------------------------------------------------------

create or replace function public.my_latest_payout()
returns table (post_id uuid, transfer_pence integer, sent_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.post_id,
         p.transfer_amount_pence,
         p.updated_at
    from public.payments p
    join public.stripe_connected_accounts a on a.id = p.payee_account_id
   where a.profile_id = (select auth.uid())
     and p.status = 'released'
     and p.kind = 'bounty_escrow'
   order by p.updated_at desc
   limit 1;
$$;

comment on function public.my_latest_payout() is
  'The caller''s most recently RELEASED bounty (post id, the transfer pence recorded at release, and updated_at as the sent time), or no rows. Caller-scoped on auth.uid() via their own connected account; bounty_escrow only. "Sent" means transferred to their Stripe account, not arrived in their bank. Powers the last step of the /payouts tracker.';

revoke all on function public.my_latest_payout() from public;
revoke all on function public.my_latest_payout() from anon;
grant execute on function public.my_latest_payout() to authenticated;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
