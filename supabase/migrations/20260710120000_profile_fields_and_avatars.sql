-- =============================================================================
-- WHAT:  Profile feature migration. Adds first_name, avatar_url, updated_at,
--        and the three server-maintained Reputation v1 counters to
--        public.profiles; extends the client column grants to cover the new
--        editable fields; creates the public 'avatars' storage bucket with
--        own-folder-only write policies on storage.objects; and leaves a
--        commented outline for the future delete-account Edge Function.
-- WHY:   Spotter identity is shown as "first name + reputation only"
--        (docs/SECURITY_AND_TRUST.md §1), so the profile needs a first_name
--        distinct from display_name, an avatar image, and the Reputation v1
--        counters (docs/DOMAIN.md "Reputation (v1)": sightings reported,
--        sightings marked helpful, recoveries credited — social proof only,
--        never affects payouts). Counters must be forgery-proof, so they are
--        writable only by service-role/Edge Functions, never by clients.
-- LINKS: docs/DOMAIN.md (Reputation v1 — counters on the profile, badges at
--        1/5/25 thresholds, never affects payouts),
--        docs/SECURITY_AND_TRUST.md §1 (first name + reputation only),
--        §3 (UK GDPR minimisation/deletion), §6 (RLS deny by default),
--        supabase/migrations/20260707110712_payments_foundation.sql (house
--        patterns: explicit grants, set_updated_at(), column-level privileges).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. This migration is fully
--        additive — no drop/rename/truncate of existing objects. All changes
--        are ALTER TABLE ... ADD COLUMN, new grants, one bucket insert, and
--        new policies.
-- =============================================================================


-- =============================================================================
-- 1. PROFILES: new columns
-- =============================================================================

alter table public.profiles
  -- What owners see next to sightings (SECURITY_AND_TRUST §1: spotter identity
  -- is first name + reputation only). Default '' so existing rows stay valid;
  -- the app enforces non-empty on edit — the DB deliberately does not, so the
  -- backfill default cannot fail and legacy rows can be prompted to complete.
  add column first_name text not null default '',

  -- Storage PATH into the 'avatars' bucket (created below), never a free
  -- URL: the CHECK pins it to exactly the user's own folder, so a client
  -- cannot point their avatar at an attacker-controlled host (remote
  -- tracking pixel / IP-leak vector) or at another user's file. The app
  -- builds the public URL and cache-busts with updated_at.
  add column avatar_path text
    constraint profiles_avatar_path_own_folder
    check (avatar_path is null or avatar_path = id::text || '/avatar.jpg'),

  -- House pattern: updated_at maintained by the shared set_updated_at()
  -- trigger (created in 20260707110712), never by the client.
  add column updated_at timestamptz not null default now(),

  -- Reputation v1 counters (docs/DOMAIN.md). Server-maintained ONLY.
  -- >= 0 checks: a counter can never go negative, even via a server bug.
  add column sightings_reported   integer not null default 0
                                    check (sightings_reported   >= 0),
  add column sightings_helpful    integer not null default 0
                                    check (sightings_helpful    >= 0),
  add column recoveries_credited  integer not null default 0
                                    check (recoveries_credited  >= 0);

comment on column public.profiles.first_name is
  'Shown to owners next to sightings (SECURITY_AND_TRUST §1: first name + reputation only). App enforces non-empty on edit; DB default '''' keeps legacy rows valid.';
comment on column public.profiles.avatar_path is
  'Storage path in the avatars bucket, CHECK-pinned to <own id>/avatar.jpg. Nullable. The app builds the public URL and cache-busts with updated_at.';
comment on column public.profiles.sightings_reported is
  'Reputation v1 counter (docs/DOMAIN.md). Incremented ONLY by service-role/Edge Functions — excluded from all client grants. Social proof only; never affects payouts.';
comment on column public.profiles.sightings_helpful is
  'Reputation v1 counter (docs/DOMAIN.md). Incremented ONLY by service-role/Edge Functions — excluded from all client grants. Social proof only; never affects payouts.';
comment on column public.profiles.recoveries_credited is
  'Reputation v1 counter (docs/DOMAIN.md). Incremented ONLY by service-role/Edge Functions — excluded from all client grants. Social proof only; never affects payouts.';

-- House pattern: updated_at kept honest by the shared trigger function.
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 2. PROFILES: extend client column grants
-- =============================================================================

-- SAFETY: the payments-foundation migration revoked table-wide INSERT/UPDATE
-- from anon/authenticated and granted only (id, display_name) for INSERT and
-- (display_name) for UPDATE. We extend those column lists to the new
-- client-editable fields ONLY. The reputation counters and updated_at are
-- deliberately ABSENT from every client grant: reputation is social proof
-- shown next to sightings, so a client-writable counter would be a forgeable
-- trust signal (a fraudster could inflate "recoveries credited" to make fake
-- sightings look credible). updated_at is owned by the trigger. The RLS
-- policies from 20260707110712 (insert/update self only, id pinned to
-- auth.uid()) continue to govern which ROWS these column grants can touch.
grant insert (id, display_name, first_name, avatar_path) on public.profiles to authenticated;
grant update (display_name, first_name, avatar_path)     on public.profiles to authenticated;

-- (No new SELECT grant needed: 20260707110712 already granted table-level
-- SELECT to authenticated and full DML to service_role; the counters ride
-- along as readable social proof for signed-in users, per DOMAIN.md.)


-- =============================================================================
-- 3. STORAGE: 'avatars' bucket + own-folder-only write policies
-- =============================================================================

-- Public bucket: avatar images are non-sensitive by design (unlike the
-- verification-documents bucket, which will be PRIVATE — SECURITY_AND_TRUST
-- §2). Public read serves avatars by plain URL with CDN caching, no signed
-- URLs. SAFETY: file-size and MIME limits stop the bucket being abused as
-- free hosting or a public HTML/phishing host on our project domain — the
-- storage API enforces these server-side regardless of what a client sends.
-- on conflict DO UPDATE: idempotent AND corrective if the bucket pre-exists.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- SAFETY: storage.objects has RLS enabled by Supabase with no default
-- policies, so the avatars bucket is deny-by-default until the policies
-- below. Each policy is scoped to bucket_id = 'avatars' and never loosens
-- access to any other (current or future, e.g. private verification-docs)
-- bucket.

-- SAFETY: deliberately NO select policy on storage.objects for this bucket.
-- Public-bucket URL delivery does not go through RLS, so avatars still load
-- by plain URL — but withholding SELECT denies the storage LIST api, which
-- would otherwise let a logged-out scraper enumerate every user id with an
-- avatar and bulk-harvest face photos (the same logged-out-enumeration
-- concern the profiles SELECT policy addresses in 20260707110712).

-- SAFETY: a signed-in user may UPLOAD only under their own folder — the
-- object path must start with '<their auth.uid()>/'. Prevents overwriting or
-- planting files under another user's avatar path (impersonation).
create policy "avatars_insert_own_folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- SAFETY: a signed-in user may REPLACE (upsert) only objects in their own
-- folder. USING pins which existing rows they can touch; WITH CHECK stops a
-- rename/move that would land the object in someone else's folder or bucket.
create policy "avatars_update_own_folder"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- SAFETY: a signed-in user may DELETE only objects in their own folder
-- (removing their own avatar; also used by account-deletion cleanup).
create policy "avatars_delete_own_folder"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );


-- =============================================================================
-- 4. FUTURE WORK (comment only — no code in this migration):
--    delete-account Edge Function
-- =============================================================================
-- The profile screen's "delete account" action must NOT delete client-side.
-- It calls a service-role Edge Function that:
--
--   1. RE-CHECKS server-side that the caller owns NO post currently in
--      ('active', 'pending_verification', 'recovery_claimed') — i.e. no post
--      with money in escrow or a payout pending. The client's own check is
--      advisory only; this server check is the enforcement. (The payments
--      table's ON DELETE RESTRICT on post_id is the last-resort backstop.)
--   2. Performs Stripe cleanup: cancels/refunds any dangling PaymentIntents
--      per the refund rules in docs/DOMAIN.md, and handles the user's Connect
--      account out-of-band (see stripe_connected_accounts table comment).
--   3. Deletes the auth.users row (UK GDPR erasure — SECURITY_AND_TRUST §3),
--      which CASCADEs to public.profiles and public.posts per the FK rules in
--      20260707110712, honouring the retention rules in SECURITY_AND_TRUST §2
--      (verification docs deleted/anonymised 30 days after post close) and §3
--      (closed posts' sighting location history purged after 90 days).
--   4. Removes the user's avatars/<uid>/ objects from storage (the storage
--      rows do not cascade from auth.users).
--   5. Writes an audit-log row for the erasure (SECURITY_AND_TRUST §7) once
--      the audit_log table exists.
-- =============================================================================


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
