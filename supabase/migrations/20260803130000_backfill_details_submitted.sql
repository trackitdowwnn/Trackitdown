-- -----------------------------------------------------------------------------
-- WHAT:  Marks every payee account that existed BEFORE the native details form
--        as having had its details collected.
-- WHY:   `details_submitted_at` gates the Account Session mint, so that our own
--        form gets to run while Stripe still accepts prefilled details. Adding
--        the column left every existing row null — and those are precisely the
--        accounts whose window is already SHUT, because the only code that
--        existed before this created a Link or a Session on the first tap.
--
--        Without this backfill those spotters are stuck in a loop with no exit:
--
--          connect-onboarding -> details_required
--            -> our form -> accounts.update -> Stripe refuses (window closed)
--            -> DETAILS_REJECTED -> tap again -> details_required -> ...
--
--        Nothing in the flow gives up on the form and mints a session anyway,
--        so the loop is permanent. Backfilling sends them straight to the
--        embedded component, which is the only thing that can still help them.
--
--        `created_at`, not `now()`: it records when the account came into being,
--        which is the honest answer to "when did we stop being able to prefill
--        this one" — and it does not pretend the form ran today.
--
--        Deliberately not conditional on having a Link or Session: we cannot
--        see that from here, and the safe direction is obvious. Skipping the
--        form for an account that could have used it costs one screen of
--        typing; NOT skipping it for an account that cannot costs the feature.
-- LINKS: supabase/migrations/20260803120000_payout_details_submitted.sql;
--        supabase/functions/connect-onboarding/index.ts (the gate);
--        supabase/functions/submit-payout-details/index.ts.
-- -----------------------------------------------------------------------------

update public.stripe_connected_accounts
   set details_submitted_at = created_at
 where details_submitted_at is null;
