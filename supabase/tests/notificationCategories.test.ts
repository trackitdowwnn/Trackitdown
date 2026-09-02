/**
 * WHAT:  The cross-boundary guard on push preferences: asserts the client's
 *        CATEGORY_KINDS is exactly the migration's `notification_category(kind)`
 *        map, and that the two unmutable kinds are absent from BOTH.
 * WHY:   The SQL is what actually filters the send; the client map is only what
 *        the Settings screen SAYS a switch silences. Nothing else spans that
 *        boundary, and a mismatch is a switch that lies — either it does
 *        nothing, or it silences something the screen never mentioned.
 *
 *        ⚠️ THE UNMUTABLE HALF IS THE IMPORTANT HALF. `sighting` (someone has
 *        seen your stolen car) and `closed_uncredited` (you have 72 hours to
 *        contest a denial, and the push is the only door to that screen) must
 *        have NO category on either side. If one ever acquires a category, this
 *        fails — which is the only warning anyone would get before shipping a
 *        switch that can silence the product's whole reason to exist.
 *        Lives here rather than beside the source because reading a file needs
 *        node types, and `supabase/tests` is excluded from tsconfig — the same
 *        reason migrationChain.test.ts and notificationKinds.test.ts live here.
 * LINKS: src/features/notifications/lib/notificationPreferences.ts;
 *        supabase/migrations/20260824170000_notification_preferences.sql.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  CATEGORY_KINDS,
  CATEGORY_COPY,
  NOTIFICATION_CATEGORIES,
  UNMUTABLE_KINDS,
} from '../../src/features/notifications/lib/notificationPreferences';
import { NOTIFICATION_KINDS } from '../../src/features/notifications/lib/notificationKinds';

const MIGRATIONS_DIR = join(__dirname, '../migrations');

/** The LATEST definition wins, as in notificationKinds.test.ts: a later
 *  migration may replace the function to add a category. */
function readCategoryFunction(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort();
  let latest = '';
  for (const name of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    const match = sql.match(
      /create or replace function public\.notification_category\([\s\S]*?\$\$;/,
    );
    if (match) latest = match[0];
  }
  if (!latest) throw new Error('notification_category() not found in any migration');
  return latest;
}

/** `when 'alert' then 'alerts'` → { alert: 'alerts' }. */
function parseSqlMap(sql: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, kind, category] of sql.matchAll(/when\s+'([a-z_]+)'\s+then\s+'([a-z_]+)'/g)) {
    out[kind] = category;
  }
  return out;
}

describe('notification_category', () => {
  const sqlMap = parseSqlMap(readCategoryFunction());

  it('maps exactly the kinds the client maps, to the same categories', () => {
    const clientMap: Record<string, string> = {};
    for (const [category, kinds] of Object.entries(CATEGORY_KINDS)) {
      for (const kind of kinds) clientMap[kind] = category;
    }

    expect(sqlMap).toEqual(clientMap);
  });

  it('⚠️ leaves the three consequential kinds with no category at all', () => {
    // Not "maps them to a locked category" — ABSENT, so no column exists to
    // store a mute in and no switch can be built on top of one. A regression
    // here would be someone adding a row to the SQL CASE with the best
    // intentions.
    expect(sqlMap.sighting).toBeUndefined();
    expect(sqlMap.closed_uncredited).toBeUndefined();
    // still_missing (ADR-0019) joined them on 2026-09-02. Its protection is the
    // CAP — three asks per case, ever — rather than a toggle: a mutable version
    // would need a `my_posts` category that does not exist, and a switch a
    // distressed owner never finds is not protection.
    expect(sqlMap.still_missing).toBeUndefined();
    expect(UNMUTABLE_KINDS).toEqual(['sighting', 'closed_uncredited', 'still_missing']);
  });

  it('accounts for every kind the app can send, exactly once', () => {
    // Nothing may be silently unclassified: a kind in neither the map nor the
    // unmutable list is one nobody has decided about, and the decision should
    // be made deliberately rather than defaulted into by omission.
    const mapped = Object.values(CATEGORY_KINDS).flat();
    const all = [...mapped, ...UNMUTABLE_KINDS].sort();

    expect(all).toEqual([...NOTIFICATION_KINDS].sort());
    expect(new Set(all).size).toBe(all.length);
  });

  it('offers a switch, with copy, for every category the server accepts', () => {
    // A category the server would accept but the screen never shows is a
    // preference nobody can reach; copy for one the server rejects is a switch
    // that errors on tap.
    expect(CATEGORY_COPY.map((entry) => entry.category).sort()).toEqual(
      [...NOTIFICATION_CATEGORIES].sort(),
    );
    expect(Object.keys(CATEGORY_KINDS).sort()).toEqual([...NOTIFICATION_CATEGORIES].sort());
  });

  it('matches the categories the write RPC will accept', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql')).sort();
    let whitelist: string[] = [];
    for (const name of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
      const match = sql.match(/if p_category not in \(([^)]*)\)/);
      if (match) {
        whitelist = [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
      }
    }

    expect(whitelist.sort()).toEqual([...NOTIFICATION_CATEGORIES].sort());
  });
});
