-- =============================================================================
-- WHAT:  Stop `sightings.review_flags` and `sightings.counted_at` reaching the
--        client, by replacing `authenticated`'s TABLE-wide SELECT on
--        public.sightings with an explicit COLUMN list that omits both.
--
-- WHY:   20260814140000 added those two columns and documented them as
--        "Service-role readable only and NEVER returned by any RPC — telling
--        someone which signal caught them is a tutorial in evading it".
--        That was true of the RPCs and false of the table. `sightings` carries
--        a table-wide `grant select ... to authenticated` (20260714100000:137)
--        and an RLS policy letting a spotter read their OWN rows (:145-149), so
--        the new columns inherited both and the flagged spotter could read
--        their own verdict:
--
--            GET /rest/v1/sightings
--                ?select=id,status,review_flags,counted_at&spotter_id=eq.<self>
--
--        returning exactly which signal fired (`shared_device` vs
--        `repeat_pair`) and exactly which confirmations scored. SECURITY_AND_
--        TRUST §4 forbids precisely this. It is worse than a badge leak:
--        `shared_device` is the SAME signal the payout gate uses, so the read
--        teaches evasion of the money gate, not just the reputation one.
--
--        ⚠️ A COLUMN-LEVEL REVOKE DOES NOT WORK HERE, which is why this is a
--        table-grant rewrite rather than the one-liner it looks like it should
--        be. PostgreSQL: "if table-level privileges are present then
--        column-level privileges are effectively ignored". So
--        `revoke select (review_flags) ...` against a role holding table SELECT
--        silently changes nothing — it would have read like a fix and shipped
--        the leak. The table grant has to go, replaced by the explicit list.
--
--        FAILING CLOSED IS THE POINT OF THE EXPLICIT LIST. A column added later
--        is NOT granted until someone names it here, so the next
--        service-role-only column cannot leak the way these two did. The cost
--        is that adding a client-visible column now takes two edits; the check
--        at the bottom names that cost so nobody "fixes" it back to a table
--        grant.
--
--        service_role is untouched — it bypasses RLS and needs both columns.
-- LINKS: supabase/migrations/20260814140000_flag_on_the_sighting_not_the_payout.sql;
--        supabase/migrations/20260714100000_sightings.sql (the original grant);
--        supabase/functions/_shared/collusion.ts (the money gate sharing the signal);
--        docs/SECURITY_AND_TRUST.md §4.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Swap the table grant for an explicit column list.
-- -----------------------------------------------------------------------------
-- `revoke all`, not `revoke select`, and `anon` too. SECURITY_AND_TRUST.md
-- §406-431 records that the project's ALTER DEFAULT PRIVILEGES left `anon` and
-- `authenticated` holding TRUNCATE/REFERENCES/TRIGGER on 24 tables and names
-- THIS ONE: "a single statement there would erase every live report". TRUNCATE
-- ignores RLS entirely. This migration is already rewriting the table's ACL, so
-- taking the rest costs nothing — the column grant below restores everything
-- either role actually uses (which for `anon` is nothing at all).
revoke all on public.sightings from authenticated;

revoke all on public.sightings from anon;

-- Every column EXCEPT review_flags and counted_at. The *_notified_at columns
-- stay readable because they already were and the client's own row telling it
-- when it was notified is not a signal about detection.
grant select (
  id,
  post_id,
  spotter_id,
  status,
  context_flags,
  note,
  area_label,
  location_unavailable,
  created_at,
  locality,
  parked_likelihood,
  direction,
  people_presence,
  confirmed_feature_ids,
  notified_at,
  credited_notified_at,
  closed_notified_at,
  not_credited_notified_at,
  reviewed_at,
  confirmed_notified_at
) on public.sightings to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Assert it, in the migration, against the two failure modes.
-- -----------------------------------------------------------------------------
do $$
declare
  v_leaked text;
begin
  -- (a) The two columns must NOT be selectable by `authenticated`.
  select string_agg(c, ', ' order by c) into v_leaked
  from unnest(array['review_flags', 'counted_at']) as c
  where has_column_privilege('authenticated', 'public.sightings', c, 'SELECT');

  if v_leaked is not null then
    raise exception
      'review_flags/counted_at still readable by authenticated: %. A column-level REVOKE is ignored while a table-level grant exists — the table grant must be dropped.',
      v_leaked;
  end if;

  -- (b) ...and everything the client legitimately reads must STILL be
  -- selectable, or this migration has quietly broken the spotter's own history.
  select string_agg(a.attname, ', ' order by a.attnum) into v_leaked
  from pg_attribute a
  where a.attrelid = 'public.sightings'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and a.attname not in ('review_flags', 'counted_at')
    and not has_column_privilege('authenticated', 'public.sightings', a.attname, 'SELECT');

  if v_leaked is not null then
    raise exception
      'these columns lost SELECT for authenticated and the client needs them: %',
      v_leaked;
  end if;

  -- (c) TRUNCATE must be gone for both client roles.
  if has_table_privilege('authenticated', 'public.sightings', 'TRUNCATE')
     or has_table_privilege('anon', 'public.sightings', 'TRUNCATE') then
    raise exception 'a client role still holds TRUNCATE on public.sightings — RLS does not stop it';
  end if;

  raise notice 'review_flags and counted_at are service-role only; every other column still readable; TRUNCATE revoked.';
end $$;

-- ⚠️ THIS BLOCK IS A ONE-SHOT — it runs when this migration runs and never
-- again, so a later `grant select on public.sightings to authenticated` would
-- re-open the leak and STILL pass a fresh `db reset`. The standing guard is
-- CHECK 27 in supabase/tests/sightings_verification.sql, which runs on every
-- `npm run test:db`. If you move or rename that check, keep the assertion.
