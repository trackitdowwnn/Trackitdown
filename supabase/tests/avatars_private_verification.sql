-- =============================================================================
-- WHAT:  Verification for 20261027110000_avatars_go_private.sql. NOT a migration.
-- WHY:   A public avatars bucket serves avatars/<uid>/avatar.jpg to anyone
--        holding a uid — and post-photo URLs carry the owner's (audit run 2,
--        lead 2). The app signs its own avatar instead.
-- CHECKS: 1 ⚠️ the bucket is private · 2 the own-folder SELECT policy the
-- app's signed URL needs is still there, and no policy opens it to anon.
-- HOW:   Self-asserting, RAISE on failure (CI's db job).
-- LINKS: supabase/migrations/20261027110000_avatars_go_private.sql;
--        src/shared/lib/avatarUrl.ts.
-- =============================================================================

do $$
begin
  if (select public from storage.buckets where id = 'avatars') is distinct from false then
    raise exception 'CHECK 1 FAILED: the avatars bucket is public — anyone with a uid can fetch a photo.';
  end if;
  raise notice 'CHECK 1 passed: the avatars bucket is private.';
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'avatars_select_own_folder' and cmd = 'SELECT'
       and roles = '{authenticated}'
  ) then
    raise exception 'CHECK 2 FAILED: avatars_select_own_folder is missing — the app could not sign '
                    'its own avatar.';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and cmd in ('SELECT', 'ALL')
       and (roles && '{anon,public}'::name[])
       and qual ilike '%avatars%'
  ) then
    raise exception 'CHECK 2 FAILED: a storage policy lets anon read avatars.';
  end if;
  raise notice 'CHECK 2 passed: only the owner can read (and so sign) their avatar.';
end $$;
