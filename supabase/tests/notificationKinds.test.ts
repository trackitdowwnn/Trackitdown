/**
 * WHAT:  The cross-boundary half of the notification-kind guard: asserts the
 *        database's `push_sends_kind_chk` whitelist is exactly the client's
 *        NOTIFICATION_KINDS.
 * WHY:   There is no shared type across the SQL boundary, so nothing else
 *        catches a kind added on one side only — and the symptom is silent: a
 *        push the client refuses to parse, arriving and routing nowhere.
 *        Lives HERE rather than beside the source because reading a file needs
 *        node types, and `supabase/tests` is excluded from tsconfig (the same
 *        reason migrationChain.test.ts lives here).
 * LINKS: src/features/notifications/lib/notificationKinds.ts (the other half);
 *        supabase/migrations/20260802100000_push_infrastructure.sql.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { NOTIFICATION_KINDS } from '../../src/features/notifications/lib/notificationKinds';

const MIGRATIONS_DIR = join(__dirname, '../migrations');

describe('push_sends kind constraint', () => {
  it('lists exactly the kinds the client knows about', () => {
    // The LATEST definition wins: a later migration may drop and re-add the
    // constraint to widen it (20260804100000 did exactly that), and pinning
    // this test to the original file would compare the client against a
    // superseded whitelist. Migrations sort lexicographically by timestamp,
    // so the last file containing the constraint holds the live definition.
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();

    let latest: string | null = null;
    for (const name of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
      const match = sql.match(/push_sends_kind_chk\s+check\s*\(kind in \(([^)]*)\)\)/);
      if (match) {
        latest = match[1];
      }
    }
    // If this fails the constraint was reformatted — update the regex rather
    // than deleting the assertion.
    expect(latest).not.toBeNull();

    const kinds = (latest ?? '')
      .split(',')
      .map((value: string) => value.trim().replace(/^'|'$/g, ''));
    expect([...kinds].sort()).toEqual([...NOTIFICATION_KINDS].sort());
  });
});
