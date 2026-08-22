/**
 * WHAT:  Static migration-chain integrity test: every `drop function` in a
 *        migration must target a signature some EARLIER migration created, and
 *        a plain `create function` (no OR REPLACE) must not collide with a
 *        signature that is still live at that point in the chain.
 * WHY:   Regression guard for the 2026-07-29 report-sighting outage: the
 *        context-fields migration was stamped BEFORE the timeline migration
 *        whose create_sighting signature it dropped, so `db push` failed at
 *        that file and silently blocked every later migration — the app then
 *        called an RPC signature the database didn't have (PGRST202) and every
 *        sighting submit died with the generic retry copy. This test replays
 *        the chain in filename order WITHOUT a database, so a dependency-
 *        inverted timestamp fails CI/jest the moment the file lands.
 * NOTE:  The signature parser is deliberately simple: it handles the types
 *        this repo uses (uuid, jsonb, text, text[], int, ...). Parenthesised
 *        types like numeric(10,2) in a FUNCTION PARAMETER LIST would need a
 *        smarter matcher — extend it if one ever appears.
 * LINKS: supabase/migrations/20260801140000_sighting_context_fields.sql
 *        (the re-stamped migration whose original ordering caused this).
 */

import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

/**
 * Drops whose CREATING migration was deliberately deleted from this repo, so
 * the chain legitimately cannot show a matching create.
 *
 * Each MUST be a `drop ... if exists`, which is what makes it a no-op rather
 * than the failure this test exists to catch. Keep this list tiny: every entry
 * is a hole in the guard, and the guard is what stopped a whole `db push`
 * dying mid-chain on 2026-07-29.
 */
const ORPHANED_DROPS = new Set([
  // 20260811120000 created get_post_insights_context and was deleted when the
  // per-listing Insights page was withdrawn. 20260811130000 exists precisely
  // BECAUSE deleting a migration does not undo it on a database that ran it —
  // see that file's own header.
  'get_post_insights_context(uuid)',
]);

/** "p_post_id uuid, p_photos jsonb default null" -> "uuid, jsonb" */
/**
 * Postgres spells several types more than one way and the catalogue does not
 * care which was written — so neither may this. Uncanonicalised,
 * 20260813130000 dropping "timestamp with time zone" reads as a different
 * signature from 20260813120000 creating "timestamptz", and a sound chain
 * reports as broken. Same for int/integer, which this repo mixes inside one
 * function.
 */
const TYPE_ALIASES: Record<string, string> = {
  'timestamp with time zone': 'timestamptz',
  'timestamp without time zone': 'timestamp',
  'time with time zone': 'timetz',
  'double precision': 'float8',
  int: 'integer',
  int4: 'integer',
  int8: 'bigint',
  bool: 'boolean',
};

function canonType(raw: string): string {
  const type = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  return TYPE_ALIASES[type] ?? type;
}

/** "uuid, timestamp with time zone" -> "uuid, timestamptz". A DROP may list
 *  types alone rather than name+type, and this repo writes both forms. */
function typesOnly(paramList: string): string {
  const trimmed = paramList.trim();
  if (trimmed === '') return '';
  return trimmed.split(',').map(canonType).join(', ');
}

function toTypeList(paramList: string): string {
  const trimmed = paramList.trim();
  if (trimmed === '') return '';
  return trimmed
    .split(',')
    .map((param) => {
      const words = param.trim().split(/\s+/);
      // First word is the parameter name; type runs until `default`.
      const stop = words.findIndex((word) => word.toLowerCase() === 'default');
      return canonType(words.slice(1, stop === -1 ? undefined : stop).join(' '));
    })
    .join(', ');
}

interface FunctionEvent {
  file: string;
  kind: 'create' | 'createOrReplace' | 'drop';
  signature: string;
  /** DROPs only: the same parameter list read the other way (see below). */
  alternate?: string;
}

function readChainEvents(): FunctionEvent[] {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort(); // timestamp prefix => filename order IS apply order

  const events: FunctionEvent[] = [];
  for (const file of files) {
    // Line comments stripped first: `-- [{path, lat, ...}]` inside a parameter
    // list would otherwise corrupt the parsed signature.
    const sql = fs
      .readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
      .replace(/--[^\n]*/g, '');

    const dropPattern = /drop\s+function\s+(?:if\s+exists\s+)?public\.([a-z0-9_]+)\s*\(([^)]*)\)/gi;
    for (const match of sql.matchAll(dropPattern)) {
      events.push({
        file,
        kind: 'drop',
        signature: `${match[1].toLowerCase()}(${typesOnly(match[2])})`,
        // The SAME drop may be written `f(uuid, text)` or `f(p_id uuid, p_x
        // text)`, and this repo writes both. Recording both readings and
        // accepting either is what stops a NAMED drop — 20260813130000’s of
        // update_post — looking like a signature nothing ever created.
        alternate: `${match[1].toLowerCase()}(${toTypeList(match[2])})`,
      });
    }

    const createPattern =
      /create\s+(or\s+replace\s+)?function\s+public\.([a-z0-9_]+)\s*\(([^)]*)\)/gi;
    for (const match of sql.matchAll(createPattern)) {
      events.push({
        file,
        kind: match[1] ? 'createOrReplace' : 'create',
        signature: `${match[2].toLowerCase()}(${toTypeList(match[3])})`,
      });
    }
  }
  return events;
}

describe('migration chain (filename order = apply order)', () => {
  it('never drops a function signature no earlier migration created', () => {
    const live = new Set<string>();
    const problems: string[] = [];

    for (const event of readChainEvents()) {
      if (event.kind === 'drop') {
        // Either reading of the parameter list may be the one that matches.
        const matched = [event.signature, event.alternate].find(
          (candidate) => candidate !== undefined && live.has(candidate),
        );
        if (matched === undefined && !ORPHANED_DROPS.has(event.signature)) {
          problems.push(
            `${event.file} drops ${event.signature} but no earlier migration created it — ` +
              'db push would fail here and block every later migration ' +
              '(the 2026-07-29 report-sighting outage). Is the timestamp ordered after its dependency?',
          );
        }
        if (matched !== undefined) live.delete(matched);
      } else {
        if (event.kind === 'create' && live.has(event.signature)) {
          problems.push(
            `${event.file} plainly creates ${event.signature} which is still live at this point — ` +
              'use CREATE OR REPLACE or drop the old signature first.',
          );
        }
        live.add(event.signature);
      }
    }

    expect(problems).toEqual([]);
  });
});
