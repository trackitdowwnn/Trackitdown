-- =============================================================================
-- WHAT:  Revokes TRUNCATE, REFERENCES and TRIGGER from anon and authenticated
--        on EVERY table in the public schema.
-- WHY:   SAFETY (Tier 1). This project ships Supabase's
--        `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon,
--        authenticated`, so every CREATE TABLE silently hands both roles
--        TRUNCATE, REFERENCES and TRIGGER. Per-table `grant select` lines ADD
--        to that; they do not replace it.
--
--        TRUNCATE IS NOT SUBJECT TO ROW LEVEL SECURITY. RLS filters rows for
--        DML; TRUNCATE is a table-level privilege checked before any policy
--        runs. So every policy on these tables, and the deliberate absence of
--        any client INSERT/UPDATE/DELETE grant, is bypassed by one statement:
--
--            set local role anon;
--            truncate public.payments;   -- the escrow ledger -> 0 rows
--
--        20260802170000 closed this on the four notification tables on
--        2026-07-31 and recorded the rest as a known, project-wide gap:
--        "All 24 other public tables — including payments, posts, profiles and
--        sightings — still grant anon TRUNCATE." This is that migration.
--
--        Not reachable through PostgREST today: it exposes DML and RPCs, not
--        TRUNCATE, and the anon key is a JWT rather than Postgres credentials.
--        This is defence in depth — the hole opens the moment anything runs
--        dynamic SQL as the caller, and a privilege nobody uses costs nothing
--        to drop. The blast radius is what makes it worth a migration: the
--        payments ledger is the record of whose money is whose.
--
-- ⚠️ SURGICAL, NOT `revoke all` + re-grant, and that is a deliberate departure
--        from 20260802170000's shape. That migration owned its four tables and
--        could restate their grants from scratch safely. This one touches 36
--        tables across every feature, and re-deriving each one's real
--        SELECT/INSERT/UPDATE/DELETE needs would be a large, silent way to
--        break the app — a missed `grant select` is a screen that returns
--        nothing, with RLS-shaped symptoms and no error. Revoking only the
--        three privileges no client legitimately uses cannot do that: DML and
--        the RLS that governs it are untouched.
--
--        REFERENCES and TRIGGER go with TRUNCATE because they are the same
--        class of accident. TRIGGER is arguably the worst of the three — it
--        lets a role attach arbitrary code to another feature's table.
--
-- ⚠️ SET-BASED, NOT 36 NAMED STATEMENTS. The invariant is "no table in public
--        grants these to a client role", and a list of names states it only
--        until the next CREATE TABLE. The loop is also why this migration is
--        safe to re-run. It does NOT fix the DEFAULT privilege that recreates
--        the hole on every new table: that is set by Supabase during project
--        bootstrap, not by anything in this repo, so the grantor role is not
--        ours to assume. The durable guard is the verification suite instead —
--        anon_role_verification.sql now FAILS if any public table grants
--        TRUNCATE to anon or authenticated, so the next table that arrives
--        with it turns CI red rather than sitting unnoticed for a month.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: `revoke` removes privileges; it
--        touches no row of data and drops no object. The three revoked are
--        used by no client path in this codebase — grep for `truncate` outside
--        SQL suites returns nothing.
--
-- LINKS: supabase/migrations/20260802170000_notification_table_grants.sql
--          (the same fix on four tables, and the header this one continues);
--        supabase/tests/anon_role_verification.sql (the assertion);
--        docs/SECURITY_AND_TRUST.md §6.
-- =============================================================================

do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       -- Ordinary tables and partitioned tables. Views and matviews cannot be
       -- truncated and take no TRIGGER/REFERENCES grant worth revoking.
       and c.relkind in ('r', 'p')
     order by c.relname
  loop
    execute format(
      'revoke truncate, references, trigger on public.%I from anon, authenticated',
      r.relname
    );
  end loop;
end $$;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
