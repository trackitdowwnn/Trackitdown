-- -----------------------------------------------------------------------------
-- WHAT:  `payouts_relevant()` — one boolean: does the CALLER have any reason to
--        see a payouts surface at all?
-- WHY:   Credit-time-only setup (the 2026-08-04 decision): there is no upfront
--        payout setup any more, so a spotter who has never been credited has
--        NOTHING to set up — and a settings row inviting them to do it anyway
--        would be a screen about a thing that has not happened. The Profile
--        row now renders only when this returns true: they have a payee
--        account (status, "update bank details"), or money is waiting for
--        them. The `credited` push is the front door for everyone else.
--
-- SAFETY: caller-scoped on auth.uid(); a single boolean leaves the database.
--        Deliberately NOT which of the two reasons is true — the screen it
--        gates finds that out through its own scoped reads.
-- LINKS: supabase/migrations/20260804110000_my_pending_credit.sql;
--        src/features/profile/screens/ProfileScreen.tsx (the row);
--        docs/decisions/ADR-0010-whitelabel-payouts.md.
-- -----------------------------------------------------------------------------

create or replace function public.payouts_relevant()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.stripe_connected_accounts
     where profile_id = (select auth.uid())
  )
  or exists (
    select 1
      from public.sightings s
      join public.posts po on po.id = s.post_id
     where s.spotter_id = (select auth.uid())
       and s.status = 'credited'
       and po.status = 'recovery_claimed'
  );
$$;

comment on function public.payouts_relevant() is
  'Whether the caller has any reason to see a payouts surface: a payee account exists, or a credited bounty awaits. Gates the Profile row under credit-time-only setup — the credited push is the front door for everyone else. Caller-scoped; returns one boolean.';

revoke all on function public.payouts_relevant() from public;
revoke all on function public.payouts_relevant() from anon;
grant execute on function public.payouts_relevant() to authenticated;
