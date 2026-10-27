-- =============================================================================
-- WHAT:  Verification for 20261027140000_uploads_take_the_app_names.sql. NOT a migration.
-- WHY:   A name the sweep does not recognise is never cleaned up, so a client
--        must not be able to write one (audit run 2, lead 7). And the names
--        the app DOES write must keep working, or every photo upload breaks.
-- CHECKS: 1 ⚠️ the app's own post-photo, mark, sighting and avatar names
-- upload · 2 ⚠️ off-pattern names (png, webp, uppercase, no suffix, a second
-- avatar) are refused · 3 the folder rule still holds (another user's folder
-- is refused) · 4 the policies' regexes are the sweep's own.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        Seed users Alex (1111…) and Beth (2222…); inserts run as authenticated.
-- LINKS: supabase/migrations/20261027140000_uploads_take_the_app_names.sql;
--        supabase/migrations/20261026160000_the_audit_small_batch.sql (the sweep).
-- =============================================================================

begin;

insert into public.posts (id, owner_id, status, bounty_amount_pence, plate) values
  ('0a7e0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'active', null, 'UN01 AME');

create function pg_temp.try_upload(p_user uuid, p_bucket text, p_name text) returns boolean
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name) values (p_bucket, p_name);
  reset role;
  return true;
exception when insufficient_privilege then
  reset role;
  return false;
end $$;

-- CHECK 1 — the app's own names.
do $$
declare
  v_alex text := '11111111-1111-1111-1111-111111111111';
  v_beth text := '22222222-2222-2222-2222-222222222222';
  v_post text := '0a7e0000-0000-0000-0000-000000000001';
begin
  if not pg_temp.try_upload(v_alex::uuid, 'post-photos', v_alex || '/1x2y3z-0.jpg')
     or not pg_temp.try_upload(v_alex::uuid, 'post-photos', v_alex || '/mark-9abc-2.jpg')
     or not pg_temp.try_upload(v_beth::uuid, 'sighting-photos', v_post || '/' || v_beth || '/1x2y3z-0.jpg')
     or not pg_temp.try_upload(v_alex::uuid, 'avatars', v_alex || '/avatar.jpg') then
    raise exception 'CHECK 1 FAILED: an upload name the app writes was refused.';
  end if;
  raise notice 'CHECK 1 passed: post, mark, sighting and avatar uploads still work.';
end $$;

-- CHECK 2 — anything else is refused.
do $$
declare
  v_alex text := '11111111-1111-1111-1111-111111111111';
  v_beth text := '22222222-2222-2222-2222-222222222222';
  v_post text := '0a7e0000-0000-0000-0000-000000000001';
  v_name text;
begin
  foreach v_name in array array['/a.png', '/x.webp', '/Photo.jpg', '/abc.jpg', '/sub/abc-0.jpg', '/abc-0.jpg.html'] loop
    if pg_temp.try_upload(v_alex::uuid, 'post-photos', v_alex || v_name) then
      raise exception 'CHECK 2 FAILED: post-photos took %.', v_name;
    end if;
  end loop;
  if pg_temp.try_upload(v_beth::uuid, 'sighting-photos', v_post || '/' || v_beth || '/a.png') then
    raise exception 'CHECK 2 FAILED: sighting-photos took an off-pattern name.';
  end if;
  if pg_temp.try_upload(v_alex::uuid, 'avatars', v_alex || '/second.jpg') then
    raise exception 'CHECK 2 FAILED: avatars took a second file.';
  end if;
  raise notice 'CHECK 2 passed: off-pattern names are refused in all three buckets.';
end $$;

-- CHECK 3 — the folder rule still holds.
do $$
declare
  v_alex text := '11111111-1111-1111-1111-111111111111';
  v_beth text := '22222222-2222-2222-2222-222222222222';
begin
  if pg_temp.try_upload(v_beth::uuid, 'post-photos', v_alex || '/1x2y3z-1.jpg')
     or pg_temp.try_upload(v_beth::uuid, 'avatars', v_alex || '/avatar.jpg') then
    raise exception 'CHECK 3 FAILED: a user wrote into someone else''s folder.';
  end if;
  raise notice 'CHECK 3 passed: another user''s folder is still refused.';
end $$;

-- CHECK 4 — the policies and the sweep name the same files.
do $$
declare
  v_sweep text := pg_get_functiondef('public.enqueue_unreferenced_uploads(integer)'::regprocedure);
  v_re    text;
begin
  foreach v_re in array array[
    '^[0-9a-f-]{36}/(mark-)?[0-9a-z]+-[0-9]+\.jpg$',
    '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-z]+-[0-9]+\.jpg$'] loop
    if position(v_re in v_sweep) = 0
       or not exists (select 1 from pg_policies
                       where schemaname = 'storage' and tablename = 'objects'
                         and position(v_re in with_check) > 0) then
      raise exception 'CHECK 4 FAILED: % is not in both the sweep and an upload policy.', v_re;
    end if;
  end loop;
  raise notice 'CHECK 4 passed: upload policies and the sweep share their name patterns.';
end $$;

rollback;
