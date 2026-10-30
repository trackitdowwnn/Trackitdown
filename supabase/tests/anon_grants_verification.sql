-- =============================================================================
-- WHAT:  anon grant-matrix verification (NOT a migration). Sweeps EVERY table,
--        view and sequence in `public` (except PostGIS's own) and fails if the
--        `anon` role holds anything beyond SELECT on the deliberate public read
--        surface; then proves that objects created NOW start closed to `anon`.
-- WHY:   2026-10-30: production had granted `anon` full DML on 27 tables
--        (payments and stripe_* among them) through default privileges, while
--        anon_role_verification — which probes a few named tables — passed in
--        CI, because CLI 2.109's local stack never auto-granted. RLS held, but
--        it was the only lock. This sweep catches the next table too, under any
--        CLI's default (20261030120000_anon_holds_no_table_grants.sql).
-- LINKS: supabase/migrations/20261030120000_anon_holds_no_table_grants.sql;
--        supabase/tests/anon_role_verification.sql; docs/SECURITY_AND_TRUST.md §6.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- CHECK 1 — anon holds SELECT on the public read surface, and nothing else on
-- any of our tables or views (table OR column level).
-- -----------------------------------------------------------------------------
do $$
declare
  public_reads constant text[] := array[
    'posts', 'post_photos', 'post_feature', 'post_distinctive_feature', 'vehicle_feature'
  ];
  v_bad text;
begin
  select string_agg(format('%s (%s)', c.relname, p.priv), ', ' order by c.relname, p.priv)
    into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) as p(priv)
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
    )
    and has_any_column_privilege('anon', c.oid, p.priv)
    and not (p.priv = 'SELECT' and c.relname = any (public_reads));
  if v_bad is null then
    select string_agg(format('%s (%s)', c.relname, p.priv), ', ' order by c.relname, p.priv)
      into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('DELETE'), ('TRUNCATE'), ('TRIGGER')) as p(priv)
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
      )
      and has_table_privilege('anon', c.oid, p.priv);
  end if;
  if v_bad is not null then
    raise exception 'CHECK 1 FAILED: anon holds privileges outside the public read surface: %. '
                    'Revoke them in the migration that creates the table.', v_bad;
  end if;

  -- The public read surface itself must still be readable, or this is an outage.
  if not (select bool_and(has_any_column_privilege('anon', ('public.' || t)::regclass, 'SELECT'))
            from unnest(public_reads) as t) then
    raise exception 'CHECK 1 FAILED: anon lost SELECT on the public read surface';
  end if;
  raise notice 'CHECK 1 passed: anon holds SELECT on the public read surface and nothing else.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 2 — anon has no access to any of our sequences.
-- -----------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'S'
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
    )
    and (has_sequence_privilege('anon', c.oid, 'USAGE')
      or has_sequence_privilege('anon', c.oid, 'SELECT')
      or has_sequence_privilege('anon', c.oid, 'UPDATE'));
  if v_bad is not null then
    raise exception 'CHECK 2 FAILED: anon can use sequences: %', v_bad;
  end if;
  raise notice 'CHECK 2 passed: anon has no sequence access.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 3 — a table, sequence and function created NOW (as postgres, like a
-- migration) start closed to anon: the default privileges hold.
-- -----------------------------------------------------------------------------
do $$
declare
  v_table boolean;
  v_seq boolean;
  v_fn boolean;
begin
  create table public.zz_anon_default_probe (id int);
  create sequence public.zz_anon_default_probe_seq;
  create function public.zz_anon_default_probe_fn() returns int language sql as 'select 1';

  v_table := has_any_column_privilege('anon', 'public.zz_anon_default_probe'::regclass, 'SELECT')
          or has_table_privilege('anon', 'public.zz_anon_default_probe'::regclass, 'DELETE');
  v_seq := has_sequence_privilege('anon', 'public.zz_anon_default_probe_seq'::regclass, 'USAGE');
  v_fn := has_function_privilege('anon', 'public.zz_anon_default_probe_fn()'::regprocedure, 'EXECUTE');

  drop function public.zz_anon_default_probe_fn();
  drop sequence public.zz_anon_default_probe_seq;
  drop table public.zz_anon_default_probe;

  if v_table or v_seq or v_fn then
    raise exception 'CHECK 3 FAILED: a new object is open to anon (table %, sequence %, function %)',
      v_table, v_seq, v_fn;
  end if;
  raise notice 'CHECK 3 passed: new tables, sequences and functions start closed to anon.';
end $$;
