#!/usr/bin/env bash
# WHAT:  Runs every SQL verification suite in supabase/tests/ against a freshly
#        reset local database (migrations + seed), aborting on the first
#        failure. Single entry point: `npm run test:db`.
# WHY:   The suites are self-asserting Tier 1 gates (docs/TESTING.md) — each
#        file RAISEs on violation and psql -v ON_ERROR_STOP=1 turns that into a
#        non-zero exit. Before this script they were only invoked by hand per
#        their header comments, so a new suite could silently never run.
# LINKS: supabase/tests/*.sql, docs/TESTING.md, supabase/config.toml ([db] port).

set -euo pipefail
cd "$(dirname "$0")/.."

# Local Supabase db (supabase/config.toml [db] port 54322) unless overridden.
DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

# Fresh state: apply all migrations + seed.sql (requires `npx supabase start`).
npx supabase db reset

for suite in \
  supabase/tests/home_feed_verification.sql \
  supabase/tests/post_detail_verification.sql \
  supabase/tests/create_post_verification.sql \
  supabase/tests/sightings_verification.sql \
  supabase/tests/anon_role_verification.sql
do
  echo "== ${suite}"
  psql -v ON_ERROR_STOP=1 "${DB_URL}" -f "${suite}"
done

echo "All SQL verification suites passed."
