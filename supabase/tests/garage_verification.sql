-- =============================================================================
-- garage (saved vehicles) safety / validation verification (NOT a migration —
-- do not place in migrations/).
--
-- SELF-ASSERTING: every check is a DO block that RAISES EXCEPTION on failure, so
-- the whole file aborts non-zero the moment a property is violated. This file
-- GATES CI; it is not for eyeballing. On success each block emits a NOTICE.
--
-- The Tier 1 property here is CHECK 4 — SNAPSHOT INDEPENDENCE. A post made from
-- a garage vehicle must be completely unaffected by anything that later happens
-- to that vehicle. Someone tidying their garage a year on must not be able to
-- mutate or orphan a historical recovery record. By TESTING.md's letter the
-- garage is Tier 2 (no money, no posts.status transition), but this one property
-- protects a permanent record of a real theft, so it is gated like Tier 1.
--
-- The second is CHECK 6 — a saved vehicle is visible ONLY to its owner. Garage
-- rows are plates + photos for cars that were never stolen, which is an
-- expansion of what SECURITY_AND_TRUST covers; absence is asserted for BOTH a
-- different signed-in user and the literal anon role.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset            # applies migrations + seed
--     psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/garage_verification.sql
--
-- (ON_ERROR_STOP=1 makes psql exit non-zero on the first RAISE.)
--
-- ISOLATION: every vehicle created here carries a nickname prefixed 'GARTEST' and
-- every post a 'GA70…' plate, so the cleanup below is exact and the file is
-- re-runnable.
--
-- Callers: two seeded users — owner 22222222-2222-2222-2222-222222222222 and a
-- DIFFERENT user 11111111-1111-1111-1111-111111111111. auth.uid() reads the
-- request.jwt.claims GUC; each block sets it to the acting caller. Assertions
-- read the tables directly as postgres (bypassing RLS) to confirm what landed.
--
-- TECHNIQUE for the absence checks (CHECK 6): SET LOCAL ROLE + cleared/!set JWT
-- claims, so the GRANT layer applies for real — a NULL-claims probe running as
-- postgres bypasses grants entirely and would prove nothing.
-- =============================================================================

\set owner_id '22222222-2222-2222-2222-222222222222'
\set other_id '11111111-1111-1111-1111-111111111111'
\set photo_a 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/g0.jpg'
\set photo_b 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/g1.jpg'
\set photo_c 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/g2.jpg'


-- -----------------------------------------------------------------------------
-- Clean up anything left by a previous run (posts first — they reference
-- vehicles; the FK is ON DELETE SET NULL so order is cosmetic, not required).
-- -----------------------------------------------------------------------------
delete from public.posts
where upper(regexp_replace(coalesce(plate, ''), '[^A-Za-z0-9]', '', 'g')) like 'GA70%';

delete from public.vehicles where nickname like 'GARTEST%';


-- -----------------------------------------------------------------------------
-- CHECK 1 — add_vehicle writes the vehicle and BOTH child tables, pins the owner
-- to auth.uid(), and defaults verification_state to the dormant 'unverified'.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc        jsonb;
  v_vehicle_id uuid;
  v_vehicle    public.vehicles%rowtype;
  v_n          int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

  v_doc := public.add_vehicle(
    'GA70 CAR', 'BMW', '3 Series', 'Blue', null, 2019, 'Saloon', 'GARTEST daily',
    array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/g0.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/g1.jpg'],
    jsonb_build_array(jsonb_build_object(
      'photo_url', 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/gm0.jpg',
      'description', 'Cracked nearside wing mirror')));
  v_vehicle_id := (v_doc ->> 'vehicle_id')::uuid;

  select * into v_vehicle from public.vehicles where id = v_vehicle_id;
  if not found then raise exception 'CHECK 1 FAILED: vehicle not created'; end if;
  if v_vehicle.user_id <> '22222222-2222-2222-2222-222222222222' then
    raise exception 'CHECK 1 FAILED: owner not pinned to auth.uid()';
  end if;
  if v_vehicle.make <> 'BMW' or v_vehicle.model <> '3 Series' or v_vehicle.colour <> 'Blue'
     or v_vehicle.year <> 2019 or v_vehicle.body_type <> 'Saloon' then
    raise exception 'CHECK 1 FAILED: identity columns not written';
  end if;
  if v_vehicle.verification_state <> 'unverified' then
    raise exception 'CHECK 1 FAILED: verification_state should default to unverified (it is dormant)';
  end if;

  select count(*) into v_n from public.vehicle_photos where vehicle_id = v_vehicle_id;
  if v_n <> 2 then raise exception 'CHECK 1 FAILED: expected 2 photos, got %', v_n; end if;
  select count(*) into v_n from public.vehicle_distinctive_feature where vehicle_id = v_vehicle_id;
  if v_n <> 1 then raise exception 'CHECK 1 FAILED: expected 1 distinctive feature, got %', v_n; end if;

  -- A garage car may be saved with NO photos at all: adding a car must stay a
  -- 60-second job, so posting's 3-6 minimum deliberately does NOT apply here.
  v_doc := public.add_vehicle(
    null, 'Ford', 'Fiesta', 'Red', null, null, null, 'GARTEST bare',
    array[]::text[], '[]'::jsonb);
  if (v_doc ->> 'vehicle_id') is null then
    raise exception 'CHECK 1 FAILED: a photo-less, plate-less vehicle must be allowed';
  end if;

  raise notice 'CHECK 1 passed: add_vehicle writes vehicle + children, pins the owner, and allows a bare car';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 2 — the 5-vehicle cap is enforced SERVER-side (the client cap is only a
-- kindness). The 6th add must raise VEHICLE_LIMIT_REACHED.
-- -----------------------------------------------------------------------------
do $$
declare
  v_ok boolean := false;
  v_i  int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

  -- Two exist from CHECK 1; top up to exactly 5.
  for v_i in 3..5 loop
    perform public.add_vehicle(null, 'Vauxhall', 'Corsa', 'White', null, null, null,
      'GARTEST filler ' || v_i, array[]::text[], '[]'::jsonb);
  end loop;

  begin
    perform public.add_vehicle(null, 'Audi', 'A3', 'Black', null, null, null,
      'GARTEST overflow', array[]::text[], '[]'::jsonb);
  exception when others then
    if sqlerrm like '%VEHICLE_LIMIT_REACHED%' then v_ok := true;
    else raise exception 'CHECK 2 FAILED: wrong error on the 6th vehicle: %', sqlerrm; end if;
  end;
  if not v_ok then raise exception 'CHECK 2 FAILED: a 6th vehicle was saved (cap not enforced)'; end if;

  -- Drop back under the cap. add_vehicle evaluates the cap BEFORE the plate
  -- dedupe, so leaving the owner at 5 would make every later block fail with
  -- VEHICLE_LIMIT_REACHED instead of the property it is actually testing —
  -- CHECK 3 would read as "duplicate plate refused" when it was really "garage
  -- full". Keep only 'GARTEST daily' (CHECK 3 and CHECK 7 both need it).
  delete from public.vehicles
  where user_id = '22222222-2222-2222-2222-222222222222'
    and (nickname like 'GARTEST filler%' or nickname = 'GARTEST bare');

  raise notice 'CHECK 2 passed: the 5-vehicle cap is enforced server-side';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 3 — plate uniqueness is PER USER, not global. The same user saving a
-- plate twice is refused; a DIFFERENT user saving the same plate SUCCEEDS.
-- Global uniqueness would be an oracle for other people's garages (and is
-- simply wrong: cars get sold).
-- -----------------------------------------------------------------------------
do $$
declare
  v_ok boolean := false;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

  -- Same user, same plate (different punctuation/case — the canon must match).
  begin
    perform public.add_vehicle('ga70car', 'BMW', '3 Series', 'Blue', null, null, null,
      'GARTEST dupe', array[]::text[], '[]'::jsonb);
  exception when others then
    if sqlerrm like '%PLATE_ALREADY_SAVED%' then v_ok := true;
    else raise exception 'CHECK 3 FAILED: wrong error on a duplicate plate: %', sqlerrm; end if;
  end;
  if not v_ok then
    raise exception 'CHECK 3 FAILED: the same user saved one plate twice';
  end if;

  -- A DIFFERENT user saves the SAME plate — must succeed.
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  perform public.add_vehicle('GA70 CAR', 'BMW', '3 Series', 'Blue', null, null, null,
    'GARTEST other-user same plate', array[]::text[], '[]'::jsonb);

  raise notice 'CHECK 3 passed: plate uniqueness is per-user; a second user may save the same plate';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 4 — SNAPSHOT INDEPENDENCE (the property this feature lives or dies on).
-- A post made from a garage vehicle carries its OWN copy of the car. Editing the
-- vehicle afterwards must not change one byte of the post; DELETING the vehicle
-- must leave the post whole, with vehicle_id simply going NULL.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc         jsonb;
  v_vehicle_id  uuid;
  v_post_id     uuid;
  v_post_before public.posts%rowtype;
  v_post_after  public.posts%rowtype;
  v_photos_before text[];
  v_photos_after  text[];
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

  -- A saved car...
  v_doc := public.add_vehicle(
    'GA70 SNP', 'BMW', '320d', 'Blue', null, 2019, 'Saloon', 'GARTEST snapshot',
    array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/g0.jpg'],
    '[]'::jsonb);
  v_vehicle_id := (v_doc ->> 'vehicle_id')::uuid;

  -- ...used to make a post. create_post does not take p_vehicle_id yet (that
  -- arrives in its own migration), so the provenance link is set the way that
  -- migration will set it. The post's OWN columns are what matters here.
  v_doc := public.create_post(
    'GA70 SNP', 'BMW', '320d', 'Blue', 2019, 'Saloon', null, null, null, null,
    'driveway', 'yes', now() - interval '1 day', 51.5074, -0.1278, 'London', 25000,
    array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/g0.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/g1.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/g2.jpg'],
    null, null, '[]'::jsonb);
  v_post_id := (v_doc ->> 'post_id')::uuid;
  update public.posts set vehicle_id = v_vehicle_id where id = v_post_id;

  select * into v_post_before from public.posts where id = v_post_id;
  select array_agg(url order by position) into v_photos_before
    from public.post_photos where post_id = v_post_id;

  -- (a) EDIT the garage car beyond recognition.
  perform public.update_vehicle(
    v_vehicle_id, 'ZZ99 XYZ', 'Audi', 'A4', 'Black', null, 2005, 'Estate', 'GARTEST snapshot edited',
    array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/g2.jpg'],
    '[]'::jsonb);

  select * into v_post_after from public.posts where id = v_post_id;
  select array_agg(url order by position) into v_photos_after
    from public.post_photos where post_id = v_post_id;

  if v_post_after.make <> v_post_before.make
     or v_post_after.model <> v_post_before.model
     or v_post_after.colour <> v_post_before.colour
     or v_post_after.year is distinct from v_post_before.year
     or v_post_after.body_type is distinct from v_post_before.body_type
     or v_post_after.plate is distinct from v_post_before.plate then
    raise exception 'CHECK 4 FAILED: editing the garage vehicle mutated the POST (live reference, not a snapshot)';
  end if;
  if v_photos_after is distinct from v_photos_before then
    raise exception 'CHECK 4 FAILED: editing the garage vehicle mutated the post photos';
  end if;

  -- (b) DELETE the garage car. The post must survive intact, vehicle_id NULL.
  perform public.delete_vehicle(v_vehicle_id);

  select * into v_post_after from public.posts where id = v_post_id;
  if not found then
    raise exception 'CHECK 4 FAILED: deleting the garage vehicle DELETED the post (cascade, not set null)';
  end if;
  if v_post_after.vehicle_id is not null then
    raise exception 'CHECK 4 FAILED: vehicle_id should be NULL after the vehicle is deleted';
  end if;
  if v_post_after.make <> v_post_before.make
     or v_post_after.model <> v_post_before.model
     or v_post_after.colour <> v_post_before.colour
     or v_post_after.plate is distinct from v_post_before.plate then
    raise exception 'CHECK 4 FAILED: deleting the garage vehicle changed the post''s identity';
  end if;
  select array_agg(url order by position) into v_photos_after
    from public.post_photos where post_id = v_post_id;
  if v_photos_after is distinct from v_photos_before then
    raise exception 'CHECK 4 FAILED: deleting the garage vehicle removed the post photos';
  end if;

  delete from public.posts where id = v_post_id;  -- self-clean
  raise notice 'CHECK 4 passed: a post is a SNAPSHOT — editing or deleting the garage vehicle cannot touch it';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 5 — removal is blocked while a post from this car is live. The post is
-- self-contained, so this is a UX guard (a car listed as stolen should not
-- vanish from the garage mid-hunt), not a data dependency — CHECK 4 already
-- proved the data survives either way.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc        jsonb;
  v_vehicle_id uuid;
  v_post_id    uuid;
  v_ok         boolean := false;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

  v_doc := public.add_vehicle('GA70 DEL', 'Ford', 'Focus', 'Green', null, null, null,
    'GARTEST delete-blocked', array[]::text[], '[]'::jsonb);
  v_vehicle_id := (v_doc ->> 'vehicle_id')::uuid;

  v_doc := public.create_post(
    'GA70 DEL', 'Ford', 'Focus', 'Green', null, null, null, null, null, null,
    'street', 'no', now() - interval '2 hours', 51.5074, -0.1278, 'London', 25000,
    array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/g0.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/g1.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/g2.jpg'],
    null, null, '[]'::jsonb);
  v_post_id := (v_doc ->> 'post_id')::uuid;
  update public.posts set vehicle_id = v_vehicle_id, status = 'active' where id = v_post_id;

  begin
    perform public.delete_vehicle(v_vehicle_id);
  exception when others then
    if sqlerrm like '%VEHICLE_HAS_ACTIVE_POST%' then v_ok := true;
    else raise exception 'CHECK 5 FAILED: wrong error deleting a posted vehicle: %', sqlerrm; end if;
  end;
  if not v_ok then
    raise exception 'CHECK 5 FAILED: a vehicle with a LIVE post was deleted';
  end if;

  -- list_my_vehicles must surface the same fact to the card.
  if not exists (
    select 1
    from jsonb_array_elements(public.list_my_vehicles()) elem
    where (elem ->> 'id')::uuid = v_vehicle_id
      and (elem ->> 'is_currently_posted')::boolean
      and (elem ->> 'active_post_id')::uuid = v_post_id
  ) then
    raise exception 'CHECK 5 FAILED: list_my_vehicles did not report is_currently_posted/active_post_id';
  end if;

  -- Once the post is no longer live, removal is allowed again.
  update public.posts set status = 'cancelled' where id = v_post_id;
  perform public.delete_vehicle(v_vehicle_id);
  if exists (select 1 from public.vehicles where id = v_vehicle_id) then
    raise exception 'CHECK 5 FAILED: vehicle not deleted once its post was closed';
  end if;

  delete from public.posts where id = v_post_id;  -- self-clean
  raise notice 'CHECK 5 passed: removal blocked while posted, reported by list_my_vehicles, allowed once closed';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 6 — A SAVED VEHICLE IS THE OWNER'S ALONE.
-- Absence is asserted three ways: another signed-in user's list_my_vehicles, a
-- direct table read as that user under real GRANTs + RLS, and the literal anon
-- role (which must be refused by the GRANT layer, not merely filtered).
-- -----------------------------------------------------------------------------
do $$
declare
  v_n        int;
  v_denied   boolean;
begin
  -- (a) The other user's garage must not contain the owner's cars.
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  select count(*) into v_n
  from jsonb_array_elements(public.list_my_vehicles()) elem
  where elem ->> 'nickname' like 'GARTEST%'
    and elem ->> 'nickname' <> 'GARTEST other-user same plate';
  if v_n <> 0 then
    raise exception 'CHECK 6 FAILED: another user sees % of the owner''s vehicles', v_n;
  end if;

  -- (b) A direct table read as that user, with grants + RLS actually applied.
  set local role authenticated;
  select count(*) into v_n from public.vehicles where nickname like 'GARTEST%'
    and user_id = '22222222-2222-2222-2222-222222222222';
  reset role;
  if v_n <> 0 then
    raise exception 'CHECK 6 FAILED: RLS let another user select % owner vehicles', v_n;
  end if;

  -- (c) The child tables must not leak either (a photo URL is still evidence a
  -- given person owns a given car).
  set local role authenticated;
  select count(*) into v_n
  from public.vehicle_photos vp
  join public.vehicles v on v.id = vp.vehicle_id
  where v.user_id = '22222222-2222-2222-2222-222222222222';
  reset role;
  if v_n <> 0 then
    raise exception 'CHECK 6 FAILED: another user read % of the owner''s vehicle photos', v_n;
  end if;

  -- (c2) The distinctive-feature descriptions are free text ABOUT someone's car
  -- ("cracked nearside mirror") — at least as identifying as a photo.
  set local role authenticated;
  select count(*) into v_n
  from public.vehicle_distinctive_feature df
  join public.vehicles v on v.id = df.vehicle_id
  where v.user_id = '22222222-2222-2222-2222-222222222222';
  reset role;
  if v_n <> 0 then
    raise exception 'CHECK 6 FAILED: another user read % of the owner''s distinctive features', v_n;
  end if;

  -- (c3) A signed-in user must not be able to WRITE the tables directly. This is
  -- the control behind "writes go only through the SECURITY DEFINER RPCs": the
  -- policies grant SELECT only, so an INSERT must be refused by the GRANT layer.
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  v_denied := false;
  begin
    set local role authenticated;
    insert into public.vehicles (user_id, make, model, colour)
    values ('11111111-1111-1111-1111-111111111111', 'X', 'Y', 'Z');
    reset role;
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'CHECK 6 FAILED: authenticated can INSERT into public.vehicles directly';
  end if;

  -- (d) The literal anon role must be refused by the GRANT layer on ALL FOUR RPCs.
  perform set_config('request.jwt.claims', null, true);
  v_denied := false;
  begin
    set local role anon;
    perform public.list_my_vehicles();
    reset role;
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'CHECK 6 FAILED: anon can EXECUTE list_my_vehicles';
  end if;

  v_denied := false;
  begin
    set local role anon;
    perform public.add_vehicle(null, 'X', 'Y', 'Z', null, null, null, null, array[]::text[], '[]'::jsonb);
    reset role;
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'CHECK 6 FAILED: anon can EXECUTE add_vehicle';
  end if;

  v_denied := false;
  begin
    set local role anon;
    perform public.update_vehicle(gen_random_uuid(), null, 'X', 'Y', 'Z',
      null, null, null, null, array[]::text[], '[]'::jsonb);
    reset role;
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'CHECK 6 FAILED: anon can EXECUTE update_vehicle';
  end if;

  v_denied := false;
  begin
    set local role anon;
    perform public.delete_vehicle(gen_random_uuid());
    reset role;
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'CHECK 6 FAILED: anon can EXECUTE delete_vehicle';
  end if;

  -- (e) ...and on ALL THREE tables (anon holds NO grant, so each must be
  -- insufficient_privilege — a silent zero-row result would mean a grant exists).
  v_denied := false;
  begin
    set local role anon;
    perform 1 from public.vehicles limit 1;
    reset role;
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'CHECK 6 FAILED: anon holds a SELECT grant on public.vehicles';
  end if;

  v_denied := false;
  begin
    set local role anon;
    perform 1 from public.vehicle_photos limit 1;
    reset role;
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'CHECK 6 FAILED: anon holds a SELECT grant on public.vehicle_photos';
  end if;

  v_denied := false;
  begin
    set local role anon;
    perform 1 from public.vehicle_distinctive_feature limit 1;
    reset role;
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'CHECK 6 FAILED: anon holds a SELECT grant on public.vehicle_distinctive_feature';
  end if;

  raise notice 'CHECK 6 passed: saved vehicles are owner-only — other users cannot read or write them, and anon is refused by GRANTs on all 4 RPCs and all 3 tables';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 7 — update_vehicle / delete_vehicle on someone else's car give ONE
-- opaque VEHICLE_NOT_FOUND (never an existence oracle).
-- -----------------------------------------------------------------------------
do $$
declare
  v_victim_id uuid;
  v_ok        boolean;
begin
  select id into v_victim_id from public.vehicles
  where user_id = '22222222-2222-2222-2222-222222222222'
    and nickname = 'GARTEST daily';
  if v_victim_id is null then raise exception 'CHECK 7 SETUP FAILED: fixture vehicle missing'; end if;

  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  v_ok := false;
  begin
    perform public.update_vehicle(v_victim_id, null, 'Hacked', 'Hacked', 'Hacked',
      null, null, null, null, array[]::text[], '[]'::jsonb);
  exception when others then
    if sqlerrm like '%VEHICLE_NOT_FOUND%' then v_ok := true;
    else raise exception 'CHECK 7 FAILED: wrong error updating another user''s vehicle: %', sqlerrm; end if;
  end;
  if not v_ok then raise exception 'CHECK 7 FAILED: another user UPDATED a vehicle'; end if;

  v_ok := false;
  begin
    perform public.delete_vehicle(v_victim_id);
  exception when others then
    if sqlerrm like '%VEHICLE_NOT_FOUND%' then v_ok := true;
    else raise exception 'CHECK 7 FAILED: wrong error deleting another user''s vehicle: %', sqlerrm; end if;
  end;
  if not v_ok then raise exception 'CHECK 7 FAILED: another user DELETED a vehicle'; end if;

  -- The victim's car is untouched.
  if not exists (
    select 1 from public.vehicles
    where id = v_victim_id and make = 'BMW'
      and user_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 7 FAILED: the victim vehicle was altered';
  end if;

  raise notice 'CHECK 7 passed: another user cannot update or delete a vehicle; both give one opaque code';
end $$;


-- -----------------------------------------------------------------------------
-- Final cleanup.
-- -----------------------------------------------------------------------------
delete from public.posts
where upper(regexp_replace(coalesce(plate, ''), '[^A-Za-z0-9]', '', 'g')) like 'GA70%';

delete from public.vehicles where nickname like 'GARTEST%';

do $$
begin
  raise notice 'garage_verification: ALL CHECKS PASSED';
end $$;
