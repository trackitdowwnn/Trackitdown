-- =============================================================================
-- WHAT:  Verification for 20261023150000_data_exports.sql. NOT a migration.
-- WHY:   An export file is everything about a person. The bucket must be
--        private with no client access at all, the request log service-role
--        only, and the sweep must claim only files past 24 hours.
--
-- CHECKS: 1 ⚠️ the bucket is private, and no storage.objects policy names it
-- (anon and authenticated can't list, read or write it) · 2 ⚠️ clients can't
-- read or write data_export_requests · 3 claim returns >24h, not-yet-deleted
-- files only; forget marks them · 4 data_export_points returns the user's own
-- points, not someone else's · 5 who may call what.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        Uses seed.sql's two users.
-- LINKS: supabase/migrations/20261023150000_data_exports.sql.
-- =============================================================================

-- 1 — the bucket.
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'data-exports' and public = false) then
    raise exception 'CHECK 1 FAILED: the data-exports bucket is missing or public';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and (coalesce(qual, '') like '%data-exports%' or coalesce(with_check, '') like '%data-exports%')
  ) then
    raise exception 'CHECK 1 FAILED: a storage policy opens the data-exports bucket to clients';
  end if;
end $$;

-- 2 — the request log is service-role only.
do $$
begin
  if has_table_privilege('anon', 'public.data_export_requests', 'select')
     or has_table_privilege('authenticated', 'public.data_export_requests', 'select')
     or has_table_privilege('authenticated', 'public.data_export_requests', 'insert') then
    raise exception 'CHECK 2 FAILED: a client role can read or write data_export_requests';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.data_export_requests'::regclass) then
    raise exception 'CHECK 2 FAILED: RLS is off on data_export_requests';
  end if;
end $$;

-- 3 — the sweep's claim and forget.
begin;
insert into public.data_export_requests (id, user_id, object_path, byte_size, created_at, deleted_at) values
  ('de000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '1111/old.json',     10, now() - interval '25 hours', null),
  ('de000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '1111/fresh.json',   10, now() - interval '1 hour',   null),
  ('de000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '1111/removed.json', 10, now() - interval '30 hours', now());

do $$
declare
  v_ids uuid[];
begin
  select array_agg(c.id) into v_ids from public.claim_expired_data_exports(100) c
   where c.id::text like 'de000000-%';
  if v_ids is distinct from array['de000000-0000-0000-0000-000000000001'::uuid] then
    raise exception 'CHECK 3 FAILED: claim should return only the >24h, undeleted file, got %', v_ids;
  end if;

  perform public.forget_data_export(v_ids);
  if exists (select 1 from public.claim_expired_data_exports(100) c where c.id = v_ids[1]) then
    raise exception 'CHECK 3 FAILED: a forgotten file was claimed again';
  end if;
  if (select deleted_at from public.data_export_requests where id = v_ids[1]) is null then
    raise exception 'CHECK 3 FAILED: forget did not mark the file removed';
  end if;
end $$;
rollback;

-- 3b — ⚠️ a stray file (no live request names it) is claimed once old, with no
-- id; a young one is not. And a signed-in user can't see either.
begin;
insert into storage.objects (bucket_id, name, created_at)
values ('data-exports', '1111/stray.json', now() - interval '26 hours'),
       ('data-exports', '1111/young-stray.json', now() - interval '1 hour');

do $$
begin
  if not exists (select 1 from public.claim_expired_data_exports(100) c
                  where c.id is null and c.object_path = '1111/stray.json') then
    raise exception 'CHECK 3b FAILED: an old stray export file was not claimed';
  end if;
  if exists (select 1 from public.claim_expired_data_exports(100) c
              where c.object_path = '1111/young-stray.json') then
    raise exception 'CHECK 3b FAILED: a young file was claimed';
  end if;
end $$;

select set_config('request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
set local role authenticated;
do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'data-exports') then
    raise exception 'CHECK 1 FAILED: a signed-in user can see data-exports objects';
  end if;
end $$;
reset role;
rollback;

-- 3c — ⚠️ a live export's PDF is NOT a stray (20261023160000): the request
-- names the JSON, the PDF sits beside it; and the bucket takes PDFs.
begin;
insert into public.data_export_requests (id, user_id, object_path, byte_size, created_at)
values ('de000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111',
        '1111/pair.json', 10, now() - interval '1 hour');
insert into storage.objects (bucket_id, name, created_at)
values ('data-exports', '1111/pair.pdf', now() - interval '26 hours');

do $$
begin
  if exists (select 1 from public.claim_expired_data_exports(100) c
              where c.object_path = '1111/pair.pdf') then
    raise exception 'CHECK 3c FAILED: a live export''s PDF was claimed as a stray';
  end if;
  if not (select 'application/pdf' = any (allowed_mime_types) from storage.buckets where id = 'data-exports') then
    raise exception 'CHECK 3c FAILED: the data-exports bucket doesn''t take PDFs';
  end if;
end $$;
rollback;

-- 4 — points: their own, nobody else's.
begin;
insert into public.alert_zones (id, user_id, point, radius_m, name)
values ('de000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
        'SRID=4326;POINT(-2.24 53.48)'::geography, 2000, 'Mine'),
       ('de000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222',
        'SRID=4326;POINT(-1.5 52.4)'::geography, 2000, 'Theirs');

do $$
declare
  v jsonb := public.data_export_points('11111111-1111-1111-1111-111111111111');
begin
  if v::text like '%de000000-0000-0000-0000-0000000000b1%' then
    raise exception 'CHECK 4 FAILED: another user''s alert zone came back';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v -> 'alert_zones') z
     where z ->> 'id' = 'de000000-0000-0000-0000-0000000000a1'
       and round((z ->> 'lat')::numeric, 2) = 53.48
       and round((z ->> 'lng')::numeric, 2) = -2.24
  ) then
    raise exception 'CHECK 4 FAILED: the user''s own zone point is missing or wrong: %', v;
  end if;
end $$;
rollback;

-- 5 — service role only.
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.claim_expired_data_exports(integer)',
    'public.forget_data_export(uuid[])',
    'public.data_export_points(uuid)'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'CHECK 5 FAILED: % is callable by a client role', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'CHECK 5 FAILED: % is not callable by service_role', v_fn;
    end if;
  end loop;
end $$;
