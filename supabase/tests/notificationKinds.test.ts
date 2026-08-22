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

/**
 * Kinds the DATABASE permits that the CLIENT deliberately does not handle.
 *
 * Every entry is a gap, not a decision to be comfortable with — the whole point
 * of this file is that a kind on one side only produces a push that arrives and
 * routes nowhere. An entry is only defensible while NOTHING SENDS the kind.
 * Check that before adding one, and delete it the moment the client can route.
 */
const NOT_HANDLED_BY_CLIENT = new Set([
  // 20260814130000 added sighting_confirmed — "the owner confirmed your
  // sighting" — and its sender, notify-sighting-confirmed, is deployed. Both
  // came from a body of work built outside this repository and since lost; the
  // CLIENT half never arrived. It cannot be handled here yet because there is
  // nowhere to send the tap: the audience is the SPOTTER, and the screen for a
  // spotter's own record is served by my_sighting_record, which has no caller
  // anywhere in src/. /sighting/[sightingId] is owner-only and its RPC would
  // refuse them.
  //
  // Safe only because nothing invokes notify-sighting-confirmed: no client
  // code references it, so no such push is ever sent. If that changes before
  // the spotter's record screen is rebuilt, this becomes a live bug.
  'sighting_confirmed',
]);

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
    // The exception list may not rot: an entry naming a kind the database no
    // longer has is a stale excuse, and would hide a real divergence.
    for (const unhandled of NOT_HANDLED_BY_CLIENT) {
      expect(kinds).toContain(unhandled);
    }

    const expected = kinds.filter((kind) => !NOT_HANDLED_BY_CLIENT.has(kind));
    expect([...expected].sort()).toEqual([...NOTIFICATION_KINDS].sort());
  });
});
