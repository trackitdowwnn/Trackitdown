-- =============================================================================
-- WHAT:  Verification for a colour's optional paint finish (20261012100000) —
--        the four write RPCs that take p_colour_finish, the two readers that
--        return it, the column CHECKs, the grants restated after the DROPs, and
--        the 'Brown / Beige' -> 'Brown' fold. NOT a migration.
-- WHY:   Four functions were DROPPED and recreated, which takes their grants
--        and comment with them — CHECK 8 is the part that would hand anon the
--        post-creation boundary if a revoke were missed. The rest pins the
--        contract the app (PR 3) builds on: the finish is the whole value,
--        NULL/blank/omitted stores NULL, and anything outside the four names
--        is refused by name (INVALID_COLOUR_FINISH) rather than a bare 23514.
--
-- CHECKS: 1 create_post stores a finish and the owner's detail returns it ·
-- 2 the old 23-argument call still resolves and stores NULL; blank is NULL ·
-- 3 ⚠️ an unknown or mis-cased finish is refused and nothing is written ·
-- 4 update_post_car_details sets, and — omitted — CLEARS (full replace) ·
-- 5 the garage: add_vehicle / update_vehicle / list_my_vehicles ·
-- 6 a spotter's detail of a live post carries it (public, like colour) ·
-- 7 the column CHECKs hold against a direct write · 8 ⚠️ exactly one overload
-- of each recreated function, anon denied, authenticated allowed, and the
-- column readable like posts.colour · 9 no stored 'Brown / Beige' remains.
-- LINKS: supabase/migrations/20261012100000_a_colour_has_a_finish.sql;
--        src/shared/lib/carColours.ts (LEGACY_COLOUR_ALIASES).
--
-- SELF-ASSERTING: every check RAISES on failure (ON_ERROR_STOP=1). Everything
-- runs inside begin/rollback.
-- =============================================================================

begin;
do $$
declare
  v_doc     jsonb;
  v_post    uuid;
  v_bare    uuid;
  v_vehicle uuid;
  v_finish  text;
  v_err     text;
  v_photos  text[] := array[
    'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/cf0.jpg',
    'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/cf1.jpg',
    'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/cf2.jpg'];
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

  -- ---------------------------------------------------------------------
  -- CHECK 1 — create_post stores the finish; the owner's detail returns it.
  -- ---------------------------------------------------------------------
  v_doc := public.create_post(
    null, 'Ford', 'Fiesta', 'Blue', 2019, 'Hatchback', null, null, null, null,
    'driveway', 'no', now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
    25000, v_photos, null, null, '[]'::jsonb, 'Manchester', null, 'metallic');
  v_post := (v_doc ->> 'post_id')::uuid;

  select colour_finish into v_finish from public.posts where id = v_post;
  if v_finish is distinct from 'metallic' then
    raise exception 'CHECK 1 FAILED: create_post stored finish % rather than metallic', v_finish;
  end if;
  v_doc := public.get_post_detail(v_post);
  if v_doc ->> 'colour_finish' is distinct from 'metallic' then
    raise exception 'CHECK 1 FAILED: get_post_detail did not return the finish to its owner: %', v_doc -> 'colour_finish';
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 2 — the pre-finish 23-argument call still resolves (the parameter
  -- is trailing and defaulted) and stores NULL; a blank finish is NULL too.
  -- ---------------------------------------------------------------------
  v_doc := public.create_post(
    null, 'Ford', 'Focus', 'Red', 2018, 'Hatchback', null, null, null, null,
    'driveway', 'no', now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
    25000, v_photos, null, null, '[]'::jsonb, 'Manchester', null);
  v_bare := (v_doc ->> 'post_id')::uuid;
  if (select colour_finish from public.posts where id = v_bare) is not null then
    raise exception 'CHECK 2 FAILED: a post created without p_colour_finish got a finish anyway';
  end if;
  if not (public.get_post_detail(v_bare) ? 'colour_finish') then
    raise exception 'CHECK 2 FAILED: get_post_detail omits the colour_finish key when it is NULL';
  end if;

  v_doc := public.create_post(
    null, 'Ford', 'Ka', 'Green', 2017, 'Hatchback', null, null, null, null,
    'driveway', 'no', now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
    25000, v_photos, null, null, '[]'::jsonb, 'Manchester', null, '   ');
  if (select colour_finish from public.posts where id = (v_doc ->> 'post_id')::uuid) is not null then
    raise exception 'CHECK 2 FAILED: a blank finish was stored instead of NULL';
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 3 — ⚠️ an unknown finish is refused BY NAME, and so is a
  -- mis-cased one: the stored value is an enum the app maps to a label.
  -- ---------------------------------------------------------------------
  foreach v_finish in array array['glitter', 'Metallic', 'two-tone roof'] loop
    v_err := null;
    begin
      perform public.create_post(
        null, 'Ford', 'Puma', 'Grey', 2021, 'SUV', null, null, null, null,
        'driveway', 'no', now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
        25000, v_photos, null, null, '[]'::jsonb, 'Manchester', null, v_finish);
    exception when others then
      v_err := sqlerrm;
    end;
    if v_err is distinct from 'INVALID_COLOUR_FINISH' then
      raise exception 'CHECK 3 FAILED: create_post with finish "%" gave % (expected INVALID_COLOUR_FINISH)', v_finish, coalesce(v_err, 'success');
    end if;
  end loop;
  if exists (select 1 from public.posts
             where owner_id = '22222222-2222-2222-2222-222222222222' and model = 'Puma'
               and created_at >= now()) then
    raise exception 'CHECK 3 FAILED: a refused create_post left a row behind';
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 4 — update_post_car_details sets the finish, and a call that omits
  -- it CLEARS it: the function is a full replace of the car's identity.
  -- A refused finish leaves the row as it was.
  -- ---------------------------------------------------------------------
  perform public.update_post_car_details(v_post, 'Ford', 'Fiesta', 'Blue', null, 2019, 'Hatchback', 'pearl');
  if (select colour_finish from public.posts where id = v_post) is distinct from 'pearl' then
    raise exception 'CHECK 4 FAILED: update_post_car_details did not store pearl';
  end if;

  v_err := null;
  begin
    perform public.update_post_car_details(v_post, 'Ford', 'Fiesta', 'Blue', null, 2019, 'Hatchback', 'shiny');
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is distinct from 'INVALID_COLOUR_FINISH' then
    raise exception 'CHECK 4 FAILED: an unknown finish on edit gave % (expected INVALID_COLOUR_FINISH)', coalesce(v_err, 'success');
  end if;
  if (select colour_finish from public.posts where id = v_post) is distinct from 'pearl' then
    raise exception 'CHECK 4 FAILED: a refused edit changed the stored finish';
  end if;

  perform public.update_post_car_details(v_post, 'Ford', 'Fiesta', 'Blue', null, 2019, 'Hatchback');
  if (select colour_finish from public.posts where id = v_post) is not null then
    raise exception 'CHECK 4 FAILED: an edit without p_colour_finish kept the old finish (the contract is a full replace)';
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 5 — the garage writes and reads it.
  -- ---------------------------------------------------------------------
  v_doc := public.add_vehicle('CF19 FIN', 'Mazda', 'MX-5', 'Red', null, 2019,
                              'Convertible', null, array[]::text[], '[]'::jsonb, 'matte');
  v_vehicle := (v_doc ->> 'vehicle_id')::uuid;
  if (select colour_finish from public.vehicles where id = v_vehicle) is distinct from 'matte' then
    raise exception 'CHECK 5 FAILED: add_vehicle did not store matte';
  end if;
  if not exists (select 1 from jsonb_array_elements(public.list_my_vehicles()) e
                 where (e ->> 'id')::uuid = v_vehicle and e ->> 'colour_finish' = 'matte') then
    raise exception 'CHECK 5 FAILED: list_my_vehicles does not return the finish';
  end if;

  perform public.update_vehicle(v_vehicle, 'CF19 FIN', 'Mazda', 'MX-5', 'Red', null, 2019,
                                'Convertible', null, array[]::text[], '[]'::jsonb, 'two_tone_roof');
  if (select colour_finish from public.vehicles where id = v_vehicle) is distinct from 'two_tone_roof' then
    raise exception 'CHECK 5 FAILED: update_vehicle did not store two_tone_roof';
  end if;
  perform public.update_vehicle(v_vehicle, 'CF19 FIN', 'Mazda', 'MX-5', 'Red', null, 2019,
                                'Convertible', null, array[]::text[], '[]'::jsonb);
  if (select colour_finish from public.vehicles where id = v_vehicle) is not null then
    raise exception 'CHECK 5 FAILED: update_vehicle without p_colour_finish kept the old finish';
  end if;

  v_err := null;
  begin
    perform public.add_vehicle(null, 'Mazda', 'MX-5', 'Red', null, 2019,
                               'Convertible', null, array[]::text[], '[]'::jsonb, 'chrome');
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is distinct from 'INVALID_COLOUR_FINISH' then
    raise exception 'CHECK 5 FAILED: add_vehicle with an unknown finish gave % (expected INVALID_COLOUR_FINISH)', coalesce(v_err, 'success');
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 6 — a signed-out viewer's detail of a LIVE post carries the
  -- finish: it is public, like colour, not owner-only.
  -- ---------------------------------------------------------------------
  update public.posts set colour_finish = 'pearl'
   where id = 'a1a1a1a1-0000-0000-0000-000000000001';
  perform set_config('request.jwt.claims', '{}', true);
  v_doc := public.get_post_detail('a1a1a1a1-0000-0000-0000-000000000001');
  if coalesce((v_doc ->> 'visible')::boolean, false) is false then
    raise exception 'CHECK 6 FAILED: the seeded live post is not visible to a signed-out viewer: %', v_doc;
  end if;
  if v_doc ->> 'colour_finish' is distinct from 'pearl' then
    raise exception 'CHECK 6 FAILED: a spotter''s detail does not carry the finish: %', v_doc -> 'colour_finish';
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 7 — the column CHECKs hold against a direct write (service role
  -- and migrations bypass the RPCs).
  -- ---------------------------------------------------------------------
  v_err := null;
  begin
    update public.posts set colour_finish = 'shiny' where id = v_post;
  exception when check_violation then
    v_err := 'check';
  end;
  if v_err is null then
    raise exception 'CHECK 7 FAILED: posts accepted colour_finish = shiny';
  end if;
  v_err := null;
  begin
    update public.vehicles set colour_finish = 'shiny' where id = v_vehicle;
  exception when check_violation then
    v_err := 'check';
  end;
  if v_err is null then
    raise exception 'CHECK 7 FAILED: vehicles accepted colour_finish = shiny';
  end if;

  raise notice 'colour_finish CHECKS 1-7 passed';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 8 — ⚠️ the DROPs took grants with them; they must be back. Exactly one
-- overload of each (two would make PostgREST's named-argument calls ambiguous,
-- 42725), anon denied, authenticated allowed.
-- -----------------------------------------------------------------------------
do $$
declare
  v_name text;
  v_fn   regprocedure;
  v_n    int;
begin
  foreach v_name in array array['create_post', 'update_post_car_details', 'add_vehicle', 'update_vehicle'] loop
    select count(*) into v_n from pg_proc
     where proname = v_name and pronamespace = 'public'::regnamespace;
    if v_n <> 1 then
      raise exception 'CHECK 8 FAILED: % has % overloads (expected exactly 1)', v_name, v_n;
    end if;
    select p.oid::regprocedure into v_fn from pg_proc p
     where p.proname = v_name and p.pronamespace = 'public'::regnamespace;
    if not exists (select 1 from pg_proc p
                    where p.oid = v_fn and 'p_colour_finish' = any(p.proargnames)) then
      raise exception 'CHECK 8 FAILED: % has no p_colour_finish parameter', v_fn;
    end if;
    if has_function_privilege('anon', v_fn::oid, 'EXECUTE') then
      raise exception 'CHECK 8 FAILED: anon can EXECUTE % -- the DROP took the revoke with it', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn::oid, 'EXECUTE') then
      raise exception 'CHECK 8 FAILED: authenticated cannot EXECUTE %', v_fn;
    end if;
  end loop;

  if not has_column_privilege('anon', 'public.posts', 'colour_finish', 'SELECT')
     or not has_column_privilege('authenticated', 'public.posts', 'colour_finish', 'SELECT') then
    raise exception 'CHECK 8 FAILED: posts.colour_finish is not readable like posts.colour';
  end if;

  raise notice 'colour_finish CHECK 8 passed';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 9 — no stored 'Brown / Beige' remains anywhere search or alerts read.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.posts       where lower(btrim(colour)) = 'brown / beige')
     or exists (select 1 from public.vehicles    where lower(btrim(colour)) = 'brown / beige')
     or exists (select 1 from public.alert_zones where lower(btrim(colour)) = 'brown / beige') then
    raise exception 'CHECK 9 FAILED: a retired ''Brown / Beige'' colour is still stored';
  end if;
  raise notice 'colour_finish CHECK 9 passed: ALL CHECKS PASSED';
end $$;

rollback;
