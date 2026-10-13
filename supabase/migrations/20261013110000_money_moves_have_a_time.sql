-- -----------------------------------------------------------------------------
-- WHAT:  `payments.released_at` and `payments.refunded_at` — WHEN a reward was
--        paid out, or refunded — stamped by a trigger the moment the status
--        becomes 'released' or 'refunded', whichever function moved it.
-- WHY:   PR4 of the payments UX plan (2026-10-13): an owner's reward timeline
--        ("£500 refunded on 16 October"). The ledger never recorded these
--        moments. updated_at stood in, and it moves with any later write —
--        payout_notified_at, payout_lapse_notified_at, delete_cancelled_post's
--        detach — as my_latest_payout found the hard way (20261013100000).
--
--        A TRIGGER, NOT SIX EDITS. Money reaches 'released' through one
--        function and 'refunded' through five (mark_post_payment_refunded,
--        mark_post_recovered_no_spotter, mark_reward_ended_refunded,
--        mark_payout_lapsed_refunded, reconcile_payment_refund). Rewriting each
--        of those money functions to stamp a time would be six chances to get
--        something else wrong; one BEFORE trigger on the status column stamps
--        every one of them, and any writer added later, without touching them.
--
--        Stamped ONCE: only while null, so a replayed write never moves it,
--        and only on a real change of status. `before update of status` means
--        writes to any other column never even run it.
--
-- BACKFILL: existing rows get the best moment the ledger has, and it is an
--        ESTIMATE, said here rather than hidden:
--        - released: the earlier of payout_notified_at (the "sent" push, a few
--          seconds after release) and updated_at;
--        - refunded: updated_at — at or after the refund, never before it.
--        The updated_at trigger is suspended around the backfill (the
--        20261005110000 pattern) so it doesn't stamp every row with today.
--
-- SAFETY: columns are server-written only, like the rest of the ledger: no
--        client grant changes (payments stays service-role only). Readers go
--        through narrow caller-scoped functions (20261013120000).
-- LINKS: supabase/migrations/20261013120000_an_owner_can_see_their_reward.sql
--          (the reader); supabase/tests/money_moves_have_a_time_verification.sql;
--        supabase/migrations/20260802220000_release_payout.sql (mark_recovery_paid).
-- -----------------------------------------------------------------------------

alter table public.payments
  add column released_at timestamptz,
  add column refunded_at timestamptz;

comment on column public.payments.released_at is
  'When the reward was paid out (status became released). Stamped once by payments_stamp_money_moment. Rows released before 2026-10-13 carry an estimate: the earlier of payout_notified_at and updated_at.';
comment on column public.payments.refunded_at is
  'When the payment was refunded (status became refunded). Stamped once by payments_stamp_money_moment. Rows refunded before 2026-10-13 carry an estimate: updated_at, at or after the refund.';

create or replace function public.stamp_payment_money_moment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'released' and new.released_at is null then
      new.released_at := now();
    end if;
    if new.status = 'refunded' and new.refunded_at is null then
      new.refunded_at := now();
    end if;
  end if;
  return new;
end $$;

comment on function public.stamp_payment_money_moment() is
  'BEFORE INSERT / UPDATE OF status on payments: stamps released_at / refunded_at the first time a payment reaches that status. Never moves an existing stamp.';

revoke all on function public.stamp_payment_money_moment() from public, anon, authenticated;

create trigger payments_stamp_money_moment
  before insert or update of status on public.payments
  for each row execute function public.stamp_payment_money_moment();

-- The backfill — see the header. Other columns only, so the stamp trigger
-- (UPDATE OF status) does not fire; the updated_at trigger is held off.
alter table public.payments disable trigger payments_set_updated_at;

update public.payments
   set released_at = least(payout_notified_at, updated_at)
 where status = 'released'
   and released_at is null;

update public.payments
   set refunded_at = updated_at
 where status = 'refunded'
   and refunded_at is null;

alter table public.payments enable trigger payments_set_updated_at;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
