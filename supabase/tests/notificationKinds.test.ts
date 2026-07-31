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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NOTIFICATION_KINDS } from '../../src/features/notifications/lib/notificationKinds';

const MIGRATION = join(__dirname, '../migrations/20260802100000_push_infrastructure.sql');

describe('push_sends kind constraint', () => {
  it('lists exactly the kinds the client knows about', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const match = sql.match(/push_sends_kind_chk\s+check\s*\(kind in \(([^)]*)\)\)/);
    // If this fails the constraint moved or was reformatted — update the
    // regex rather than deleting the assertion.
    expect(match).not.toBeNull();

    const kinds = (match?.[1] ?? '')
      .split(',')
      .map((value: string) => value.trim().replace(/^'|'$/g, ''));
    expect([...kinds].sort()).toEqual([...NOTIFICATION_KINDS].sort());
  });
});
