-- =============================================================================
-- WHAT:  Own-folder SELECT policies on storage.objects for the 'avatars' and
--        'post-photos' buckets, mirroring each bucket's insert/update folder
--        rule. Idempotent (drop-if-exists first).
-- WHY:   Every app upload uses `upsert: true`, which the storage API executes
--        as INSERT ... ON CONFLICT DO UPDATE — and Postgres requires the
--        target row to be VISIBLE under the table's SELECT policies for that
--        statement, even on a first-ever upload with no conflicting row.
--        These two buckets deliberately had NO select policy (the
--        anti-enumeration decision in 20260710120000 / 20260713190000), so
--        every upsert upload failed with 403 "new row violates row-level
--        security policy" while the insert/update policies were correct.
--        Diagnosed live 2026-07-20: plain POST succeeded, x-upsert POST
--        failed; sighting-photos and verification-documents already had
--        select policies and were unaffected.
--        The anti-enumeration goal survives: these policies are scoped to
--        the caller's OWN folder, so the storage LIST api still exposes no
--        other user's files, and anon still has no select at all (public
--        avatar URLs bypass RLS; they are unaffected either way).
--        NOTE: already applied to the live project via the dashboard SQL
--        editor on 2026-07-20 (CLI auth was broken); running this again via
--        `db push` is a harmless re-apply.
-- LINKS: supabase/migrations/20260710120000_profile_fields_and_avatars.sql,
--        supabase/migrations/20260713190000_post_a_car.sql (the buckets +
--        write policies); src/features/profile/api/profileApi.ts,
--        src/features/vehicles/post/api/postApi.ts (upsert callers).
-- =============================================================================

-- SAFETY: scoped to the caller's own folder — a signed-in user can see (and
-- therefore upsert onto) only their own files; enumeration of other users'
-- folders through the storage LIST api remains denied.
drop policy if exists "avatars_select_own_folder" on storage.objects;
create policy "avatars_select_own_folder"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "post_photos_select_own_folder" on storage.objects;
create policy "post_photos_select_own_folder"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
