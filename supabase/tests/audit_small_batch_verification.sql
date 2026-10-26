-- =============================================================================
-- WHAT:  Verification for 20261026160000_the_audit_small_batch.sql. NOT a
--        migration.
-- WHY:   The last six security-audit leads. Each check proves the attack is
--        refused AND the honest path still works.
--
-- CHECKS: 1 ⚠️ a '..' screenshot path is refused; a clean one is accepted ·
-- 2 the clean-path rule, case by case · 3 ⚠️ photo URLs from another Supabase
-- project are refused; this project's (and CI's) accepted · 4 ⚠️ a phone
-- signed out by one account and signed in by another records the device link ·
-- 5 releases age out with push tokens · 6 ⚠️ only old, app-named, unreferenced
-- uploads are queued — never a referenced, young or hand-named one ·
-- 7 grants.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        Seed users: Alex (1111…), Beth (2222…).
-- LINKS: supabase/migrations/20261026160000_the_audit_small_batch.sql.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- CHECK 1 — a screenshot path that steps out of the reporter's folder is
-- refused; a clean one is accepted.
-- -----------------------------------------------------------------------------
do $$
declare
  v_code text;
  v_id   uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
  set local role authenticated;
  begin
    perform public.submit_bug_report(
      p_message => 'It broke',
      p_screenshot_paths => array['11111111-1111-1111-1111-111111111111/../22222222-2222-2222-2222-222222222222/x.jpg']);
  exception when others then
    v_code := sqlerrm;
  end;
  v_id := public.submit_bug_report(
    p_message => 'It broke',
    p_screenshot_paths => array['11111111-1111-1111-1111-111111111111/bug-abc-0.jpg']);
  reset role;

  if v_code is null or v_code not like '%INVALID_INPUT%' then
    raise exception 'CHECK 1 FAILED: a ''..'' screenshot path was accepted (got %).',
      coalesce(v_code, 'no error');
  end if;
  if v_id is null then
    raise exception 'CHECK 1 FAILED: a clean screenshot path was refused.';
  end if;
  raise notice 'CHECK 1 passed: only clean screenshot paths are stored.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 2 — the clean-path rule, case by case.
-- -----------------------------------------------------------------------------
do $$
declare
  v_me constant uuid := '11111111-1111-1111-1111-111111111111';
  v_bad text;
begin
  if not public.is_clean_storage_path(v_me::text || '/a/b-0.jpg', v_me) then
    raise exception 'CHECK 2 FAILED: a clean nested path was refused.';
  end if;
  foreach v_bad in array array[
    v_me::text || '/../x.jpg', v_me::text || '/./x.jpg', v_me::text || '//x.jpg',
    v_me::text || '/', v_me::text, v_me::text || '/%2e%2e/x.jpg', v_me::text || '/x.jpg?a',
    v_me::text || '/x.jpg#a', v_me::text || '/a\b.jpg',
    '22222222-2222-2222-2222-222222222222/x.jpg'
  ] loop
    if public.is_clean_storage_path(v_bad, v_me) then
      raise exception 'CHECK 2 FAILED: % was accepted.', v_bad;
    end if;
  end loop;
  raise notice 'CHECK 2 passed: dot, empty, escaped and foreign paths are refused.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 3 — photo URLs from another Supabase project are refused.
-- -----------------------------------------------------------------------------
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate) values
  ('5ba7c000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'draft', null, 'SB01 PHO');

do $$
declare
  v_me    constant text := '11111111-1111-1111-1111-111111111111';
  v_other constant text := 'https://attackerproject.supabase.co/storage/v1/object/public/post-photos/' || v_me;
  v_ours  constant text := 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/' || v_me;
  v_code  text;
begin
  perform set_config('request.jwt.claims',
    '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
  set local role authenticated;
  begin
    perform public.update_post_photos('5ba7c000-0000-0000-0000-000000000001',
      array[v_other || '/a-0.jpg', v_other || '/a-1.jpg', v_other || '/a-2.jpg']);
  exception when others then
    v_code := sqlerrm;
  end;
  perform public.update_post_photos('5ba7c000-0000-0000-0000-000000000001',
    array[v_ours || '/a-0.jpg', v_ours || '/a-1.jpg', v_ours || '/a-2.jpg']);
  reset role;

  if v_code is null or v_code not like '%INVALID_PHOTO_URL%' then
    raise exception 'CHECK 3 FAILED: another project''s photo URLs were accepted (got %).',
      coalesce(v_code, 'no error');
  end if;
  if 'https://lbbbxelbembseohxjhkv.supabase.co/storage/v1/object/public/post-photos/'
       || v_me || '/1fmu2y9-5.jpg'
     !~ public.post_photo_url_re(v_me::uuid) then
    raise exception 'CHECK 3 FAILED: production''s own photo URL no longer matches.';
  end if;
  raise notice 'CHECK 3 passed: only this project''s storage origin is accepted.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 4 — signed out by one account, signed in by another: the link stays.
-- -----------------------------------------------------------------------------
do $$
declare
  v_token constant text := 'ExponentPushToken[small-batch-shared]';
begin
  perform set_config('request.jwt.claims',
    '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
  set local role authenticated;
  perform public.register_push_token(v_token, 'android');
  perform public.unregister_push_token(v_token);          -- Alex logs out
  reset role;

  if not exists (select 1 from public.push_token_releases
                  where token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
                    and user_id = '11111111-1111-1111-1111-111111111111') then
    raise exception 'CHECK 4 FAILED: signing out left no record of who held the device.';
  end if;

  perform set_config('request.jwt.claims',
    '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
  set local role authenticated;
  perform public.register_push_token(v_token, 'android');  -- Beth signs in on it
  reset role;

  if not exists (select 1 from public.device_links
                  where token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
                    and from_user_id = '11111111-1111-1111-1111-111111111111'
                    and to_user_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 4 FAILED: one phone, two accounts — Log out erased the link.';
  end if;
  raise notice 'CHECK 4 passed: a signed-out device still links its next account.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 5 — a release ages out with push tokens.
-- -----------------------------------------------------------------------------
do $$
begin
  insert into public.push_token_releases (token_hash, user_id, released_at)
  values ('small-batch-old', '11111111-1111-1111-1111-111111111111', now() - interval '271 days');
  perform public.purge_stale_push_tokens();
  if exists (select 1 from public.push_token_releases where token_hash = 'small-batch-old') then
    raise exception 'CHECK 5 FAILED: a 271-day-old release was kept.';
  end if;
  raise notice 'CHECK 5 passed: releases are purged at 270 days.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 6 — only old, app-named, unreferenced uploads join the queues.
-- -----------------------------------------------------------------------------
insert into public.post_photos (post_id, url, position) values
  ('5ba7c000-0000-0000-0000-000000000001',
   'http://127.0.0.1:54321/storage/v1/object/public/post-photos/11111111-1111-1111-1111-111111111111/kept-0.jpg', 3);
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('5ba7c000-0000-0000-0000-0000000000c1', 'a1a1a1a1-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222', 'unverified', 'Ancoats', true);
insert into public.sighting_photos (sighting_id, path, captured_at, position)
values ('5ba7c000-0000-0000-0000-0000000000c1',
        'a1a1a1a1-0000-0000-0000-000000000001/22222222-2222-2222-2222-222222222222/kept-0.jpg',
        now(), 0);

insert into storage.objects (bucket_id, name, created_at, updated_at) values
  ('post-photos', '11111111-1111-1111-1111-111111111111/stray-0.jpg',  now() - interval '3 days', now() - interval '3 days'),
  ('post-photos', '11111111-1111-1111-1111-111111111111/kept-0.jpg',   now() - interval '3 days', now() - interval '3 days'),
  ('post-photos', '11111111-1111-1111-1111-111111111111/young-0.jpg',  now() - interval '1 hour', now() - interval '1 hour'),
  ('post-photos', '11111111-1111-1111-1111-111111111111/retried-0.jpg', now() - interval '3 days', now() - interval '1 hour'),
  ('post-photos', '11111111-1111-1111-1111-111111111111/demo-x-0-Ab_c-0.jpg', now() - interval '3 days', now() - interval '3 days'),
  ('sighting-photos', 'a1a1a1a1-0000-0000-0000-000000000001/22222222-2222-2222-2222-222222222222/stray-0.jpg', now() - interval '3 days', now() - interval '3 days'),
  ('sighting-photos', 'a1a1a1a1-0000-0000-0000-000000000001/22222222-2222-2222-2222-222222222222/kept-0.jpg',  now() - interval '3 days', now() - interval '3 days');

do $$
begin
  perform public.enqueue_unreferenced_uploads(1000);

  if not exists (select 1 from public.orphaned_photos
                  where path = '11111111-1111-1111-1111-111111111111/stray-0.jpg') then
    raise exception 'CHECK 6 FAILED: an old, unreferenced upload was not queued.';
  end if;
  if exists (select 1 from public.orphaned_photos where path in (
       '11111111-1111-1111-1111-111111111111/kept-0.jpg',
       '11111111-1111-1111-1111-111111111111/young-0.jpg',
       '11111111-1111-1111-1111-111111111111/retried-0.jpg',
       '11111111-1111-1111-1111-111111111111/demo-x-0-Ab_c-0.jpg')) then
    raise exception 'CHECK 6 FAILED: a referenced, young, just-retried or hand-named photo '
                    'was queued for deletion.';
  end if;
  if not exists (select 1 from public.orphaned_sighting_photos where path =
       'a1a1a1a1-0000-0000-0000-000000000001/22222222-2222-2222-2222-222222222222/stray-0.jpg') then
    raise exception 'CHECK 6 FAILED: a sighting photo with no sighting was not queued.';
  end if;
  if exists (select 1 from public.orphaned_sighting_photos where path =
       'a1a1a1a1-0000-0000-0000-000000000001/22222222-2222-2222-2222-222222222222/kept-0.jpg') then
    raise exception 'CHECK 6 FAILED: a sighting''s own photo was queued for deletion.';
  end if;
  raise notice 'CHECK 6 passed: only stale, app-named, unreferenced uploads are queued.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 7 — grants.
-- -----------------------------------------------------------------------------
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.enqueue_unreferenced_uploads(integer)', 'execute')
       or has_table_privilege(v_role, 'public.push_token_releases', 'select') then
      raise exception 'CHECK 7 FAILED: % can reach the upload sweep or the device releases.', v_role;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.enqueue_unreferenced_uploads(integer)', 'execute') then
    raise exception 'CHECK 7 FAILED: the sweep (service_role) cannot run the scan.';
  end if;
  raise notice 'CHECK 7 passed: the scan and the releases are service-role only.';
end $$;

rollback;
