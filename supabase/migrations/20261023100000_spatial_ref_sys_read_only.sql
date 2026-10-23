-- =============================================================================
-- WHAT:  public.spatial_ref_sys (PostGIS's EPSG table) becomes read-only for
--        everyone but the database's own roles: a BEFORE trigger refuses any
--        INSERT / UPDATE / DELETE (per row) and TRUNCATE (per statement) unless
--        it comes from supabase_admin, postgres or service_role.
-- WHY:   Supabase's Security Advisor (ERROR 0013, emailed 2026-10-23): the
--        table has RLS off, and `anon` and `authenticated` hold INSERT, UPDATE,
--        DELETE and TRUNCATE on it — so anyone with the app's PUBLIC key could
--        empty or rewrite it through the REST API. Every location query leans
--        on it (the feed, nearby search, maps, sighting distances), so that is
--        an outage on demand, or worse, distances quietly wrong.
--
--        ⚠️ WHY A TRIGGER, NOT A REVOKE. The table belongs to supabase_admin,
--        which made those grants without grant option, so a REVOKE from our
--        role is a silent no-op (20260901130000 found exactly that; see the
--        note in tests/anon_role_verification.sql) and ENABLE ROW LEVEL
--        SECURITY needs ownership. Our role DOES hold TRIGGER on it — so the
--        refusal lives in a trigger instead.
--
--        AN ALLOW-LIST, NOT A DENY-LIST (team review, 2026-10-23): naming the
--        roles that may write also shuts out any role Supabase adds later.
--        PostGIS upgrades run as supabase_admin, so they still work.
--
--        The Advisor's ERROR stays red after this: its check reads the RLS
--        flag, which only Supabase can change. The trigger is the protection;
--        clearing the flag is a support request to Supabase.
--
--        Checked before this ran (2026-10-23): 8,500 rows, and EPSG 4326 /
--        3857 / 27700 / 4258 with their standard definitions — nothing to
--        restore first.
-- LINKS: supabase/tests/spatial_ref_sys_read_only_verification.sql;
--        supabase/tests/anon_role_verification.sql (CHECK 13's PostGIS note);
--        https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public
-- =============================================================================

create or replace function public.spatial_ref_sys_read_only()
returns trigger
language plpgsql
-- SECURITY INVOKER (the default) on purpose: current_user must be the CALLER.
set search_path = ''
as $$
begin
  if current_user not in ('supabase_admin', 'postgres', 'service_role') then
    raise exception 'spatial_ref_sys is read-only'
      using errcode = '42501',
            hint = 'PostGIS reference data; only the database''s own roles may change it.';
  end if;
  -- TRUNCATE fires per statement; a statement trigger's return is ignored.
  if tg_level = 'STATEMENT' then
    return null;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.spatial_ref_sys_read_only() is
  'Refuses writes to public.spatial_ref_sys from anyone but supabase_admin, postgres and service_role (20261023100000).';

-- A trigger function can't be called directly, but keep it off the API's list.
revoke all on function public.spatial_ref_sys_read_only() from public, anon, authenticated;

-- Re-runnable: a PostGIS drop/recreate would take these with the table.
drop trigger if exists spatial_ref_sys_read_only_rows on public.spatial_ref_sys;
create trigger spatial_ref_sys_read_only_rows
  before insert or update or delete on public.spatial_ref_sys
  for each row execute function public.spatial_ref_sys_read_only();

-- Row triggers never fire for TRUNCATE: it needs its own, per statement.
drop trigger if exists spatial_ref_sys_read_only_truncate on public.spatial_ref_sys;
create trigger spatial_ref_sys_read_only_truncate
  before truncate on public.spatial_ref_sys
  for each statement execute function public.spatial_ref_sys_read_only();
