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

/** "p_post_id uuid, p_photos jsonb default null" -> "uuid, jsonb" */
function toTypeList(paramList: string): string {
  const trimmed = paramList.trim();
  if (trimmed === '') return '';
  return trimmed
    .split(',')
    .map((param) => {
      const words = param.trim().split(/\s+/);
      // First word is the parameter name; type runs until `default`.
      const stop = words.findIndex((word) => word.toLowerCase() === 'default');
      return words.slice(1, stop === -1 ? undefined : stop).join(' ').toLowerCase();
    })
    .join(', ');
}

interface FunctionEvent {
  file: string;
  kind: 'create' | 'createOrReplace' | 'drop';
  signature: string;
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
        signature: `${match[1].toLowerCase()}(${match[2].replace(/\s+/g, ' ').trim().toLowerCase()})`,
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
        if (!live.has(event.signature)) {
          problems.push(
            `${event.file} drops ${event.signature} but no earlier migration created it — ` +
              'db push would fail here and block every later migration ' +
              '(the 2026-07-29 report-sighting outage). Is the timestamp ordered after its dependency?',
          );
        }
        live.delete(event.signature);
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
