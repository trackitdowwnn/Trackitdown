/**
 * WHAT:  The cross-boundary pin on the badge ladder: asserts the thresholds and
 *        labels in `reputation.ts` are exactly what the SQL uses to decide
 *        which rung a confirmation crossed and to write the words that go in
 *        the push.
 * WHY:   The ladder is written THREE times — once in TypeScript, twice in
 *        migrations — and until this file existed nothing checked that they
 *        agreed. The failure is silent and lands on a user: the push says
 *        'That earned you "5 helpful marks"' while their spotter story shows a
 *        ladder with no such rung on it. Nobody reviewing a TypeScript diff
 *        would think to open a migration from twelve days earlier.
 *
 *        ⚠️ THE LATEST DEFINITION WINS, as in notificationKinds.test.ts: these
 *        functions are re-stated by `create or replace` whenever their bodies
 *        change, so the newest migration mentioning one is the one in force.
 *        Reading only the original would pin a ladder that has been replaced.
 *
 *        Lives in supabase/tests rather than beside reputation.ts because it
 *        reads files with node:fs and tsconfig excludes this directory — the
 *        same reason migrationChain.test.ts and notificationKinds.test.ts are
 *        here.
 * LINKS: src/features/profile/lib/reputation.ts;
 *        supabase/migrations/20260826120000_badge_ladder_on_confirmed_sightings.sql.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  BADGE_LABELS,
  BADGE_THRESHOLDS,
} from '../../src/features/profile/lib/reputation';

const MIGRATIONS_DIR = join(__dirname, '../migrations');

/** Every migration, oldest first — so a later `create or replace` wins. */
function migrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
}

/** The newest body of a function, by name. */
function latestFunction(name: string): string {
  let latest = '';
  for (const sql of migrations()) {
    const start = sql.indexOf(`create or replace function public.${name}`);
    if (start < 0) continue;
    const end = sql.indexOf('\n$$;', start);
    if (end < 0) continue;
    latest = sql.slice(start, end + 4);
  }
  if (!latest) throw new Error(`no definition found for ${name}`);
  return latest;
}

describe('the badge ladder', () => {
  it('⚠️ is the same rungs in mark_sighting_helpful as in reputation.ts', () => {
    // This function decides which rung a single +1 crossed. A ladder here that
    // is longer than the client's would report a rung the app cannot render; a
    // shorter one would silently stop reporting a badge the app shows.
    const body = latestFunction('mark_sighting_helpful');
    const match = body.match(/unnest\(array\[([0-9,\s]+)\]\)/);

    expect(match).not.toBeNull();
    const rungs = match![1].split(',').map((part) => Number(part.trim()));
    expect(rungs).toEqual([...BADGE_THRESHOLDS]);
  });

  it('⚠️ names every rung in the push exactly as the app labels it', () => {
    // The words a spotter reads in a notification and the words on the badge in
    // their story are the same claim. `case v_count when N then 'label'`.
    const body = latestFunction('claim_sighting_confirmed_notification');
    const arms = [...body.matchAll(/when\s+(\d+)\s+then\s+'([^']+)'/g)];

    expect(arms.length).toBe(BADGE_THRESHOLDS.length);

    const fromSql: Record<number, string> = {};
    for (const [, rung, label] of arms) fromSql[Number(rung)] = label;

    expect(fromSql).toEqual(BADGE_LABELS);
  });

  it('⚠️ leaves no trace of the 1/5/25 ladder in either function', () => {
    // Belt and braces on the substitution that produced the migration: the
    // rungs could be right while a stale label survived on a line the parsers
    // above do not read, and "5 helpful marks" in a push is exactly the drift
    // this file exists to prevent.
    const both =
      latestFunction('mark_sighting_helpful') +
      latestFunction('claim_sighting_confirmed_notification');

    expect(both).not.toContain('array[1, 5, 25]');
    expect(both).not.toContain('helpful marks');
  });

  it('does not lower the trusted-spotter rule with the ladder', () => {
    // ⚠️ NOT A LADDER FACT, AND THAT IS WHY IT IS HERE. 20260814120000 priced
    // the cheapest farm against TRUSTED_MIN_HELPFUL = 5. Someone adding a rung
    // at 5 and "tidying" the trusted rule to match would undo the anti-collusion
    // work in a commit that looked cosmetic.
    const source = readFileSync(
      join(__dirname, '../../src/features/profile/lib/reputation.ts'),
      'utf8',
    );

    expect(source).toContain('export const TRUSTED_MIN_HELPFUL = 5;');
  });
});
