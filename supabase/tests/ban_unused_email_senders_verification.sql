-- =============================================================================
-- WHAT:  Verification for 20261027130000_ban_unused_email_senders.sql. NOT a migration.
-- WHY:   A signed-in account could keep the shared auth email budget empty
--        through email-change and reauthenticate sends the app never offers
--        (audit run 2, lead 4). The first such send must ban it and end its
--        sessions; ordinary sign-ins must never trip it.
-- CHECKS: 1 ⚠️ an email-change send bans the account and deletes its sessions,
-- and only its own · 2 a reauthenticate send does the same · 3 an ordinary
-- sign-in update, or clearing a stamp, bans no one.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        Seed users Alex (1111…) and Beth (2222…).
-- LINKS: supabase/migrations/20261027130000_ban_unused_email_senders.sql.
-- =============================================================================

begin;

insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('ba110000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', now(), now()),
  ('ba110000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', now(), now());

-- CHECK 3 — an ordinary sign-in stamp, or clearing a sent stamp, bans no one.
do $$
begin
  update auth.users set last_sign_in_at = now()
   where id = '22222222-2222-2222-2222-222222222222';
  update auth.users set email_change_sent_at = null, reauthentication_sent_at = null
   where id = '22222222-2222-2222-2222-222222222222';
  if (select banned_until from auth.users where id = '22222222-2222-2222-2222-222222222222') is not null
     or not exists (select 1 from auth.sessions where user_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 3 FAILED: an ordinary update banned the account or ended its session.';
  end if;
  raise notice 'CHECK 3 passed: an ordinary sign-in or a cleared stamp bans no one.';
end $$;

-- CHECK 1 — an email-change send.
do $$
begin
  update auth.users
     set email_change = 'someone-else@trackitdown.test', email_change_sent_at = now()
   where id = '11111111-1111-1111-1111-111111111111';
  if coalesce((select banned_until from auth.users where id = '11111111-1111-1111-1111-111111111111'),
              '-infinity') <= now() + interval '50 years' then
    raise exception 'CHECK 1 FAILED: an email-change send did not ban the account.';
  end if;
  if exists (select 1 from auth.sessions where user_id = '11111111-1111-1111-1111-111111111111') then
    raise exception 'CHECK 1 FAILED: the banned account kept its session.';
  end if;
  if not exists (select 1 from auth.sessions where user_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 1 FAILED: another account''s session was deleted.';
  end if;
  raise notice 'CHECK 1 passed: an email-change send bans the account and ends only its sessions.';
end $$;

-- CHECK 2 — a reauthenticate send.
do $$
begin
  update auth.users set reauthentication_sent_at = now()
   where id = '22222222-2222-2222-2222-222222222222';
  if coalesce((select banned_until from auth.users where id = '22222222-2222-2222-2222-222222222222'),
              '-infinity') <= now() + interval '50 years' then
    raise exception 'CHECK 2 FAILED: a reauthenticate send did not ban the account.';
  end if;
  if exists (select 1 from auth.sessions where user_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 2 FAILED: the banned account kept its session.';
  end if;
  raise notice 'CHECK 2 passed: a reauthenticate send bans the account and ends its sessions.';
end $$;

rollback;
