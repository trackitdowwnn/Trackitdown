-- -----------------------------------------------------------------------------
-- WHAT:  upsert_connected_account never turns `onboarding_complete` back off:
--        once a spotter's details are recorded as submitted, a later write
--        that says otherwise leaves them submitted. `payouts_enabled` is still
--        copied exactly — Stripe is the authority on that one.
-- WHY:   2026-10-13. Payout accounts made by create-payout-account (Accounts
--        v2, our own setup steps) are recorded onboarding_complete = true by
--        that function — our steps ARE the submission. But two other writers
--        copy v1's `details_submitted` straight in: the account.updated
--        webhook and connect-onboarding's reconcile. For a v2 account with no
--        Stripe dashboard that v1 flag need not be true, and copying it would
--        flip a spotter who just sent everything back to "A few more details
--        are needed from you" — blaming them for a flag they never saw.
--
--        In the RPC, not in each writer: one rule, every caller, including
--        the new sync-payout-account and any writer added later.
--
--        Is "never undone" safe? details_submitted on Stripe means the form
--        was finished; Stripe asking for MORE later shows as payouts being
--        disabled (requirements), never as the form becoming unfinished. So
--        the flag that can move — payouts_enabled — still moves both ways.
--
-- SAFETY: same signature, same grants (service-role only; CREATE OR REPLACE
--        keeps them). No client can call it.
-- LINKS: supabase/migrations/20260802220000_release_payout.sql (the original);
--        supabase/functions/sync-payout-account/index.ts;
--        supabase/tests/payout_account_sync_verification.sql.
-- -----------------------------------------------------------------------------

create or replace function public.upsert_connected_account(
  p_profile_id          uuid,
  p_stripe_account_id   text,
  p_onboarding_complete boolean,
  p_payouts_enabled     boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.stripe_connected_accounts
    (profile_id, stripe_account_id, onboarding_complete, payouts_enabled)
  values (p_profile_id, p_stripe_account_id, p_onboarding_complete, p_payouts_enabled)
  on conflict (profile_id) do update
    set stripe_account_id   = excluded.stripe_account_id,
        -- Once submitted, submitted (see the header).
        onboarding_complete = public.stripe_connected_accounts.onboarding_complete
                              or excluded.onboarding_complete,
        payouts_enabled     = excluded.payouts_enabled,
        updated_at          = now();
end $$;

comment on function public.upsert_connected_account(uuid, text, boolean, boolean) is
  'Service-role writer for stripe_connected_accounts (the table has SELECT-own only). Called by create-payout-account, connect-onboarding, sync-payout-account and the account.updated webhook. onboarding_complete is never turned back off once true (20261013130000); payouts_enabled is copied as given.';

-- Grants re-stated: CREATE OR REPLACE keeps them, and this says so in code.
revoke all on function public.upsert_connected_account(uuid, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.upsert_connected_account(uuid, text, boolean, boolean) to service_role;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
