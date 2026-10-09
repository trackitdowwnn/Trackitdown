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
 * LINKS: src/features/sightings/lib/withdrawReasons.ts;
 *        supabase/migrations/20261009150000_a_withdrawal_says_why.sql;
 *        supabase/migrations/20261009180000_a_withdrawal_can_say_more.sql.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  cleanWithdrawNote,
  MAX_WITHDRAW_NOTE_LENGTH,
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
      /create (?:or replace )?function public\.withdraw_sighting\([\s\S]*?\$\$([\s\S]*?)\$\$/,
    );
    if (!body) continue;
    const list = body[1].match(/p_reason not in \(([^)]*)\)/);
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
      /create (?:or replace )?function public\.withdraw_sighting\([\s\S]*?\$\$([\s\S]*?)\$\$/,
    );
    if (body) return body[1];
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

/** The latest claim_sighting_withdrawn_notification body — the push copy. */
function latestClaimBody(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of [...files].reverse()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    const body = sql.match(
      /create (?:or replace )?function public\.claim_sighting_withdrawn_notification\([\s\S]*?\$\$([\s\S]*?)\$\$/,
    );
    if (body) return body[1];
  }
  throw new Error('claim_sighting_withdrawn_notification not found in any migration');
}

describe('the owner’s "Taken back" list', () => {
  it('⚠️ says, for every answer, the sentence the push gave', () => {
    // SQL doubles its apostrophes and uses the straight one; the app sets
    // the typographic one. The WORDS must be the same.
    const push = latestClaimBody().replace(/''/g, "'");
    for (const reason of [...WITHDRAW_REASONS, null]) {
      const sentence = withdrawalSentence(reason).replace(/’/g, "'");
      expect(push).toContain(`'${sentence}'`);
    }
  });
});
