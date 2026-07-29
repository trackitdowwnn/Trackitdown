/**
 * WHAT:  The quick-reply sets — static, role-aware one-tap openers shown
 *        above the composer. Owners get sighting-response lines; spotters
 *        get status updates. Tapping one INSERTS the text into the input,
 *        editable — nothing is ever auto-sent.
 * WHY:   Airbnb's data says reply speed decides outcomes; ours more so — an
 *        owner's first response to a sighting is time-critical, and typing
 *        with shaking hands is exactly when a one-tap opener earns its
 *        place. Static curated sets (no AI, no server): the moment is too
 *        important for a generation delay or a weird suggestion.
 *
 *        // SAFETY: reviewed against the system first message's register
 *        ("report from a distance and never arrange to meet or attempt a
 *        recovery yourselves — recovery is for the owner and police"). No
 *        reply may suggest meeting, following, staying with, watching,
 *        approaching, or intervening — including softly ("keep an eye on
 *        it" is a vigil; "can you stay nearby" is a stakeout). Additions to
 *        these arrays get the same review, not just a copy check.
 * LINKS: src/features/chat/components/QuickReplyRow.tsx (renderer);
 *        supabase/migrations/20260715120000_chat.sql (the system message
 *        whose rules these must never undercut); docs/DESIGN_SYSTEM.md
 *        (Tone of voice).
 */

import type { ChatRole } from '../types';

/**
 * Per-role sets, first-reply-first: the leading entries are the words for the
 * moment the thread opens; the trailing ones stay useful later. Kept short —
 * a row you have to scroll past three screens of is a second keyboard.
 */
const QUICK_REPLIES: Record<ChatRole, readonly string[]> = {
  owner: [
    // Past tense on purpose: "IS it still there?" invites the spotter to go
    // and verify — the soft vigil the SAFETY note above bans (review L1).
    'Thank you — was it still there when you left?',
    'Can you describe exactly where?',
    'That’s my car!',
    'Thank you so much for reporting this.',
  ],
  spotter: [
    'It’s still here',
    'It’s gone now',
    'Happy to help',
  ],
};

/** The set for one side of a thread. */
export function quickRepliesFor(role: ChatRole): readonly string[] {
  return QUICK_REPLIES[role];
}
