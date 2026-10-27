-- =============================================================================
-- WHAT: A signed-in user may upload to post-photos, sighting-photos and
--       avatars ONLY under the names the app itself writes (security audit
--       run 2, lead 7):
--         post-photos      <uid>/[mark-]<hash>-<n>.jpg   (src/shared/api/photoUpload.ts)
--         sighting-photos  <post>/<uid>/<hash>-<n>.jpg   (sightings/api/sightingApi.ts)
--         avatars          <uid>/avatar.jpg              (profile/api/profileApi.ts)
--
-- WHY:  The own-folder policies checked only the folder, so a direct Storage
--       API caller could write ANY name into their folder of the PUBLIC
--       post-photos bucket — '<uid>/a.png', '<uid>/x.webp' — and the hourly
--       sweep (enqueue_unreferenced_uploads, 20261026160000) deliberately
--       matches only the app's naming, so those files were served from our
--       CDN, on our bill, until the uploader deleted their own account.
--       Refusing the name at upload closes it: every client-written object
--       now has a name the sweep recognises, and an avatar is one file.
--
-- HOW:  Each policy is restated with the same folder test plus a name regex.
--       The post-photos and sighting-photos regexes are the sweep's own, so
--       the two cannot drift apart unnoticed (the suite checks both).
--       Service-role writes (scripts/demo-photos, Edge Functions) bypass RLS
--       and are unaffected — prod's 90 'demo-…' photos are all referenced.
--       Existing objects are not touched.
--       ⚠️ A new upload name in the app must be added HERE and to the sweep.
-- =============================================================================

drop policy if exists "post_photos_insert_own_folder" on storage.objects;
create policy "post_photos_insert_own_folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/(mark-)?[0-9a-z]+-[0-9]+\.jpg$'
  );

-- An upsert of the same photo is an UPDATE; WITH CHECK keeps a rename from
-- escaping the pattern.
drop policy if exists "post_photos_update_own_folder" on storage.objects;
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
    and name ~ '^[0-9a-f-]{36}/(mark-)?[0-9a-z]+-[0-9]+\.jpg$'
  );

drop policy if exists "sighting_photos_insert_spotter_active_post" on storage.objects;
create policy "sighting_photos_insert_spotter_active_post"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'sighting-photos'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-z]+-[0-9]+\.jpg$'
    and exists (
      select 1 from public.posts p
      where p.id::text = (storage.foldername(name))[1]
        and p.status = 'active'
    )
  );

-- avatars: profiles.avatar_path already requires exactly this shape.
drop policy if exists "avatars_insert_own_folder" on storage.objects;
create policy "avatars_insert_own_folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and name = (select auth.uid())::text || '/avatar.jpg'
  );

drop policy if exists "avatars_update_own_folder" on storage.objects;
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
    and name = (select auth.uid())::text || '/avatar.jpg'
  );
