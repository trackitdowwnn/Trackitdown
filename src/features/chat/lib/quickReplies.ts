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

/**
 * Whether to offer the row at all.
 *
 * ⚠️ ONLY UNTIL YOU HAVE SPOKEN. It used to show whenever the draft was empty
 * — and an empty draft IS the resting state, so 52pt of the screen was
 * permanently spent on four canned phrases, on a screen that was measured at
 * 46% chrome. This file's own charter names the moment they are for:
 * "first-reply-first: the leading entries are the words for the moment the
 * thread opens". Once you have spoken, you have found your words, and the
 * argument for the row stops applying to you.
 *
 * The cost is paid exactly once per thread, at the moment it is most useful —
 * an owner's first reply to a sighting, which is the time-critical one.
 *
 * ⚠️ `kind === 'user'` IS LOAD-BEARING. The server puts a system safety message
 * at the top of every thread with `senderId: null`; without the kind check a
 * null senderId could never match, but a future system message attributed to
 * anyone would silently count as "I have spoken" and hide the row forever.
 * messageGroups.latestSeenOutboundId makes the same check for the same reason.
 *
 * ⚠️ `outgoing` COUNTS, and leaving it out was a bug for a few hours. A sent
 * message lands in `outgoing` immediately and only reaches `messages` when the
 * RPC confirms, so reading `messages` alone meant: draft clears → row fades
 * back in → confirmation arrives → row fades out again. Exactly the composer
 * jump the LinearTransition was added to prevent, on every single send. Worse,
 * a FAILED send never reaches `messages` at all, so the row came back for good
 * while the failed bubble sat above it.
 *
 * ⚠️ It only sees the LOADED page. In a long thread paginated back from the
 * newest messages, someone whose only contribution is older than the window is
 * offered the row again. Cosmetic, and not worth a round trip to close.
 */
export function shouldShowQuickReplies({
  draft,
  messages,
  outgoing,
  myId,
}: {
  draft: string;
  messages: readonly { kind: string; senderId: string | null }[];
  outgoing: readonly unknown[];
  myId: string;
}): boolean {
  if (draft.trim().length > 0) return false;
  if (outgoing.length > 0) return false;
  return !messages.some((m) => m.kind === 'user' && m.senderId === myId);
}
