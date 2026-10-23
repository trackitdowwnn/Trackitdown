-- =============================================================================
-- WHAT:  Verification for 20261023100000_spatial_ref_sys_read_only.sql. NOT a
--        migration.
-- WHY:   Supabase's Advisor (ERROR 0013): anyone with the app's public key held
--        INSERT / UPDATE / DELETE / TRUNCATE on PostGIS's EPSG table, and a
--        REVOKE from our role can't remove that. A trigger refuses it instead.
--        This proves the REFUSAL — not the grants — so it can't pass for the
--        wrong reason (a plain "permission denied").
--
-- CHECKS: 1 the precondition is real here: anon and authenticated DO hold the
-- write grants (as on prod), so checks 2–3 test the trigger, not a missing
-- grant · 2 ⚠️ anon: INSERT, UPDATE, DELETE and TRUNCATE each refused with
-- "spatial_ref_sys is read-only" · 3 ⚠️ authenticated: the same · 4 postgres
-- (our migrations) can still write · 5 reads and ST_Transform still work for
-- anon · 6 the triggers exist, and the function isn't on the API.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        Each refused write runs in its own exception block (a subtransaction)
--        under SET LOCAL ROLE, against REAL rows: a row trigger never fires
--        for a DELETE that matches nothing.
-- LINKS: supabase/migrations/20261023100000_spatial_ref_sys_read_only.sql.
-- =============================================================================

begin;

-- 1 — the precondition. Without it, checks 2–3 would pass on "permission
-- denied" and prove nothing about the trigger.
do $$
declare
  v_role text;
  v_priv text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if not has_table_privilege(v_role, 'public.spatial_ref_sys', v_priv) then
        raise exception 'CHECK 1 FAILED: % lacks % on spatial_ref_sys here (prod has it), so this suite would prove nothing',
          v_role, v_priv;
      end if;
    end loop;
  end loop;
end $$;

-- 2 — anon: every kind of write refused, by the trigger's own words.
set local role anon;
do $$
declare
  v_attempt text;
begin
  foreach v_attempt in array array[
    'insert into public.spatial_ref_sys (srid, auth_name, auth_srid, srtext, proj4text) values (990001, ''x'', 990001, ''x'', ''x'')',
    'update public.spatial_ref_sys set proj4text = ''x'' where srid = 4326',
    'delete from public.spatial_ref_sys where srid = 4326',
    'truncate public.spatial_ref_sys'
  ] loop
    begin
      execute v_attempt;
      raise exception 'CHECK 2 FAILED: went through as anon: %', v_attempt;
    exception
      when insufficient_privilege then
        if sqlerrm <> 'spatial_ref_sys is read-only' then
          raise exception 'CHECK 2 FAILED: refused for the wrong reason (%): %', sqlerrm, v_attempt;
        end if;
    end;
  end loop;
end $$;
reset role;

-- 3 — authenticated: the same.
set local role authenticated;
do $$
declare
  v_attempt text;
begin
  foreach v_attempt in array array[
    'insert into public.spatial_ref_sys (srid, auth_name, auth_srid, srtext, proj4text) values (990002, ''x'', 990002, ''x'', ''x'')',
    'update public.spatial_ref_sys set proj4text = ''x'' where srid = 4326',
    'delete from public.spatial_ref_sys where srid = 4326',
    'truncate public.spatial_ref_sys'
  ] loop
    begin
      execute v_attempt;
      raise exception 'CHECK 3 FAILED: went through as authenticated: %', v_attempt;
    exception
      when insufficient_privilege then
        if sqlerrm <> 'spatial_ref_sys is read-only' then
          raise exception 'CHECK 3 FAILED: refused for the wrong reason (%): %', sqlerrm, v_attempt;
        end if;
    end;
  end loop;
end $$;
reset role;

-- 4 — our own role (migrations) can still write. Rolled back with the rest.
do $$
begin
  if current_user <> 'postgres' then
    raise exception 'CHECK 4 FAILED: expected to run as postgres, not %', current_user;
  end if;
  insert into public.spatial_ref_sys (srid, auth_name, auth_srid, srtext, proj4text)
  values (990003, 'TEST', 990003, 'TEST', '+proj=longlat +datum=WGS84 +no_defs');
  update public.spatial_ref_sys set auth_name = 'TEST2' where srid = 990003;
  delete from public.spatial_ref_sys where srid = 990003;
end $$;

-- 5 — reads still work for the public, and so does the maths that needs them
-- (PostGIS lives in public on this project).
set local role anon;
do $$
declare
  v_point text;
begin
  if (select count(*) from public.spatial_ref_sys where srid in (4326, 27700)) <> 2 then
    raise exception 'CHECK 5 FAILED: anon can no longer read the EPSG rows';
  end if;
  v_point := public.st_astext(
    public.st_transform(public.st_setsrid(public.st_makepoint(-0.1276, 51.5072), 4326), 27700)
  );
  if v_point is null or v_point not like 'POINT(%' then
    raise exception 'CHECK 5 FAILED: ST_Transform broke for anon: %', v_point;
  end if;
end $$;
reset role;

-- 6 — the triggers are in place; the function is not on the API.
do $$
begin
  if (select count(*) from pg_trigger
       where tgrelid = 'public.spatial_ref_sys'::regclass
         and tgname in ('spatial_ref_sys_read_only_rows', 'spatial_ref_sys_read_only_truncate')
         and tgenabled = 'O') <> 2 then
    raise exception 'CHECK 6 FAILED: the read-only triggers are missing or disabled';
  end if;
  if has_function_privilege('anon', 'public.spatial_ref_sys_read_only()', 'execute')
     or has_function_privilege('authenticated', 'public.spatial_ref_sys_read_only()', 'execute') then
    raise exception 'CHECK 6 FAILED: the trigger function is executable by API roles';
  end if;
end $$;

rollback;
