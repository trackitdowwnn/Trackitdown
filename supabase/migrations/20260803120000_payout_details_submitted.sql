-- -----------------------------------------------------------------------------
-- WHAT:  Records that a spotter has given us their payout details through OUR
--        form, plus the writer for it.
-- WHY:   Stripe lets a platform submit bank details and identity fields for an
--        Express account through the API — but ONLY until the first Account
--        Session or Account Link exists:
--
--          "you can update all information until you create an Account Link or
--           Account Session, after which some properties can no longer be
--           updated"  (Accounts API, controller.requirement_collection = stripe)
--
--        That window is the only reason a native bank-details form is possible
--        at all, and it shuts permanently and silently. Until 2026-08-03 the
--        onboarding function created the account and minted a session in the
--        same request, closing the window on the very first tap — nobody could
--        ever have used a form of ours.
--
--        So the session mint now waits for this timestamp. It is a GATE, not
--        analytics: `connect-onboarding` refuses to create a session while it
--        is null, which is what keeps the window open long enough for the form
--        to be shown.
--
-- PRIVACY: this column records only THAT details were submitted, never what
--        they were. Bank details pass through the Edge Function to Stripe and
--        are never stored here, in any column, or written to any log.
-- LINKS: supabase/functions/submit-payout-details/index.ts (the only writer);
--        supabase/functions/connect-onboarding/index.ts (reads it as a gate);
--        docs/decisions/ADR-0002-stripe-connect.md.
-- -----------------------------------------------------------------------------

alter table public.stripe_connected_accounts
  add column if not exists details_submitted_at timestamptz;

comment on column public.stripe_connected_accounts.details_submitted_at is
  'When the spotter submitted payout details through our own form. Gates the '
  'Account Session mint: Stripe permits API-side prefill of an Express account '
  'only until the first session exists, so minting one before the form is shown '
  'would shut that window forever. Records only THAT details were given — never '
  'what they were.';

-- -----------------------------------------------------------------------------
-- The writer. Mirrors upsert_connected_account: the table has SELECT-own only
-- and no client write grant, so the Edge Function needs a service-role way in,
-- and the rule lives in one audited place rather than in a raw table write.
--
-- Deliberately NOT folded into upsert_connected_account: that one is also called
-- by the account.updated webhook, which knows nothing about our form and would
-- have to pass a value for this on every capability change.
-- -----------------------------------------------------------------------------
create or replace function public.mark_payout_details_submitted(
  p_profile_id        uuid,
  p_stripe_account_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.stripe_connected_accounts
    (profile_id, stripe_account_id, onboarding_complete, payouts_enabled,
     details_submitted_at)
  values (p_profile_id, p_stripe_account_id, false, false, now())
  on conflict (profile_id) do update
    -- Never regresses the readiness flags: those belong to the account.updated
    -- webhook, and a spotter re-submitting their details must not appear to
    -- become unpayable for the moment in between.
    set stripe_account_id      = excluded.stripe_account_id,
        details_submitted_at   = now(),
        updated_at             = now();
end $$;

comment on function public.mark_payout_details_submitted(uuid, text) is
  'Service-role writer recording that payout details were submitted through our '
  'own form (never the details themselves). Leaves onboarding_complete and '
  'payouts_enabled untouched — only the account.updated webhook may move those.';

revoke all on function public.mark_payout_details_submitted(uuid, text) from public;
revoke all on function public.mark_payout_details_submitted(uuid, text) from anon;
revoke all on function public.mark_payout_details_submitted(uuid, text) from authenticated;
grant execute on function public.mark_payout_details_submitted(uuid, text) to service_role;
