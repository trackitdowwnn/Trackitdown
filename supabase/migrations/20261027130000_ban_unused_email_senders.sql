-- =============================================================================
-- WHAT: An account that asks Supabase Auth to CHANGE ITS EMAIL or to
--       RE-AUTHENTICATE is banned and signed out on the spot. The app offers
--       neither, so no real user ever trips this (security audit run 2,
--       lead 4; the owner's choice, 2026-10-27).
--
-- WHY:  Every sign-in and sign-up code draws on ONE project-wide hourly email
--       budget. Captcha guards the anonymous code request, but a signed-in
--       session can also make Supabase Auth send email through PUT /auth/v1/user
--       {email} (an email change — two emails with Secure email change on) and
--       GET /auth/v1/reauthenticate. Those are not captcha-gated; only a
--       per-user resend interval spaced them, so one free account could keep
--       everyone else's sign-in codes failing for as long as it liked.
--
-- HOW:  A BEFORE UPDATE trigger on auth.users fires when Supabase Auth stamps
--       email_change_sent_at or reauthentication_sent_at. It sets
--       banned_until 100 years out (no new sign-in or refresh) and deletes the
--       account's sessions (Supabase Auth rejects a token whose session is
--       gone, so the next change-email request fails too). The send that
--       tripped it has already gone — this caps each account at ONE stray
--       email, and every further one costs a new captcha and a new code.
--       Runs as the caller (supabase_auth_admin owns auth.sessions); no
--       SECURITY DEFINER. Lifting a ban is an operator action in the
--       dashboard (Authentication → Users).
--       ⚠️ If the app ever offers changing email, remove this first.
-- =============================================================================

create or replace function public.ban_unused_email_senders()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.email_change_sent_at is not null
      and new.email_change_sent_at is distinct from old.email_change_sent_at)
     or (new.reauthentication_sent_at is not null
      and new.reauthentication_sent_at is distinct from old.reauthentication_sent_at) then
    -- Supabase's own "ban forever" (876000h); not 'infinity', which Auth's
    -- Go client cannot read back.
    new.banned_until := now() + interval '876000 hours';
    delete from auth.sessions where user_id = new.id;
  end if;
  return new;
end $$;

comment on function public.ban_unused_email_senders() is
  'Trigger on auth.users: an email-change or reauthentication send (flows the '
  'app never offers) bans the account and deletes its sessions, so one account '
  'cannot drain the shared auth email budget. 20261027130000.';

revoke execute on function public.ban_unused_email_senders() from public, anon, authenticated;

drop trigger if exists auth_users_ban_unused_email_senders on auth.users;
create trigger auth_users_ban_unused_email_senders
  before update of email_change_sent_at, reauthentication_sent_at on auth.users
  for each row execute function public.ban_unused_email_senders();
