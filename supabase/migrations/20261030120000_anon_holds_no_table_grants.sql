-- =============================================================================
-- anon holds only the public read surface — RLS is no longer the only lock
-- =============================================================================
-- WHAT:  Takes back every privilege the `anon` role holds on `public` except
--        SELECT on the deliberate public read surface (posts — its column
--        grant, which leaves out the exact location — post_photos,
--        post_feature, post_distinctive_feature, vehicle_feature), and changes
--        the default privileges so tables, sequences and functions created
--        from now on start CLOSED to `anon`.
-- WHY:   Found 2026-10-30 while checking why Supabase CLI 2.122 fails
--        anon_role_verification CHECK 2. Production's default privileges
--        grant every new table to `anon`, so `anon` (anyone holding the
--        public key) has SELECT/INSERT/UPDATE/DELETE on payments,
--        stripe_connected_accounts, stripe_webhook_events, refund_holds,
--        verification_documents, profiles, messages and 20 more — the very
--        walls anon_role_verification CHECKs 2–5 describe as grant-denied.
--        The migrations assumed new tables were NOT auto-granted
--        ("auto_expose_new_tables unset"), and CI agreed only because CLI
--        2.109's local stack did not auto-grant; production does.
--        NOTHING IS EXPOSED TODAY: RLS is on for every app table, and the
--        policies reaching `anon` are the intended public listing reads or
--        require auth.uid(). But RLS was the ONLY lock — a table created
--        without `enable row level security`, or a policy written `to public`
--        without an owner check, would have been open to anyone.
--        Nothing signed-out loses access: every signed-out screen reads through
--        SECURITY DEFINER functions (get_home_feed, get_nearby_posts,
--        search_posts, search_posts_count, get_post_detail,
--        get_public_sighting_entries, record_telemetry_events,
--        record_onboarding_step), which run as their owner, and the public
--        read surface keeps its SELECT. `authenticated` is unchanged (the app
--        reads several tables directly while signed in); reviewing it table
--        by table is a separate follow-up.
--        PostGIS's own objects (extension members) are left alone, as before.
-- LINKS: supabase/tests/anon_grants_verification.sql (pins this);
--        supabase/tests/anon_role_verification.sql (CHECKs 2–7, 10);
--        supabase/config.toml ([api] auto_expose_new_tables).
-- =============================================================================

do $$
declare
  -- The deliberate public read surface: SELECT stays (table or column grant).
  public_reads constant text[] := array[
    'posts', 'post_photos', 'post_feature', 'post_distinctive_feature', 'vehicle_feature'
  ];
  r record;
begin
  for r in
    select c.oid::regclass as rel, c.relname, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      -- PostGIS's own tables and sequences are extension members: not ours.
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
      )
  loop
    if r.relkind = 'S' then
      execute format('revoke all on sequence %s from anon', r.rel);
    elsif r.relname = any (public_reads) then
      -- Everything but SELECT (a table-level revoke clears column grants too).
      execute format(
        'revoke insert, update, delete, truncate, references, trigger on %s from anon', r.rel);
    else
      execute format('revoke all on %s from anon', r.rel);
    end if;
  end loop;
end $$;

-- Objects created from now on. Migrations run as `postgres`, so its defaults
-- are the ones that matter: a new table, sequence or function starts CLOSED
-- to `anon`, and a public read must be granted deliberately.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon, public;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
