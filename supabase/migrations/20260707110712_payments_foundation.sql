-- =============================================================================
-- WHAT:  First schema migration for Trackitdown. Creates the core money and
--        lifecycle tables: profiles, posts, stripe_connected_accounts, and the
--        payments (escrow/payout) ledger — plus the post lifecycle enum, the
--        payment status enum, a shared set_updated_at() trigger, and
--        deny-by-default Row Level Security on every table.
-- WHY:   Trackitdown holds bounties in Stripe escrow and pays a single winning
--        spotter on recovery. Post status and money state are the source of
--        truth in Postgres (docs/ARCHITECTURE.md rule 4) and must be protected
--        by RLS and server-only status transitions so the client can never
--        mutate lifecycle or financial state directly.
-- LINKS: docs/DOMAIN.md (post lifecycle, £50–£5000 bounty, integer pence),
--        docs/SECURITY_AND_TRUST.md §6 (RLS deny-by-default, status via
--        security-definer/Edge Functions, financial tables service-role only),
--        docs/decisions/ADR-0002-stripe-connect.md (Accounts v2 Express,
--        separate charges & transfers, lazy connected accounts, transfer math).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. This migration is fully
--        additive — no drop/rename/truncate of existing objects.
--
-- SCOPE:  Only core money/lifecycle tables. Sightings, chat, notifications,
--         moderation, verification documents, and the PostGIS last-seen
--         location column arrive in LATER migrations. Where those tables would
--         be referenced, a commented TODO is left instead of a dangling FK.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest.
-- WHY: house pattern established here (no prior migrations). Every table with an
--      updated_at column uses this one function so the timestamp cannot be
--      spoofed by the client.
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
-- Empty search_path is the Supabase hardening standard; this function is the
-- house pattern every later table copies. now() resolves from pg_catalog.
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger function: sets updated_at = now() on any row update. Shared by all tables with an updated_at column.';


-- =============================================================================
-- ENUMS
-- =============================================================================

-- Post lifecycle. Mirrors docs/DOMAIN.md exactly. Clients NEVER write this
-- column directly; transitions go through security-definer functions / Edge
-- Functions (see SECURITY_AND_TRUST.md §6). New states must be added here AND
-- to the transition functions in a later migration.
create type public.post_status as enum (
  'draft',                  -- owner is filling in car details; not paid/verified
  'pending_verification',   -- proof uploaded + bounty escrowed; awaiting moderator
  'active',                 -- live and publicly visible; spotters alerted
  'recovery_claimed',       -- owner/moderator marked recovered; picking a sighting
  'recovered',              -- a sighting credited; 95% paid to spotter, 5% kept
  'recovered_no_spotter',   -- recovered without a credited sighting; bounty refunded
  'cancelled',              -- owner cancelled before recovery; bounty refunded
  'expired',                -- hit expiry (default 90 days); bounty refunded
  'rejected'                -- verification failed; never went public; refunded
);

comment on type public.post_status is
  'Stolen-car post lifecycle. Source: docs/DOMAIN.md. Transitions only via security-definer functions / Edge Functions, never client update.';

-- Escrow/payout ledger lifecycle for a single bounty payment.
-- Reflects ADR-0002: charge captured immediately to the platform balance
-- (held), then either transferred to the winning spotter (released) or
-- refunded to the owner. No manual-capture auth hold (those expire ~7 days).
create type public.payment_status as enum (
  'requires_payment',       -- PaymentIntent created, not yet successfully charged
  'held',                   -- charge captured to platform balance; in escrow
  'released',               -- transfer sent to winning spotter (95%); 5% retained
  'refunded',               -- bounty refunded to owner (no-spotter/cancel/expire/reject)
  'failed'                  -- charge failed; no funds held
);

comment on type public.payment_status is
  'Escrow lifecycle for a bounty. Source: ADR-0002 separate charges & transfers. Written only by service role / Edge Functions.';


-- =============================================================================
-- TABLE: profiles
-- 1:1 with auth.users. The public-facing user row.
-- =============================================================================
create table public.profiles (
  -- Same id as the auth user. ON DELETE CASCADE: when an auth user is deleted
  -- (UK GDPR erasure), their profile row is removed with them.
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now()
);

comment on table public.profiles is
  '1:1 public profile per auth user. Minimal by design (UK GDPR data minimisation). Reputation counters/badges arrive in a later migration.';

alter table public.profiles enable row level security;

-- SAFETY: deny by default. The policies below are the ONLY grants. A profile
-- row's display_name is shown next to active posts and (later) sightings/chat, so
-- any signed-in user may read any profile row — the row deliberately contains no
-- sensitive fields. Read is restricted to `authenticated` (NOT anon): requiring a
-- login to see display_names blocks logged-out enumeration/scraping of the whole
-- user base (SECURITY_AND_TRUST §1 identity minimisation). Revisit before adding
-- any private column (email, phone, etc.), and expose spotter identity via a
-- first-name + reputation view/RPC rather than the raw row.
create policy profiles_select_authenticated
  on public.profiles
  for select
  to authenticated
  using (true);

-- SAFETY: a user may create only their own profile row (id must equal their uid).
create policy profiles_insert_self
  on public.profiles
  for insert
  to authenticated
  with check (id = (select auth.uid()));

-- SAFETY: a user may update only their own profile row and cannot re-point it at
-- another user's id (with check pins id to their uid).
create policy profiles_update_self
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No delete policy: profile deletion is driven by auth.users deletion (cascade),
-- not by direct client delete.

-- SAFETY: freeze created_at (and id-on-update) with column privileges, matching
-- the posts pattern. Clients may INSERT only (id, display_name) and UPDATE only
-- display_name; the policies above pin id to auth.uid(). Prevents backdating
-- created_at or repointing a profile at another user's id.
revoke insert, update on public.profiles from anon, authenticated;
grant insert (id, display_name) on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

-- SAFETY: the new-Supabase default (auto_expose_new_tables unset in config.toml)
-- auto-grants NO data privileges on new public tables, so the SELECT policy above
-- is dead without an explicit table-level SELECT grant. Grant SELECT to
-- authenticated ONLY (not anon) so display_names require a login to read; the
-- policy still governs visibility. service_role (Edge Functions) is trusted
-- server-side, bypasses RLS, and is likewise not auto-granted — give it full DML.
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;


-- =============================================================================
-- TABLE: posts
-- The stolen-car post. Lifecycle + bounty amount live here.
-- =============================================================================
create table public.posts (
  id                   uuid primary key default gen_random_uuid(),

  -- Owner of the post. FK to profiles (which is 1:1 with auth.users).
  -- ON DELETE CASCADE: deleting the owner removes their posts. This is safe
  -- because a post cannot actually be deleted while money is in flight — the
  -- payments ledger references the post with ON DELETE RESTRICT and blocks the
  -- cascade until the ledger row is resolved/removed server-side.
  owner_id             uuid not null references public.profiles (id) on delete cascade,

  status               public.post_status not null default 'draft',

  -- MONEY: bounty in integer pence, GBP implied. £50 min, £5000 max (DOMAIN.md
  -- fraud ceiling). Never numeric/float. NOT NULL so a draft always names a
  -- valid intended bounty before escrow.
  bounty_amount_pence  integer not null
                         check (bounty_amount_pence between 5000 and 500000),

  -- UK number plate, stored uppercase/normalised (validation in shared/lib).
  -- Nullable so a brand-new draft can exist before details are entered.
  -- TODO(payments-foundation): "one active post per plate" (SECURITY_AND_TRUST
  --   §2) needs a partial unique index once plate normalisation is finalised;
  --   deferred so drafts with null plate don't collide.
  plate                text,
  make                 text,
  model                text,
  colour               text,

  last_seen_at         timestamptz,
  -- TODO(payments-foundation): last-seen LOCATION is a PostGIS
  --   geography(Point, 4326) column added with the sightings/search migration
  --   (needs the postgis extension + a GiST index for ST_DWithin radius
  --   matching). Not added here to keep this migration extension-free.

  expires_at           timestamptz,   -- default 90-day window set by app/Edge Fn

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.posts is
  'Stolen-car post. status drives the lifecycle (docs/DOMAIN.md) and is server-controlled. bounty_amount_pence is integer GBP pence, £50–£5000.';
comment on column public.posts.status is
  'Lifecycle state. SAFETY: never updated by clients — the column is excluded from the client UPDATE grant below; transitions run in security-definer functions / Edge Functions.';
comment on column public.posts.bounty_amount_pence is
  'MONEY: bounty in integer pence, GBP. CHECK enforces £50–£5000.';

-- Index for RLS + hot query: public search filters on status = 'active';
-- owners list "my posts" by owner_id.
create index posts_status_idx    on public.posts (status);
create index posts_owner_id_idx  on public.posts (owner_id);

create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

alter table public.posts enable row level security;

-- SAFETY: status (and id/owner_id/created_at) are server-controlled. Under this
-- project's config (auto_expose_new_tables unset in config.toml) a new public
-- table auto-grants NO data privileges — only the SELECT/UPDATE below take effect
-- — so we grant UPDATE on ONLY the client-editable draft columns and never on
-- status/owner_id/id. The table-wide `revoke update` is a defensive no-op today
-- that guards against a future re-enable of auto_expose (where Postgres would take
-- the GREATER of table- and column-level privileges and a lingering table-wide
-- UPDATE grant would otherwise defeat the column grant). With no UPDATE privilege
-- on status, an owner's draft-edit path cannot move a post through its lifecycle no
-- matter what RLS allows; and they cannot change owner_id (transfer a post) or id.
-- Lifecycle transitions run under the service role, which bypasses both RLS and
-- column grants. See SECURITY_AND_TRUST.md §6.
revoke update on public.posts from anon, authenticated;
grant update (plate, make, model, colour, bounty_amount_pence, last_seen_at)
  on public.posts to authenticated;

-- SAFETY: expires_at is server-controlled, NOT in the update grant above. The
-- 90-day expiry window is set by the activate/renew Edge Function; letting a
-- client set it would let an owner push expiry far out so the bounty never
-- auto-refunds (a money-lifecycle escape). See docs/DOMAIN.md.

-- SAFETY: freeze server-controlled columns on INSERT too. Without this a client
-- could supply its own id / created_at / updated_at (forging creation time) or
-- set expires_at. Grant INSERT on ONLY the draft-authorable columns; status
-- defaults to 'draft', id/timestamps use their defaults, expires_at is set
-- server-side at activation.
revoke insert on public.posts from anon, authenticated;
grant insert (owner_id, plate, make, model, colour, bounty_amount_pence, last_seen_at)
  on public.posts to authenticated;

-- SAFETY: with auto_expose_new_tables unset no SELECT is auto-granted, so the
-- SELECT policies below (active-public + own) never fire without this. Row
-- visibility stays fully governed by those RLS policies; the grant only makes them
-- reachable. Both anon and authenticated need it (public browse + "my posts").
-- Draft edits also need it: UPDATE ... WHERE id=... reads the filtered columns.
grant select on public.posts to anon, authenticated;
-- service_role runs the lifecycle/status transitions (bypasses RLS); grant full DML.
grant select, insert, update, delete on public.posts to service_role;

-- SAFETY (anti-stalking, SECURITY_AND_TRUST §2): the public may read a post ONLY
-- once it is 'active'. No post is visible before ownership verification passes.
create policy posts_select_active_public
  on public.posts
  for select
  to anon, authenticated
  using (status = 'active');

-- SAFETY: an owner may read their OWN posts in any status (draft, pending, etc.).
create policy posts_select_own
  on public.posts
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

-- SAFETY: an authenticated user may create a post only as themselves and only in
-- the 'draft' state. Escrow + verification (pending_verification onward) are
-- reached via server transitions, never by inserting a later status directly.
create policy posts_insert_own_draft
  on public.posts
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and status = 'draft'
  );

-- SAFETY: an owner may edit the details of their OWN post ONLY while it is still
-- a 'draft'. status is excluded from the client UPDATE grant above, so this path
-- can change plate/make/model/colour/bounty/last_seen/expires but can never
-- change status. Once the post leaves draft it is read-only to the client; all
-- further changes are server-side. Both USING and WITH CHECK pin status to
-- 'draft' so a row cannot be edited on its way out of, or into, draft.
create policy posts_update_own_draft
  on public.posts
  for update
  to authenticated
  using (
    owner_id = (select auth.uid())
    and status = 'draft'
  )
  with check (
    owner_id = (select auth.uid())
    and status = 'draft'
  );

-- No client DELETE policy: posts are never hard-deleted by clients (money may be
-- in escrow). Cancellation is a status transition; erasure is server-driven.


-- =============================================================================
-- TABLE: stripe_connected_accounts
-- A spotter's Stripe Connect (Accounts v2, Express) account for payouts.
-- Created LAZILY at the first credited sighting (ADR-0002). One per user.
-- =============================================================================
create table public.stripe_connected_accounts (
  id                  uuid primary key default gen_random_uuid(),

  -- One connected account per user. FK to profiles; UNIQUE enforces 1:1.
  -- ON DELETE CASCADE: if the profile (auth user) is erased, drop the local
  -- pointer row. The Stripe-side account is handled out-of-band by the erasure
  -- Edge Function; this row is just our reference to it.
  profile_id          uuid not null unique
                        references public.profiles (id) on delete cascade,

  -- The Stripe Connect account id (acct_...). Unique: never reuse across users.
  stripe_account_id   text not null unique,

  -- Onboarding + payout readiness, driven by Stripe account.updated webhooks
  -- (ADR-0002). Payouts must be enabled before release-payout can transfer.
  onboarding_complete boolean not null default false,
  payouts_enabled     boolean not null default false,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.stripe_connected_accounts is
  'Spotter Stripe Connect account (Accounts v2, Express) for payouts. Created lazily at first credited sighting (ADR-0002). Written only by Edge Functions.';

create index stripe_connected_accounts_profile_id_idx
  on public.stripe_connected_accounts (profile_id);

create trigger stripe_connected_accounts_set_updated_at
  before update on public.stripe_connected_accounts
  for each row execute function public.set_updated_at();

alter table public.stripe_connected_accounts enable row level security;

-- SAFETY: financial table. NO write access for anon/authenticated at all — rows
-- are created and mutated only by the service role (Edge Functions), which
-- bypasses RLS. The single client grant is a minimal SELECT so a spotter can see
-- THEIR OWN onboarding/payout status in the app (to prompt KYC). No insert,
-- update, or delete policy exists, so those are denied by default.
create policy stripe_connected_accounts_select_own
  on public.stripe_connected_accounts
  for select
  to authenticated
  using (profile_id = (select auth.uid()));

-- SAFETY: financial table. Grant table-level SELECT ONLY to authenticated so the
-- select-own policy above can return a spotter's own row (visibility still limited
-- to their own account by the policy). anon gets nothing. Writes stay service-role
-- only — rows are created/mutated by Edge Functions on Stripe account webhooks.
grant select on public.stripe_connected_accounts to authenticated;
grant select, insert, update, delete on public.stripe_connected_accounts to service_role;


-- =============================================================================
-- TABLE: payments
-- Escrow/payout ledger. One row tracks a bounty from charge to release/refund.
-- All amounts integer pence. Written ONLY by the service role / Edge Functions.
-- =============================================================================
create table public.payments (
  id                        uuid primary key default gen_random_uuid(),

  -- The post whose bounty this payment funds. ON DELETE RESTRICT: never allow a
  -- post to be deleted while a payment ledger row exists — money state must
  -- survive. This also backstops the posts.owner_id ON DELETE CASCADE above: a
  -- funded post cannot be cascade-deleted while a payment references it.
  post_id                   uuid not null
                              references public.posts (id) on delete restrict,

  -- Stripe PaymentIntent for the escrow charge (captured to platform balance).
  -- Unique: one escrow charge tracked once. NOT NULL because we create this
  -- ledger row together with the intent.
  stripe_payment_intent_id  text not null unique,

  status                    public.payment_status not null default 'requires_payment',

  -- MONEY: the full bounty charged, integer pence GBP. Immutable snapshot of what
  -- was actually charged (the post's bounty could differ if edited pre-charge).
  amount_pence              integer not null
                              check (amount_pence between 5000 and 500000),

  -- Payout leg (ADR-0002 transfer math). All nullable: unknown until recovery.
  -- The winning spotter's connected account. ON DELETE RESTRICT: never orphan a
  -- payout by deleting the payee account row while it is referenced.
  payee_account_id          uuid
                              references public.stripe_connected_accounts (id)
                              on delete restrict,

  stripe_transfer_id        text unique,  -- the payout transfer (tr_...), once released

  -- MONEY: 95% transferred to the spotter, 5% retained by the platform. Computed
  -- SERVER-SIDE only (never in the app client) as round(amount_pence * 0.95) and
  -- the remainder. Nullable until release; non-negative when set.
  transfer_amount_pence     integer check (transfer_amount_pence is null or transfer_amount_pence >= 0),
  platform_fee_pence        integer check (platform_fee_pence    is null or platform_fee_pence    >= 0),

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table public.payments is
  'Escrow/payout ledger for a bounty (ADR-0002 separate charges & transfers). Integer pence throughout. Written only by service role / Edge Functions.';
comment on column public.payments.amount_pence is
  'MONEY: full bounty charged to escrow, integer pence GBP.';
comment on column public.payments.transfer_amount_pence is
  'MONEY: 95% paid to winning spotter, computed server-side. Null until release.';
comment on column public.payments.platform_fee_pence is
  'MONEY: 5% platform fee retained, computed server-side. Null until release.';

-- Index for hot lookups: reconcile a post's money state, resolve a payee's
-- payouts, and scan by status. All used by Edge Functions / webhooks.
create index payments_post_id_idx          on public.payments (post_id);
create index payments_payee_account_id_idx on public.payments (payee_account_id);
create index payments_status_idx           on public.payments (status);

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

alter table public.payments enable row level security;

-- SAFETY: financial table. RLS is ENABLED with NO policies for anon/authenticated,
-- so ALL client access (select/insert/update/delete) is denied by default. The
-- ledger is read and written exclusively by the service role (Edge Functions),
-- which bypasses RLS. Owners see their money status indirectly via the post's
-- lifecycle state, not by reading this ledger. Do not add a client policy here
-- without reviewing SECURITY_AND_TRUST.md §4/§6.

-- SAFETY: NO grant to anon/authenticated — the ledger is never client-readable
-- (owners see money state indirectly via post status). Only service_role (Edge
-- Functions) touches it; it bypasses RLS but is still not auto-granted under
-- auto_expose_new_tables unset, so grant its DML explicitly.
grant select, insert, update, delete on public.payments to service_role;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
