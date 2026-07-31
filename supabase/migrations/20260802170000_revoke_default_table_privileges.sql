-- =============================================================================
-- WHAT:  Revokes the privileges Supabase's ALTER DEFAULT PRIVILEGES hands anon
--        and authenticated on the four notification tables, and re-grants ONLY
--        the ones those roles genuinely use.
-- WHY:   SAFETY (Tier 1 — found by supabase/tests/alerts_verification.sql
--        CHECK 28 on its first ever execution, 2026-07-31).
--
--        This project ships `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES
--        TO anon, authenticated`, so every CREATE TABLE silently hands both
--        roles REFERENCES, TRIGGER and TRUNCATE. The per-table `grant select`
--        lines in the original migrations ADD to that; they do not replace it.
--
--        TRUNCATE IS THE DANGEROUS ONE, AND IT IS NOT A THEORETICAL CONCERN:
--
--            set local role anon;
--            truncate public.alert_zones;   -- 4 rows -> 0 rows
--
--        ...succeeds. TRUNCATE IS NOT SUBJECT TO ROW LEVEL SECURITY — RLS
--        filters rows for DML, but TRUNCATE is a table-level privilege checked
--        before any policy runs. So every RLS policy on these tables, and the
--        deliberate absence of any client INSERT/UPDATE/DELETE grant, is
--        bypassed entirely by one statement. On alert_zones that erases every
--        spotter's alerts in the country; on push_tokens it silently ends push
--        delivery for every device, which fails CLOSED and quietly (nobody gets
--        an alert; nothing errors).
--
--        Not reachable through PostgREST today — it exposes SELECT/INSERT/
--        UPDATE/DELETE and RPCs, not TRUNCATE, and the anon API key is a JWT
--        rather than Postgres credentials. This is defence in depth: the hole
--        opens the moment anything runs dynamic SQL as the caller, and a
--        privilege nobody uses costs nothing to drop.
--
--        ⚠️ SCOPE: this migration fixes the FOUR TABLES THIS FEATURE OWNS. All
--        24 other public tables — including payments, posts, profiles and
--        sightings — still grant anon TRUNCATE. That is a pre-existing,
--        project-wide gap that predates this branch, and widening a
--        security-grant change across other features' tables belongs in its own
--        reviewed migration with its own suite run. Recorded in
--        docs/SECURITY_AND_TRUST.md.
-- LINKS: supabase/migrations/20260802100000_push_infrastructure.sql (push_tokens,
--          push_sends, push_receipts + their original grants),
--        supabase/migrations/20260802120000_alert_zones.sql (alert_zones),
--        supabase/tests/alerts_verification.sql (CHECK 28 — the assertion),
--        docs/SECURITY_AND_TRUST.md §6.
-- =============================================================================

-- Reset to nothing, then re-grant deliberately. `revoke all` also clears the
-- SELECT granted by the original migrations, so each one is restored below —
-- keeping this file the single, readable statement of who may touch these
-- tables, rather than a diff against two earlier ones.
revoke all on public.alert_zones   from anon, authenticated;
revoke all on public.push_tokens   from anon, authenticated;
revoke all on public.push_sends    from anon, authenticated;
revoke all on public.push_receipts from anon, authenticated;

-- alert_zones: the owner reads their own rows through RLS. Writes go ONLY
-- through create_my_alert / update_my_alert / delete_my_alert /
-- set_my_alert_enabled (SECURITY DEFINER), because the approximate-mode snap
-- must be a server guarantee — so there is deliberately no client DML grant.
grant select on public.alert_zones to authenticated;

-- push_tokens: the owner may read their own devices (RLS-scoped). Registration
-- and pruning go through the SECURITY DEFINER RPCs.
grant select on public.push_tokens to authenticated;

-- push_sends / push_receipts stay service-role only: they are send history and
-- delivery receipts, of no use to a client and a per-user activity log if read.
-- No grant to authenticated at all, and no policies (asserted by CHECK 28).

-- anon gets NOTHING on any of the four. A guest has no device, no alerts, no
-- send history and no receipts; every one of these rows needs an owner.
