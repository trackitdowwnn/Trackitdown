/**
 * WHAT:  The cross-boundary guard for why a sighting was taken back: the
 *        app's WITHDRAW_REASONS must be exactly the values the database's
 *        latest `sightings_withdraw_reason_chk` (and withdraw_sighting's own
 *        pre-check) accept.
 * WHY:   No shared type crosses the SQL boundary. An answer offered by the
 *        app that the server refuses would fail the whole withdrawal with
 *        INVALID_INPUT — a spotter could not take a report back by picking
 *        it. Lives here (not beside the source) because it reads migration
 *        files, which needs node types — as notificationKinds.test.ts does.
 * LINKS: src/features/sightings/lib/withdrawReasons.ts;
 *        supabase/migrations/20261009150000_a_withdrawal_says_why.sql.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { WITHDRAW_REASONS } from '../../src/features/sightings/lib/withdrawReasons';

const MIGRATIONS_DIR = join(__dirname, '../migrations');

/** The quoted values in the LATEST migration that names the constraint. */
function latestReasonCheck(): string[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of [...files].reverse()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    const match = sql.match(
      /add constraint sightings_withdraw_reason_chk[\s\S]*?withdraw_reason in \(([^)]*)\)/,
    );
    if (match) return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  }
  throw new Error('sightings_withdraw_reason_chk not found in any migration');
}

describe('withdraw reasons', () => {
  it('⚠️ the app offers exactly the answers the database accepts', () => {
    expect([...WITHDRAW_REASONS].sort()).toEqual(latestReasonCheck().sort());
  });
});
