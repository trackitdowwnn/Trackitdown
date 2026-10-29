-- =============================================================================
-- WHAT:  Verification for 20261029100000_unreferenced_uploads_cannot_be_kept_alive.sql.
--        NOT a migration.
-- WHY:   Audit run 3, lead 3 — an upload nothing names must be reclaimed
--        whatever its owner does to it, and the number a user can keep alive
--        by re-creating must be bounded. Neither is visible by reading.
-- CHECKS: 1 ⚠️ an old unreferenced photo is still queued after its owner
--        RENAMES it · 2 a new one is not queued · 3 ⚠️ the 101st post-photo in
--        48 hours is refused · 4 ⚠️ the 101st sighting-photo likewise ·
--        5 uploads older than 48 hours do not count · 6 one user at the cap
--        does not stop another.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        Seed users Alex (1111…) and Beth (2222…); uploads run as authenticated.
-- LINKS: supabase/migrations/20261029100000_unreferenced_uploads_cannot_be_kept_alive.sql;
--        supabase/tests/upload_names_verification.sql (the naming half).
-- =============================================================================

begin;

insert into public.posts (id, owner_id, status, bounty_amount_pence, plate) values
  ('0a7e0000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222', 'active', null, 'KE01 ALV');

create function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.try_upload(p_user uuid, p_bucket text, p_name text) returns boolean
language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  set local role authenticated;
  insert into storage.objects (bucket_id, name) values (p_bucket, p_name);
  reset role;
  return true;
exception when insufficient_privilege then
  reset role;
  return false;
end $$;

-- CHECK 1 + 2 — a rename does not reset the clock; a fresh upload is left alone.
insert into storage.objects (bucket_id, name, created_at, updated_at) values
  ('post-photos', '11111111-1111-1111-1111-111111111111/old1-0.jpg',
   now() - interval '72 hours', now() - interval '72 hours');

select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
set local role authenticated;
update storage.objects
   set name = '11111111-1111-1111-1111-111111111111/old1-1.jpg', updated_at = now()
 where bucket_id = 'post-photos' and name = '11111111-1111-1111-1111-111111111111/old1-0.jpg';
reset role;

do $$
begin
  if not exists (select 1 from storage.objects
                  where bucket_id = 'post-photos'
                    and name = '11111111-1111-1111-1111-111111111111/old1-1.jpg') then
    raise exception 'CHECK 1 SETUP FAILED: the owner could not rename their own photo.';
  end if;
  if not pg_temp.try_upload('11111111-1111-1111-1111-111111111111', 'post-photos',
                            '11111111-1111-1111-1111-111111111111/fresh1-0.jpg') then
    raise exception 'CHECK 2 SETUP FAILED: a normal upload was refused.';
  end if;

  perform public.enqueue_unreferenced_uploads(1000);

  if not exists (select 1 from public.orphaned_photos
                  where path = '11111111-1111-1111-1111-111111111111/old1-1.jpg') then
    raise exception 'CHECK 1 FAILED: a renamed 72-hour-old unreferenced photo was not queued.';
  end if;
  raise notice 'CHECK 1 passed: renaming an unreferenced photo does not keep it alive.';

  if exists (select 1 from public.orphaned_photos
              where path = '11111111-1111-1111-1111-111111111111/fresh1-0.jpg') then
    raise exception 'CHECK 2 FAILED: a photo uploaded just now was queued.';
  end if;
  raise notice 'CHECK 2 passed: a new upload gets its 48 hours.';
end $$;

-- CHECK 3 + 5 + 6 — the post-photos cap.
do $$
declare
  v_beth uuid := '22222222-2222-2222-2222-222222222222';
  v_alex uuid := '11111111-1111-1111-1111-111111111111';
  i integer;
begin
  -- 150 old objects in Beth's folder: they must not count.
  insert into storage.objects (bucket_id, name, created_at)
  select 'post-photos', v_beth::text || '/aged' || g || '-0.jpg', now() - interval '72 hours'
    from generate_series(1, 150) g;

  for i in 1..100 loop
    if not pg_temp.try_upload(v_beth, 'post-photos', v_beth::text || '/cap' || i || '-0.jpg') then
      raise exception 'CHECK 5 FAILED: upload % of 100 was refused (old uploads counted?).', i;
    end if;
  end loop;
  raise notice 'CHECK 5 passed: uploads older than 48 hours do not count towards the cap.';

  if pg_temp.try_upload(v_beth, 'post-photos', v_beth::text || '/cap101-0.jpg') then
    raise exception 'CHECK 3 FAILED: a 101st post-photo in 48 hours was allowed.';
  end if;
  raise notice 'CHECK 3 passed: the 101st post-photo in 48 hours is refused.';

  if not pg_temp.try_upload(v_alex, 'post-photos', v_alex::text || '/other1-0.jpg') then
    raise exception 'CHECK 6 FAILED: one user at the cap blocked another.';
  end if;
  raise notice 'CHECK 6 passed: the cap is per user.';
end $$;

-- CHECK 4 — the sighting-photos cap.
do $$
declare
  v_alex uuid := '11111111-1111-1111-1111-111111111111';
  v_post text := '0a7e0000-0000-0000-0000-0000000000a1';
  i integer;
begin
  for i in 1..100 loop
    if not pg_temp.try_upload(v_alex, 'sighting-photos',
                              v_post || '/' || v_alex::text || '/s' || i || '-0.jpg') then
      raise exception 'CHECK 4 SETUP FAILED: sighting upload % of 100 was refused.', i;
    end if;
  end loop;
  if pg_temp.try_upload(v_alex, 'sighting-photos', v_post || '/' || v_alex::text || '/s101-0.jpg') then
    raise exception 'CHECK 4 FAILED: a 101st sighting-photo in 48 hours was allowed.';
  end if;
  raise notice 'CHECK 4 passed: the 101st sighting-photo in 48 hours is refused.';
end $$;

rollback;
