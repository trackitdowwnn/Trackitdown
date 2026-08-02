-- =============================================================================
-- WHAT:  public.account_deletions — a minimal, service-role-only record that an
--        account erasure happened. Satisfies item 5 of the delete-account
--        outline in 20260710120000_profile_fields_and_avatars.sql.
-- WHY:   Two independent needs, one table.
--
--        1. GDPR RECORD-KEEPING. UK GDPR Art. 5(2) accountability means we must
--           be able to show that an erasure request was honoured. The erased
--           rows themselves obviously cannot evidence that.
--
--        2. THE STRIPE CONNECT LINK SURVIVES THE CASCADE. Deleting auth.users
--           cascades profiles, which cascades stripe_connected_accounts — so the
--           mapping from this person to their Stripe account vanishes at exactly
--           the moment we might still need it. A spotter can be erased while a
--           payout is mid-flight, and Stripe accounts cannot always be deleted
--           on demand (a non-zero balance blocks it), so Connect teardown is
--           explicitly out-of-band per the stripe_connected_accounts comment.
--           Without this row, that teardown has nothing to act on.
--
-- SAFETY: DELIBERATELY MINIMAL. This is the one table that outlives an erasure,
--        so every column has to earn the right to persist:
--          * deleted_user_id — kept. It is the only join key to Stripe metadata
--            (payment intents carry it) and to log lines during an
--            investigation. It is an opaque uuid, not a name, email, phone,
--            plate or location.
--          * stripe_account_id — kept, for the reason above. Financial-record
--            retention is a separate lawful basis from the account itself.
--          * NO name, NO email, NO avatar, NO post content, NO location.
--        If an erasure must be total (a regulator instruction rather than a
--        user request), delete the row here too — nothing references it.
--
--        NO client grants and NO policies. RLS is enabled with zero policies,
--        which denies everything; only service_role (which bypasses RLS) can
--        read or write it. anon and authenticated get nothing, so this can
--        never become a "was this person deleted?" oracle.
-- LINKS: supabase/functions/delete-account/index.ts (the only writer);
--        supabase/migrations/20260710120000_profile_fields_and_avatars.sql
--          (the FUTURE WORK outline this closes);
--        docs/SECURITY_AND_TRUST.md §3 (erasure) and §7 (audit log).
-- =============================================================================

create table public.account_deletions (
  id uuid primary key default gen_random_uuid(),

  -- NOT a foreign key, by necessity: the auth.users row it names is gone by the
  -- time this is written. A FK would make the insert impossible.
  deleted_user_id uuid not null,

  -- Null when the user never onboarded to Connect (the common case — only
  -- spotters who have claimed a bounty have one).
  stripe_account_id text,

  -- How many storage objects the erasure removed. Cheap to record and it is the
  -- number an auditor actually asks for ("what did you delete?"), plus it makes
  -- a silently-failing storage sweep visible as a run of zeroes.
  storage_objects_removed integer not null default 0,

  deleted_at timestamptz not null default now()
);

comment on table public.account_deletions is
  'Service-role-only record that an account erasure completed. Outlives the erased account BY DESIGN — see the SAFETY note in the migration. Holds no name, email, location or post content. RLS on with no policies: anon and authenticated can never read it, so it is not a "was this user deleted?" oracle.';
comment on column public.account_deletions.deleted_user_id is
  'The erased auth.users id. Opaque uuid, deliberately NOT a foreign key (the referent is gone). Kept because Stripe metadata and log lines join on it.';
comment on column public.account_deletions.stripe_account_id is
  'The user''s Connect account, captured BEFORE the cascade destroys stripe_connected_accounts, so out-of-band payout teardown has something to act on. Null if they never onboarded.';

-- An erasure is rare and this table is only ever read by a human investigating
-- one, so the uuid PK is the only index it needs — except this, which is the
-- lookup an out-of-band Stripe teardown actually performs.
create index account_deletions_stripe_account_id_idx
  on public.account_deletions (stripe_account_id)
  where stripe_account_id is not null;

-- Deny-by-default: RLS on, ZERO policies. Only service_role reaches this.
alter table public.account_deletions enable row level security;

-- Explicitly revoke, do not merely omit. Supabase ships
-- ALTER DEFAULT PRIVILEGES granting anon/authenticated on new tables in this
-- schema — the exact hole 20260802170000_revoke_default_table_privileges.sql
-- was written to close. Omitting a grant here would NOT be the same as denying.
revoke all on public.account_deletions from anon;
revoke all on public.account_deletions from authenticated;
grant select, insert on public.account_deletions to service_role;
