-- =============================================================================
-- WHAT:  Write-side foundation for the "post a stolen car" wizard. Creates the
--        two Storage buckets the wizard uploads into (PUBLIC 'post-photos' and
--        PRIVATE 'verification-documents') with own-folder-only storage.objects
--        RLS; adds public.verification_documents (one row per uploaded V5C /
--        proof-of-ownership file, owner-readable, service-role-written); and
--        adds the SECURITY DEFINER RPC public.create_post(), the single server
--        write boundary that re-validates everything client-side zod cannot be
--        trusted for and assembles the draft post + photos + feature tags +
--        verification-doc row atomically.
-- WHY:   The wizard collects car details, 3–6 photos, a bounty, a last-seen
--        location, feature chips, and a V5C upload, then must produce ONE draft
--        post. The client must never (a) set status, (b) write the server-owned
--        descriptive columns outside the draft grant, (c) bypass the money/plate
--        safety rules, or (d) reach another user's files. So the whole write
--        runs through create_post under SECURITY DEFINER, and the buckets are
--        pinned to per-user folders exactly like the avatars bucket.
--
--        HANDOFF CONTRACT (payments feature, not built here): create_post ONLY
--        ever creates posts in status 'draft'. The escrow flow later flips
--        draft -> pending_verification on Stripe escrow success via its own
--        server-side transition (docs/DOMAIN.md lifecycle; SECURITY_AND_TRUST
--        §6). This RPC never advances the lifecycle and never touches money
--        beyond snapshotting the intended bounty onto the draft.
-- LINKS: docs/DOMAIN.md (post lifecycle: draft -> pending_verification -> active;
--          draft fields; £50–£5000 bounty; 90-day default expiry),
--        docs/SECURITY_AND_TRUST.md §2 (nothing public before verification; ONE
--          active post per plate; verification docs in a PRIVATE bucket, uploader
--          + moderators only), §6 (RLS deny-by-default; status server-only;
--          SECURITY DEFINER hardening; financial/lifecycle columns server-owned),
--        supabase/migrations/20260707110712_payments_foundation.sql (posts,
--          post_status enum, posts_insert_own_draft, client column grants),
--        supabase/migrations/20260710120000_profile_fields_and_avatars.sql
--          (the avatars bucket + own-folder storage.objects RLS mirrored here),
--        supabase/migrations/20260713140000_post_detail.sql (post_photos:
--          url/position, service-role-only writes),
--        supabase/migrations/20260713180000_post_detail_structured_data.sql
--          (post_feature/vehicle_feature; posts stolen_from/keys_taken/etc.).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: NONE. Fully additive — two idempotent
--        bucket inserts (on conflict do update), new storage.objects policies
--        scoped to those two buckets only, one new table + index + RLS + grants,
--        and one new function + grant. No drop / rename / truncate of any
--        existing object.
-- =============================================================================


-- =============================================================================
-- 1. STORAGE BUCKETS  (mirror the avatars bucket + own-folder storage.objects RLS)
-- =============================================================================

-- --- 1a. 'post-photos' — PUBLIC bucket -------------------------------------
-- Post photos are shown on public active-post detail/feed screens, so this
-- bucket is PUBLIC (served by plain CDN URL, no signed URLs) exactly like
-- avatars. SAFETY: file-size (5 MB) + MIME (jpeg/png/webp) limits are enforced
-- server-side by the Storage API regardless of what a client sends, stopping the
-- bucket being abused as free hosting or a phishing/HTML host on our domain.
-- on conflict DO UPDATE: idempotent AND corrective if the bucket pre-exists.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-photos', 'post-photos', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- --- 1b. 'verification-documents' — PRIVATE bucket -------------------------
-- SAFETY (SECURITY_AND_TRUST §2): this bucket is PRIVATE (public=false) — there
-- is NO public read. V5C / proof-of-ownership documents are sensitive personal
-- data and must be reachable ONLY by the uploader (their own folder, via a
-- signed URL) and later by moderators via the service role. Moderator read
-- access arrives with the moderation feature (a service-role Edge Function
-- signing URLs for the review queue); it is deliberately NOT granted to any
-- client role here. Larger 10 MB limit + PDF allowed (logbooks are often PDFs).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verification-documents', 'verification-documents', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- SAFETY: storage.objects has RLS enabled by Supabase with no default policies,
-- so both buckets are deny-by-default until the policies below. Each policy is
-- scoped to a single bucket_id and never loosens access to any other bucket.

-- --- post-photos: own-folder WRITE only, NO select (mirrors avatars) --------

-- SAFETY: deliberately NO select policy for 'post-photos'. Public-bucket URL
-- delivery does not pass through RLS, so photos still load by plain URL — but
-- withholding SELECT denies the Storage LIST api, which would otherwise let a
-- scraper enumerate every uploader's folder and bulk-harvest photos (the same
-- logged-out-enumeration concern the avatars bucket addresses).

-- SAFETY: a signed-in user may UPLOAD only under their OWN folder — the object
-- path must start with '<their auth.uid()>/'. Prevents planting files under
-- another user's folder (impersonation) or seeding a post they do not own.
create policy "post_photos_insert_own_folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- SAFETY: a signed-in user may REPLACE (upsert) only objects in their own
-- folder. USING pins which existing rows they can touch; WITH CHECK stops a
-- rename/move that would land the object in someone else's folder or bucket.
create policy "post_photos_update_own_folder"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- SAFETY: a signed-in user may DELETE only objects in their own folder
-- (removing a photo they added while editing a draft; also erasure cleanup).
create policy "post_photos_delete_own_folder"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- --- verification-documents: own-folder WRITE + own-folder SELECT -----------

-- SAFETY: a signed-in user may UPLOAD their V5C only under their OWN folder.
create policy "verification_documents_insert_own_folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- SAFETY: a signed-in user may REPLACE their own V5C only within their own
-- folder (re-upload a clearer scan). WITH CHECK stops moving it elsewhere.
create policy "verification_documents_update_own_folder"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- SAFETY: a signed-in user may DELETE only their own V5C object.
create policy "verification_documents_delete_own_folder"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- SAFETY (PRIVATE bucket): unlike post-photos/avatars, this bucket has NO public
-- URL delivery, so the uploader needs an explicit SELECT policy to mint a signed
-- URL for and re-fetch THEIR OWN document (own folder only). No non-owner client
-- role can read it. Moderator read arrives later via the service role (which
-- bypasses RLS) in the moderation feature — NOT granted to any client here.
create policy "verification_documents_select_own_folder"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );


-- =============================================================================
-- 2. TABLE: verification_documents
-- One row per uploaded proof-of-ownership file (V5C logbook photo/PDF).
-- =============================================================================
create table public.verification_documents (
  id           uuid primary key default gen_random_uuid(),

  -- The post this document proves ownership of. ON DELETE CASCADE: the doc row
  -- is wholly owned by its post and carries no independent value, so it dies
  -- with the post (contrast payments' ON DELETE RESTRICT). NOTE: this cascades
  -- only the DB row — the storage object in verification-documents is removed
  -- separately by the retention/erasure job (SECURITY_AND_TRUST §2: docs deleted
  -- or anonymised 30 days after the post closes).
  post_id      uuid not null references public.posts (id) on delete cascade,

  -- Path (object name) inside the PRIVATE verification-documents bucket, e.g.
  -- '<owner uid>/<post id>/v5c.pdf'. The uploader fetches it via a signed URL
  -- under the own-folder storage.objects SELECT policy above.
  storage_path text not null,

  created_at   timestamptz not null default now()
);

comment on table public.verification_documents is
  'One row per uploaded V5C/proof-of-ownership file for a post. storage_path points into the PRIVATE verification-documents bucket. Rows are written ONLY by create_post (SECURITY DEFINER) / service role; readable by the post owner (RLS) and later moderators (service role). SECURITY_AND_TRUST §2.';
comment on column public.verification_documents.storage_path is
  'Object name in the PRIVATE verification-documents bucket (own-folder pinned, e.g. <uid>/<post id>/v5c.pdf). Never a public URL.';

-- Index for the RLS EXISTS predicate below and the by-post lookup (moderation /
-- retention both fetch a post's docs by post_id).
create index verification_documents_post_id_idx
  on public.verification_documents (post_id);

alter table public.verification_documents enable row level security;

-- SAFETY: under this project's config (auto_expose_new_tables unset in
-- config.toml) a new public table auto-grants NO data privileges, so the SELECT
-- policy below is dead without an explicit table-level SELECT grant. Grant
-- SELECT to authenticated ONLY (never anon — these are sensitive personal docs);
-- the policy narrows visibility to the owning post's owner. NO client
-- insert/update/delete grant — rows are written by create_post (SECURITY
-- DEFINER, runs as owner) and the service role. service_role bypasses RLS but is
-- not auto-granted, so give it full DML (moderation/retention use it).
grant select on public.verification_documents to authenticated;
grant select, insert, update, delete on public.verification_documents to service_role;

-- SAFETY: a signed-in user may read a verification-document ROW only for a post
-- they OWN (they may check that their upload was recorded). This does NOT grant
-- read of the file itself — that is the separate own-folder storage.objects
-- SELECT policy. Non-owners (incl. anon) get nothing; no write policy exists, so
-- client writes are denied by default.
create policy verification_documents_select_own_post
  on public.verification_documents
  for select
  to authenticated
  using (
    exists (
      select 1 from public.posts p
      where p.id = verification_documents.post_id
        and p.owner_id = (select auth.uid())
    )
  );


-- =============================================================================
-- 3. RPC: create_post(...) -> jsonb   (SECURITY DEFINER — the write boundary)
-- =============================================================================
-- Creates ONE draft post from everything the wizard collected and returns
-- { "post_id": <uuid>, "status": "draft" }.
--
-- SAFETY (Tier 1 — read before editing anything below):
--   * SECURITY DEFINER, so it BYPASSES RLS and the posts client column grants.
--     That is deliberate: it lets this one trusted path write the server-owned
--     columns clients may NOT (status, year, body_type, stolen_from, keys_taken,
--     the two desc_ fields, expires_at) while STILL pinning owner_id to the
--     caller and hard-coding status = 'draft'. It is the ONLY place these are
--     written for a new post.
--   * status is hard-coded 'draft'. There is NO status parameter. The lifecycle
--     is never client-selectable; escrow success advances it later, server-side.
--   * auth.uid() reads the CALLER's JWT claim (a request GUC), not the definer
--     role, so it correctly identifies the caller under SECURITY DEFINER. It is
--     schema-qualified so it resolves regardless of search_path.
--   * ALL validation below is a SERVER re-check. The client's zod runs on the
--     device and cannot be trusted; these gates are the enforcement.
--   * A plpgsql function body is a single transaction, so the post + photos +
--     feature tags + verification-doc row are inserted ATOMICALLY: any raise (or
--     a bad feature_key FK error) rolls the whole thing back — no orphan draft.
--
-- search_path fixed to public, extensions so the PostGIS constructors
-- (ST_SetSRID/ST_MakePoint) resolve whether PostGIS is installed into public
-- (fresh local) or the extensions schema (Supabase-hosted).
--
-- DVLA NOTE: DVLA lookup is stubbed for now, so there are NO fuel/engine params
-- and the plate check is a FORMAT gate only, not an ownership/existence check.
create or replace function public.create_post(
  p_plate                   text,
  p_make                    text,
  p_model                   text,
  p_colour                  text,
  p_year                    int,
  p_body_type               text,
  p_distinguishing_features text,
  p_owner_note              text,
  p_desc_recognise          text,
  p_desc_drives             text,
  p_stolen_from             text,
  p_keys_taken              text,
  p_last_seen_at            timestamptz,
  p_last_seen_lat           double precision,
  p_last_seen_lng           double precision,
  p_last_seen_area          text,
  p_bounty_amount_pence     int,
  p_photo_urls              text[],
  p_feature_keys            text[],
  p_verification_path       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner       uuid := auth.uid();
  v_post_id     uuid;
  v_plate       text;   -- normalised (upper, trimmed) plate as stored/displayed
  v_plate_canon text;   -- alphanumeric-only, for space-insensitive uniqueness
  v_photo_count int  := coalesce(array_length(p_photo_urls, 1), 0);
begin
  -- SAFETY: must be signed in. Under SECURITY DEFINER auth.uid() is still the
  -- caller; a null means no/invalid JWT. (execute is granted to authenticated +
  -- service_role only, never anon — this is a belt-and-braces backstop.)
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- --- Plate FORMAT gate (not DVLA validation) --------------------------------
  -- Normalise to upper/trimmed for storage, and to an alphanumeric-only canon
  -- for comparison. The gate is intentionally PERMISSIVE — it tolerates current,
  -- older, and personal plates — but rejects empty/garbage: the canon must be
  -- 2–8 alphanumerics (a real UK plate is at most 7). This is a format sanity
  -- check, NOT proof the plate exists or that the caller owns it (that is the
  -- V5C + moderator review step, SECURITY_AND_TRUST §2).
  v_plate       := upper(trim(coalesce(p_plate, '')));
  v_plate_canon := upper(regexp_replace(coalesce(p_plate, ''), '[^A-Za-z0-9]', '', 'g'));
  if v_plate_canon !~ '^[A-Z0-9]{2,8}$' then
    raise exception 'INVALID_PLATE';
  end if;

  -- --- Plate UNIQUENESS (SECURITY_AND_TRUST §2 — one active post per plate) ----
  -- A plate may not be created while another post for the SAME plate is already
  -- live or in flight: active, pending_verification, or recovery_claimed (the
  -- "money in escrow / on the road" states). Drafts do NOT block (a user may be
  -- mid-wizard on the same car). Compared space-insensitively via the canon.
  if exists (
    select 1
    from public.posts p
    where upper(regexp_replace(coalesce(p.plate, ''), '[^A-Za-z0-9]', '', 'g')) = v_plate_canon
      and p.status in ('active', 'pending_verification', 'recovery_claimed')
  ) then
    raise exception 'PLATE_IN_USE';
  end if;

  -- --- Required fields --------------------------------------------------------
  -- The wizard cannot reach "post" without these; re-check server-side so a
  -- crafted request cannot create a half-empty draft. (bounty null is caught
  -- here as MISSING_REQUIRED rather than as an out-of-range value.)
  if p_make is null or p_model is null or p_colour is null
     or p_last_seen_at is null
     or p_last_seen_lat is null or p_last_seen_lng is null
     or p_bounty_amount_pence is null then
    raise exception 'MISSING_REQUIRED';
  end if;

  -- --- MONEY: bounty range ----------------------------------------------------
  -- MONEY: integer pence, GBP implied. £50 (5000) min, £5000 (500000) max
  -- (DOMAIN.md fraud ceiling). The posts CHECK enforces the same bound as a
  -- backstop; this gives the client a clean, mappable error first.
  if p_bounty_amount_pence < 5000 or p_bounty_amount_pence > 500000 then
    raise exception 'BOUNTY_OUT_OF_RANGE';
  end if;

  -- --- Photo count ------------------------------------------------------------
  -- 3–6 photos: enough to identify the car, capped so the carousel/payload stays
  -- bounded and the bucket is not abused as free storage.
  if v_photo_count < 3 or v_photo_count > 6 then
    raise exception 'PHOTO_COUNT';
  end if;

  -- --- Constrained enums (null allowed; posts CHECK also enforces) ------------
  -- Re-checked here so the client gets a clean error rather than a raw CHECK
  -- violation. NULL = not captured.
  if p_stolen_from is not null
     and p_stolen_from not in ('driveway', 'street', 'car_park', 'other') then
    raise exception 'INVALID_STOLEN_FROM';
  end if;
  if p_keys_taken is not null
     and p_keys_taken not in ('yes', 'no', 'unknown') then
    raise exception 'INVALID_KEYS_TAKEN';
  end if;

  -- --- Atomic assembly (single transaction) -----------------------------------
  -- SAFETY: owner_id pinned to the caller; status HARD-CODED 'draft'; expires_at
  -- set server-side to now()+90d (DOMAIN.md default window). last_seen_location
  -- is a PostGIS geography point built from (lng, lat) — ST_MakePoint takes
  -- longitude first. SECURITY DEFINER is what lets this write year/body_type/
  -- stolen_from/keys_taken/desc_* and status, none of which are in the posts
  -- client grants.
  insert into public.posts (
    owner_id, plate, make, model, colour,
    year, body_type, distinguishing_features, owner_note,
    desc_recognise, desc_drives, stolen_from, keys_taken,
    last_seen_at, last_seen_location, last_seen_area,
    bounty_amount_pence, status, expires_at
  )
  values (
    v_owner, v_plate, p_make, p_model, p_colour,
    p_year, p_body_type, p_distinguishing_features, p_owner_note,
    p_desc_recognise, p_desc_drives, p_stolen_from, p_keys_taken,
    p_last_seen_at,
    ST_SetSRID(ST_MakePoint(p_last_seen_lng, p_last_seen_lat), 4326)::geography,
    p_last_seen_area,
    p_bounty_amount_pence, 'draft', now() + interval '90 days'
  )
  returning id into v_post_id;

  -- Photos: one row per url, position = ordinality-1 so display order matches
  -- the order the wizard sent them (0-based, as post_photos expects).
  insert into public.post_photos (post_id, url, position)
  select v_post_id, u.url, (u.ord - 1)::int
  from unnest(p_photo_urls) with ordinality as u(url, ord);

  -- Feature tags: one row per key. The FK to vehicle_feature enforces validity —
  -- an unknown key raises a foreign-key error that rolls back the whole insert
  -- (acceptable: the client picks keys from the same seeded taxonomy).
  if p_feature_keys is not null and array_length(p_feature_keys, 1) is not null then
    insert into public.post_feature (post_id, feature_key)
    select v_post_id, k
    from unnest(p_feature_keys) as k;
  end if;

  -- Verification document row (if the wizard uploaded a V5C). The file itself is
  -- already in the PRIVATE verification-documents bucket under the caller's
  -- folder; we just record the path.
  if p_verification_path is not null then
    insert into public.verification_documents (post_id, storage_path)
    values (v_post_id, p_verification_path);
  end if;

  -- AUDIT: a post-created audit-log insert belongs here once the audit_log table
  -- exists (SECURITY_AND_TRUST §7). Deferred with the moderation feature.

  return jsonb_build_object('post_id', v_post_id, 'status', 'draft');
end;
$$;

comment on function public.create_post(
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text
) is
  'The write boundary for the post-a-car wizard. SECURITY DEFINER: pins owner_id to the caller, HARD-CODES status=draft, sets expires_at=now()+90d, and atomically inserts the post + photos + feature tags + verification-doc row. Re-validates plate format, one-active-post-per-plate (SECURITY_AND_TRUST §2), bounty £50–£5000, 3–6 photos, required fields, and the stolen_from/keys_taken enums. Raises: NOT_AUTHENTICATED, INVALID_PLATE, PLATE_IN_USE, MISSING_REQUIRED, BOUNTY_OUT_OF_RANGE, PHOTO_COUNT, INVALID_STOLEN_FROM, INVALID_KEYS_TAKEN. Only ever creates drafts; escrow success advances the lifecycle later, server-side.';


-- =============================================================================
-- 4. FUNCTION GRANT
-- =============================================================================
-- SAFETY: functions default to EXECUTE granted to PUBLIC. Lock that down and
-- grant deliberately to authenticated + service_role ONLY — NOT anon. Posting a
-- car requires a signed-in account (the post is owned by, and verification docs
-- belong to, a real user); an anon caller has no auth.uid() to own the post.
-- NOTE: `revoke ... from public` here is insufficient on Supabase — the project's
-- ALTER DEFAULT PRIVILEGES auto-grants EXECUTE to anon at CREATE time. The
-- explicit `revoke ... from anon` that closes that gap lives in the follow-up
-- 20260713191000_create_post_deny_anon.sql (this migration was already applied
-- before the gap was caught, so the fix is forward-only). The function is safe
-- regardless: its first act raises NOT_AUTHENTICATED when auth.uid() is null.
revoke execute on function public.create_post(
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text
) from public;
grant execute on function public.create_post(
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text
) to authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
