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
 *        Since 20261009180000 the "Something else" NOTE too: the app's
 *        length cap, and the hidden characters it strips, must match what
 *        withdraw_sighting refuses — or a spotter's withdrawal fails over a
 *        character they can't see.
 *        Since 20261021100000 the DAMAGE NOTE too: it shares the same strip
 *        (stripHiddenCharacters), and sightings_damage_note_chk and
 *        create_sighting refuse their own copy of the set — so every range
 *        listed there must be one the app strips, or a report fails.
 * LINKS: src/features/sightings/lib/withdrawReasons.ts;
 *        supabase/migrations/20261009150000_a_withdrawal_says_why.sql;
 *        supabase/migrations/20261009180000_a_withdrawal_can_say_more.sql;
 *        supabase/migrations/20261021100000_a_sighting_says_what_damage.sql.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  cleanSpotterWords,
  cleanWithdrawNote,
  MAX_WITHDRAW_NOTE_LENGTH,
  stripHiddenCharacters,
  WITHDRAW_REASONS,
  withdrawalSentence,
} from '../../src/features/sightings/lib/withdrawReasons';

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

/** The values withdraw_sighting's own pre-check accepts, from the latest
 *  migration that (re)creates it — the gate that answers INVALID_INPUT. */
function latestRpcReasons(): string[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of [...files].reverse()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    const body = sql.match(
      /create (?:or replace )?function public\.withdraw_sighting\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\1\$/i,
    );
    if (!body) continue;
    const list = body[2].match(/p_reason not in \(([^)]*)\)/);
    if (!list) throw new Error(`${name}: withdraw_sighting has no p_reason check`);
    return [...list[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  }
  throw new Error('withdraw_sighting with a reason not found in any migration');
}

describe('withdraw reasons', () => {
  it('⚠️ the app offers exactly the answers the table accepts', () => {
    expect([...WITHDRAW_REASONS].sort()).toEqual(latestReasonCheck().sort());
  });

  it('⚠️ …and exactly the answers withdraw_sighting itself accepts', () => {
    // Two lists in SQL (the CHECK and the RPC's pre-check): a migration that
    // widened one but not the other would refuse an answer the app offers.
    expect([...WITHDRAW_REASONS].sort()).toEqual(latestRpcReasons().sort());
  });
});

/** The latest withdraw_sighting body. */
function latestWithdrawBody(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of [...files].reverse()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    const body = sql.match(
      /create (?:or replace )?function public\.withdraw_sighting\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\1\$/i,
    );
    if (body) return body[2];
  }
  throw new Error('withdraw_sighting not found in any migration');
}

describe('the "Something else" note', () => {
  it('⚠️ the app caps it where withdraw_sighting does', () => {
    const cap = latestWithdrawBody().match(/char_length\(v_note\) > (\d+)/);
    expect(cap).not.toBeNull();
    expect(MAX_WITHDRAW_NOTE_LENGTH).toBe(Number(cap![1]));
  });

  it('⚠️ the app strips exactly the characters withdraw_sighting refuses', () => {
    const found = latestWithdrawBody().match(/if v_note ~ '(\[[^']*\])' then/);
    expect(found).not.toBeNull();
    // Postgres writes "x" escapes (two hex digits each, here) where JS
    // wants "u00"; every other escape in the class is spelled the same in
    // both. The backslash is built, not typed, so no escape is mistyped.
    const backslash = String.fromCharCode(92);
    const refused = new RegExp(found![1].split(`${backslash}x`).join(`${backslash}u00`));
    const mismatches: string[] = [];
    for (let cp = 1; cp <= 0xffff; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ch = String.fromCharCode(cp);
      const appStrips = cleanWithdrawNote(`a${ch}b`) === 'ab';
      if (refused.test(ch) !== appStrips) mismatches.push(cp.toString(16));
    }
    expect(mismatches).toEqual([]);
  });
});

/** The hidden-character class in the LATEST migration that adds
 *  sightings_damage_note_chk (20261021100000 today), as written in SQL. */
function latestDamageNoteCheckClass(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of [...files].reverse()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    const found = sql.match(
      /add constraint sightings_damage_note_chk[\s\S]*?damage_note !~ '(\[[^']*\])'/,
    );
    if (found) return found[1];
  }
  throw new Error('sightings_damage_note_chk not found in any migration');
}

/** The class create_sighting refuses the damage note for, from its latest body. */
function latestCreateSightingDamageClass(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of [...files].reverse()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    const body = sql.match(
      /create (?:or replace )?function public\.create_sighting\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\1\$/i,
    );
    if (!body) continue;
    const found = body[2].match(/if v_damage_note ~ '(\[[^']*\])' then/);
    if (!found) throw new Error(`${name}: create_sighting has no damage-note character check`);
    return found[1];
  }
  throw new Error('create_sighting not found in any migration');
}

// The SQL class is written in escapes only — two hex digits after an "x",
// four after a "u", ranges joined by "-". The backslash is built, not typed,
// so no escape in this file can be mistyped into a raw character.
const BACKSLASH = String.fromCharCode(92);
const SQL_ESCAPE = `${BACKSLASH}${BACKSLASH}(?:x([0-9A-Fa-f]{2})|u([0-9A-Fa-f]{4}))`;
const SQL_CLASS_ITEM = new RegExp(`${SQL_ESCAPE}(?:-${SQL_ESCAPE})?`, 'g');

/** Each range (or single character, from === to) the SQL class lists. */
function sqlClassRanges(sqlClass: string): { from: number; to: number }[] {
  const inner = sqlClass.slice(1, -1);
  const items = [...inner.matchAll(SQL_CLASS_ITEM)];
  // Every character of the class was parsed: nothing skipped, nothing guessed.
  expect(items.map((item) => item[0]).join('')).toBe(inner);
  return items.map((item) => {
    const from = parseInt(item[1] ?? item[2], 16);
    const end = item[3] ?? item[4];
    return { from, to: end === undefined ? from : parseInt(end, 16) };
  });
}

/** The hidden-character class in the LATEST migration that adds
 *  sightings_missing_parts_note_chk (20261021120000 today), as written in SQL. */
function latestMissingPartsNoteCheckClass(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of [...files].reverse()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    const found = sql.match(
      /add constraint sightings_missing_parts_note_chk[\s\S]*?missing_parts_note !~ '(\[[^']*\])'/,
    );
    if (found) return found[1];
  }
  throw new Error('sightings_missing_parts_note_chk not found in any migration');
}

/** The class create_sighting refuses the missing-parts note for, from its
 *  latest body. */
function latestCreateSightingMissingPartsClass(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of [...files].reverse()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    const body = sql.match(
      /create (?:or replace )?function public\.create_sighting\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\1\$/i,
    );
    if (!body) continue;
    const found = body[2].match(/if v_missing_parts_note ~ '(\[[^']*\])' then/);
    if (!found) {
      throw new Error(`${name}: create_sighting has no missing-parts note character check`);
    }
    return found[1];
  }
  throw new Error('create_sighting not found in any migration');
}

describe('the missing-parts note (20261021120000)', () => {
  // The app strips one set for both notes (stripHiddenCharacters), so the
  // server must refuse ONE set for both: then the damage-note range test
  // below covers this note too.
  it('⚠️ its CHECK refuses exactly the damage note’s set', () => {
    expect(latestMissingPartsNoteCheckClass()).toBe(latestDamageNoteCheckClass());
  });

  it('⚠️ create_sighting refuses the same set its CHECK does', () => {
    expect(latestCreateSightingMissingPartsClass()).toBe(latestMissingPartsNoteCheckClass());
  });
});

describe('the damage note (20261021100000)', () => {
  it('⚠️ the app strips a character from EVERY range the damage-note CHECK refuses', () => {
    const ranges = sqlClassRanges(latestDamageNoteCheckClass());
    // The class lists more than one range: a parse that found nothing would
    // pass the loop below vacuously.
    expect(ranges.length).toBeGreaterThan(10);
    const kept: string[] = [];
    for (const { from, to } of ranges) {
      expect(from).toBeLessThanOrEqual(to);
      // Both ends and the middle of each range.
      for (const cp of new Set([from, Math.floor((from + to) / 2), to])) {
        const ch = String.fromCharCode(cp);
        if (stripHiddenCharacters(`a${ch}b`) !== 'ab') kept.push(cp.toString(16));
      }
    }
    expect(kept).toEqual([]);
  });

  it('⚠️ create_sighting refuses the same set the CHECK does', () => {
    // Two copies in SQL: a migration that widened one but not the other would
    // refuse, at the RPC or the table, a note the app thinks is clean.
    expect(latestCreateSightingDamageClass()).toBe(latestDamageNoteCheckClass());
  });

  it('keeps ordinary words, spaces and emoji without joiners', () => {
    const fire = String.fromCodePoint(0x1f525);
    const dash = String.fromCharCode(0x2014);
    const noBreakSpace = String.fromCharCode(0xa0);
    const words = `Mirror hanging off ${dash} driver's side,${noBreakSpace}glass ${fire}${fire}`;
    expect(stripHiddenCharacters(words)).toBe(words);
    expect(stripHiddenCharacters('  two  spaces\tand a tab\nand a line  ')).toBe(
      '  two  spaces\tand a tab\nand a line  ',
    );
    expect(cleanSpotterWords(`  Bent wheel ${fire} `)).toBe(`Bent wheel ${fire}`);
  });
});

/** The latest claim_sighting_withdrawn_notification body — the push copy. */
function latestClaimBody(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of [...files].reverse()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    const body = sql.match(
      /create (?:or replace )?function public\.claim_sighting_withdrawn_notification\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\1\$/i,
    );
    if (body) return body[2];
  }
  throw new Error('claim_sighting_withdrawn_notification not found in any migration');
}

describe('the owner’s "Taken back" list', () => {
  it('⚠️ says, for every answer, the sentence the push gave', () => {
    // SQL doubles its apostrophes and uses the straight one; the app sets
    // the typographic one. The WORDS must be the same. (With a note the
    // push says "…withdrew it and left you a note."; the list says "The
    // spotter withdrew it." and shows the note itself beneath — so it is
    // that plain sentence this holds to the SQL.)
    const push = latestClaimBody().replace(/''/g, "'");
    for (const reason of [...WITHDRAW_REASONS, null]) {
      const sentence = withdrawalSentence(reason).replace(/’/g, "'");
      expect(push).toContain(`'${sentence}'`);
    }
  });
});
