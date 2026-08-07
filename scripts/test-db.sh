#!/usr/bin/env bash
# WHAT:  Runs every SQL verification suite in supabase/tests/ against a freshly
#        reset local database (migrations + seed), aborting on the first
#        failure. Single entry point: `npm run test:db`.
# WHY:   The suites are self-asserting Tier 1 gates (docs/TESTING.md) — each
#        file RAISEs on violation and psql -v ON_ERROR_STOP=1 turns that into a
#        non-zero exit. Before this script they were only invoked by hand per
#        their header comments, so a new suite could silently never run.
#        Runs through host psql when it exists, otherwise through the psql
#        inside the local supabase_db container — `supabase start` is already
#        required either way, so that removes the only remaining reason this
#        command failed on a Windows box with no Postgres client installed.
# LINKS: supabase/tests/*.sql, docs/TESTING.md, supabase/config.toml ([db] port).

set -euo pipefail
cd "$(dirname "$0")/.."

# Local Supabase db (supabase/config.toml [db] port 54322) unless overridden.
DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

# Windows psql picks client_encoding from the console/ANSI code page and it
# VARIES with how output is redirected — the suites' UTF-8 text (em dashes in
# copy assertions) then mis-reads and text comparisons fail only in some
# harnesses. Pin it; harmless everywhere else (the container is UTF-8 already).
export PGCLIENTENCODING=UTF8

# psql on the HOST is optional. `supabase start` is already a hard prerequisite
# (db reset below needs it), and that container ships psql — so a machine with
# Docker but no Postgres client install can still run this. That is the normal
# case on Windows, where installing psql means installing all of Postgres.
#
# The container is only a valid substitute for the LOCAL database, so an
# explicit DATABASE_URL without host psql is a hard error rather than a silent
# run against the wrong server.
CONTAINER="supabase_db_$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml)"

if command -v psql >/dev/null 2>&1; then
  run_suite() { psql -v ON_ERROR_STOP=1 "${DB_URL}" -f "$1"; }
elif [ -n "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is set but psql is not on PATH." >&2
  echo "The ${CONTAINER} fallback can only reach the LOCAL database, so this" >&2
  echo "would run the suites somewhere other than you asked. Install psql." >&2
  exit 1
elif docker exec "${CONTAINER}" true >/dev/null 2>&1; then
  # Inside the container Postgres listens on 5432 — 54322 is the HOST mapping.
  # Piped via stdin (-f -) so the .sql files need no bind mount.
  run_suite() {
    docker exec -i -e PGCLIENTENCODING=UTF8 "${CONTAINER}" \
      psql -v ON_ERROR_STOP=1 postgresql://postgres:postgres@127.0.0.1:5432/postgres -f - < "$1"
  }
else
  echo "Need either psql on PATH or a running ${CONTAINER} container." >&2
  echo "Start Docker Desktop, then: npx supabase start" >&2
  exit 1
fi

# Fresh state: apply all migrations + seed.sql (requires `npx supabase start`).
npx supabase db reset

for suite in \
  supabase/tests/home_feed_verification.sql \
  supabase/tests/post_detail_verification.sql \
  supabase/tests/create_post_verification.sql \
  supabase/tests/sightings_verification.sql \
  supabase/tests/chat_verification.sql \
  supabase/tests/watchlist_verification.sql \
  supabase/tests/post_payment_verification.sql \
  supabase/tests/refund_cancel_verification.sql \
  supabase/tests/post_flags_verification.sql \
  supabase/tests/edit_post_sections_verification.sql \
  supabase/tests/garage_verification.sql \
  supabase/tests/alerts_verification.sql \
  supabase/tests/recovery_verification.sql \
  supabase/tests/refund_hold_verification.sql \
  supabase/tests/notification_center_verification.sql \
  supabase/tests/not_credited_verification.sql \
  supabase/tests/anon_role_verification.sql
do
  echo "== ${suite}"
  run_suite "${suite}"
done

echo "All SQL verification suites passed."
