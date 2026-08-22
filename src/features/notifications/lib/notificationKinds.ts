/**
 * WHAT:  The closed set of push notification kinds the app can send.
 * WHY:   One list that the payload schema, the tap router, and the database
 *        `push_sends_kind_chk` constraint all derive from. A kind added on
 *        one side only is caught by notificationKinds.test.ts rather than by
 *        a push that arrives and routes nowhere.
 * LINKS: ./pushPayload.ts, ./pushRoute.ts;
 *        supabase/migrations/20260802100000_push_infrastructure.sql;
 *        src/features/notifications/README.md.
 */

/** Mirrored EXACTLY by the migration's `push_sends_kind_chk` whitelist
 *  (LATEST definition — 20260806100000 widened it). */
export const NOTIFICATION_KINDS = [
  'alert',
  'sighting',
  'message',
  'recovery',
  'credited',
  'closed_uncredited',
  'dispute_upheld',
  'dispute_rejected',
  'payout_sent',
  'not_credited',
  'sighting_confirmed',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

// NOTE: `recovery` (a WATCHED post was recovered — audience: watchers) is sent
// by _shared/recoveryAnnounce.ts from every path that finishes a recovery.
// (This note read "still has no sender" until 2026-08-06, long after it had
// one — the sender landed with the release core.)
// `credited` (YOUR sighting was credited — audience: the winning spotter) is
// deliberately its OWN kind so the two never collide: different audience,
// different destination (/payouts, not the post), different copy. Sender:
// notify-credited (2026-08-04).
// The dispute loop (2026-08-05): `closed_uncredited` (a post you sighted
// closed uncredited — you have 72 hours to contest; sender: the exit Edge
// Functions via create_refund_hold), `dispute_upheld` ("you were right —
// you've earned £X"; routes to /payouts like credited, because that is where
// the money gets an address) and `dispute_rejected` (final, calm; routes back
// to the dispute screen, which shows the resolved state). Senders for the
// outcomes: release-held-refunds via claim_dispute_outcome_notification.
// `payout_sent` (2026-08-06): the transfer actually went out — "On its way,
// £X heading to your account". The money moment users care most about,
// previously silent. Sender: the release core via
// claim_payout_sent_notification; routes to /payouts like the money kinds.
// `not_credited` (2026-08-06): a car you reported was recovered on SOMEONE
// ELSE'S sighting — audience: every other spotter on that post. Deliberately
// NOT a variant of closed_uncredited: that one opens a 72-hour dispute window
// because an owner exiting with a refund has a motive to deny everyone, while
// here the owner paid and "someone else deserved it more" is an adjudication
// we do not offer. So it carries news, not a lever, and routes to the POST.
// On a crowd product most spotters lose; until this kind existed, losing was
// indistinguishable from being ignored. Sender: the release core via
// claim_not_credited_notifications.
