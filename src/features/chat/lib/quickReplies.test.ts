/**
 * WHAT:  Tests for the quick-reply sets — the role split, and the safety
 *        register: no reply may drift toward meeting, following, watching,
 *        or intervening.
 * WHY:   The lexicon test is the point of this file. These strings will be
 *        edited casually one day ("add 'can you wait there?'"), and the
 *        system first message's whole job is that nobody arranges exactly
 *        that. A failing test at edit time beats a code-review catch.
 * LINKS: src/features/chat/lib/quickReplies.ts (the // SAFETY rules);
 *        supabase/migrations/20260715120000_chat.sql (the system message).
 */

import { quickRepliesFor } from './quickReplies';

describe('quickRepliesFor', () => {
  it('owners get sighting-response openers', () => {
    const replies = quickRepliesFor('owner');
    expect(replies.length).toBeGreaterThanOrEqual(3);
    // Past tense pinned: present-tense "is it still there?" invites the
    // spotter to go and check — the soft vigil the safety register bans.
    expect(replies[0]).toBe('Thank you — was it still there when you left?');
  });

  it('spotters get status updates', () => {
    const replies = quickRepliesFor('spotter');
    expect(replies).toContain('It’s still here');
    expect(replies).toContain('It’s gone now');
  });

  it('the two roles never share a set — the words fit the side', () => {
    const owner = new Set(quickRepliesFor('owner'));
    for (const reply of quickRepliesFor('spotter')) {
      expect(owner.has(reply)).toBe(false);
    }
  });

  // SAFETY: the register pin. "Report from a distance and never arrange to
  // meet or attempt a recovery yourselves" — no quick reply may nudge anyone
  // toward presence, pursuit, or intervention, even softly.
  it('no reply ever suggests meeting, following, waiting, watching, or approaching', () => {
    const forbidden = [
      // Presence and pursuit
      /\bmeet\b/i,
      /\bfollow/i,
      /\bwait\b/i,
      /\bstay\b/i,
      /\bwatch\b/i,
      /\bkeep an eye\b/i,
      /\bapproach/i,
      /\bconfront/i,
      /\btrack/i,
      /\bchase/i,
      /\bcircle\b/i,
      /\bblock\b/i,
      /\bguard\b/i,
      /\bhold on\b/i,
      /\bstand by\b/i,
      /\bstick around\b/i,
      /\bhang around\b/i,
      /\bgo back\b/i,
      /\bcheck again\b/i,
      /\bdrive (past|by)\b/i,
      /\bpark\b/i,
      /\bdon.t let\b/i,
      /\bstop (him|her|them|it)\b/i,
      /\bget it back\b/i,
      // Travelling toward the car or each other
      /\bcome (over|down|here)\b/i,
      /\bon my way\b/i,
      /\bheading (over|there|down)\b/i,
      /\bgoing (over|there)\b/i,
      /\bnearby\b/i,
      // Location solicitation — pursuit fuel (security review M3): asking
      // WHERE SOMEONE IS is different from asking where the CAR WAS.
      /\bwhere are you\b/i,
      /\b(send|share|drop) (me )?(your |a )?(live )?location\b/i,
      /\baddress\b/i,
      /\bpostcode\b/i,
      /\bwhat3words\b/i,
    ];
    for (const role of ['owner', 'spotter'] as const) {
      for (const reply of quickRepliesFor(role)) {
        for (const pattern of forbidden) {
          expect(reply).not.toMatch(pattern);
        }
      }
    }
  });
});
