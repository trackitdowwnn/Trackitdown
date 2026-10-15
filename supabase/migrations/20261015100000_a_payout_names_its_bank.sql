-- -----------------------------------------------------------------------------
-- WHAT:  The last four digits of the bank a spotter's rewards go to:
--          1. stripe_connected_accounts.bank_last4 — exactly four digits, or null.
--          2. record_bank_last4 — its one writer, service role only.
-- WHY:   2026-10-15 (payout experience redesign, PR7). The Payouts tracker
--        said "Paid into your bank on 16 October" — but WHICH bank, for
--        someone who has changed it, or set it up months ago? "Paid into
--        account ending 5678" is what a bank statement says, and what tells
--        them where to look.
--
-- SOURCE: Stripe's own answer, never what was typed. create-payout-account
--        records it from the bank account Stripe returns when it attaches
--        one (all three attach points); sync-payout-account refreshes it from
--        the account's default bank, for a bank changed anywhere else.
--
-- PRIVACY: the last four only — what Stripe, the bank and every statement
--        already show. Never the sort code, never the full number. The client
--        reads it through the table's existing select-own policy (its own row
--        only), as it reads payouts_enabled. Never logged by the writers.
--
-- MONEY: none. A label; nothing reads it to decide anything.
-- LINKS: supabase/functions/create-payout-account/index.ts;
--        supabase/functions/sync-payout-account/index.ts;
--        supabase/functions/_shared/payoutAccountState.ts (bankLast4);
--        supabase/tests/bank_last4_verification.sql;
--        src/features/payments/lib/payoutView.ts (the consumer).
-- -----------------------------------------------------------------------------

-- =============================================================================
-- 1. The column
-- =============================================================================
alter table public.stripe_connected_accounts
  add column if not exists bank_last4 text
    constraint stripe_connected_accounts_bank_last4_chk check (bank_last4 ~ '^[0-9]{4}$');

comment on column public.stripe_connected_accounts.bank_last4 is
  'Last four digits of the bank account Stripe pays this payee into (2026-10-15), as Stripe reports it. Written only by record_bank_last4; read by the owner of the row (select-own) for "Paid into account ending 5678". Never the sort code or the full number.';


-- =============================================================================
-- 2. record_bank_last4
-- =============================================================================
-- Ignores anything that isn't four digits rather than raising: a malformed
-- answer from Stripe must never fail the bank attach it rides along with.
-- Unchanged values don't write, so a sync on every visit costs nothing.
--
-- ⚠️ A DIFFERENT BANK IS A REPLACED BANK (security review, 2026-10-15). The
-- app names the bank on a payout only when no replacement came after it — and
-- bank_replaced_at was stamped only by our form's RE-BANK. A bank changed any
-- other way (a setup re-run, a legacy account's own dashboard) would arrive
-- here by sync with no stamp, and an older payout would read "Paid into
-- account ending <the NEW one>" — the wrong place to look. So replacing one
-- known value with another stamps it too. The first value is not a change.
create or replace function public.record_bank_last4(
  p_stripe_account_id text,
  p_last4             text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.stripe_connected_accounts
     set bank_last4 = p_last4,
         bank_replaced_at = case
           when bank_last4 is not null then now()
           else bank_replaced_at
         end
   where stripe_account_id = p_stripe_account_id
     and p_last4 ~ '^[0-9]{4}$'
     and bank_last4 is distinct from p_last4;
$$;

revoke all on function public.record_bank_last4(text, text) from public, anon, authenticated;
grant execute on function public.record_bank_last4(text, text) to service_role;

comment on function public.record_bank_last4(text, text) is
  'Records the last four digits of a payee''s bank, as Stripe reports it (create-payout-account on attach; sync-payout-account on refresh). Four digits or ignored. Service role only (2026-10-15).';
