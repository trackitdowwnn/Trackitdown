-- =============================================================================
-- WHAT: Two changes so an upload no listing, vehicle or sighting uses is always
--       reclaimed:
--         1. enqueue_unreferenced_uploads ages an object by when it was
--            CREATED, not by its last write — restated in full from
--            20261026160000; the two age lines are the only change.
--         2. A signed-in user may create at most 100 objects per bucket in any
--            48 hours, in post-photos and in sighting-photos (the two INSERT
--            policies, restated from 20261027140000 with one added condition).
--
-- WHY:  Security audit run 3, lead 3. The sweep reclaimed an unreferenced
--       object only once it was 48 hours old by its LAST write, and the
--       uploader's own policies let them rename or re-upsert it (UPDATE), or
--       copy it and delete the original, at will — so a photo nothing names
--       could be kept publicly served on our storage and egress forever.
--       Change 1 stops a rename or upsert resetting the clock. A copy or a
--       re-upload is a NEW object, so change 2 bounds how many of those can be
--       alive at once: ≤ 100 per user per bucket, × 5 MiB.
--
--       The cap is far above real use: a listing or vehicle takes ≤ 6 photos
--       plus marks, a sighting ≤ 3; the most any prod user has ever uploaded
--       to one bucket is 23 (2026-10-29).
--
--       A retry of the same photo (upload upsert:true, a stable name) keeps
--       the object's created_at, so a photo first uploaded > 48 hours ago and
--       re-sent in a new listing could be queued in the seconds between upload
--       and create_post. The drain re-checks every reference before removing,
--       so only a sweep landing in that window could take it — accepted.
-- HOW:  The count is a SECURITY DEFINER helper (a policy that queried
--       storage.objects itself would recurse), counting only the CALLER's own
--       folder: segment 1 in post-photos, segment 2 in sighting-photos — the
--       same segments the policies already pin to auth.uid().
-- =============================================================================

create or replace function public.my_recent_upload_count(p_bucket text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from storage.objects o
   where o.bucket_id = p_bucket
     and o.created_at > now() - interval '48 hours'
     and case p_bucket
           when 'post-photos' then o.name like (select auth.uid())::text || '/%'
           when 'sighting-photos' then (storage.foldername(o.name))[2] = (select auth.uid())::text
           else false
         end
$$;

comment on function public.my_recent_upload_count(text) is
  'Objects the caller created in p_bucket in the last 48 hours (post-photos and sighting-photos only). Used by their INSERT policies to cap uploads at 100 per 48 hours (audit run 3, lead 3, 20261029100000).';

revoke all on function public.my_recent_upload_count(text) from public, anon;
grant execute on function public.my_recent_upload_count(text) to authenticated;

-- --- 2. The caps ----------------------------------------------------------------
drop policy if exists "post_photos_insert_own_folder" on storage.objects;
create policy "post_photos_insert_own_folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/(mark-)?[0-9a-z]+-[0-9]+\.jpg$'
    and public.my_recent_upload_count('post-photos') < 100
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
    and public.my_recent_upload_count('sighting-photos') < 100
  );

-- --- 1. Age by creation ------------------------------------------------------------
create or replace function public.enqueue_unreferenced_uploads(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_post  integer;
  v_sight integer;
begin
  -- post-photos. ⚠️ This starts from the OBJECT and asks whether anything
  -- names it, so a mismatch deletes a live photo. Hence: only the app's own
  -- naming ('<uid>/[mark-]<hash>-<n>.jpg' — never demo or hand-made files),
  -- 48 hours old by its CREATION (a rename or upsert must not reset the clock:
  -- audit run 3, lead 3), and unreferenced by BOTH tests — the drain's own
  -- helper and a plain suffix match across the four photo tables.
  insert into public.orphaned_photos (path)
  select o.name
    from storage.objects o
   where o.bucket_id = 'post-photos'
     and o.name ~ '^[0-9a-f-]{36}/(mark-)?[0-9a-z]+-[0-9]+\.jpg$'
     and o.created_at < now() - interval '48 hours'
     and not exists (select 1 from public.orphaned_photos q where q.path = o.name)
     and not exists (select 1 from public.post_photos t where t.url like '%/post-photos/' || o.name)
     and not exists (select 1 from public.vehicle_photos t where t.url like '%/post-photos/' || o.name)
     and not exists (select 1 from public.post_distinctive_feature t where t.photo_url like '%/post-photos/' || o.name)
     and not exists (select 1 from public.vehicle_distinctive_feature t where t.photo_url like '%/post-photos/' || o.name)
     and not public.orphaned_photo_still_referenced(o.name)
   limit v_limit
  on conflict (path) do nothing;
  get diagnostics v_post = row_count;

  -- sighting-photos: paths are pinned per sighting and stored verbatim, so
  -- an exact match is the whole test ('<post>/<spotter>/<hash>-<n>.jpg').
  insert into public.orphaned_sighting_photos (path)
  select o.name
    from storage.objects o
   where o.bucket_id = 'sighting-photos'
     and o.name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-z]+-[0-9]+\.jpg$'
     and o.created_at < now() - interval '48 hours'
     and not exists (select 1 from public.sighting_photos sp where sp.path = o.name)
     and not exists (select 1 from public.orphaned_sighting_photos q where q.path = o.name)
   limit v_limit
  on conflict (path) do nothing;
  get diagnostics v_sight = row_count;

  return v_post + v_sight;
end $$;

comment on function public.enqueue_unreferenced_uploads(integer) is
  'Hourly (release-held-refunds): queues post-photos and sighting-photos objects CREATED more than 48 hours ago, in the app''s own naming, that no row names — uploads whose submit never landed. The existing drains re-check and remove them through the Storage API. Audit leads 9 + 17 (20261026160000); aged by creation since audit run 3 lead 3 (20261029100000).';

revoke all on function public.enqueue_unreferenced_uploads(integer) from public, anon, authenticated;
grant execute on function public.enqueue_unreferenced_uploads(integer) to service_role;
