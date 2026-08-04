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
 *  (LATEST definition — 20260804100000 widened it). */
export const NOTIFICATION_KINDS = [
  'alert',
  'sighting',
  'message',
  'recovery',
  'credited',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

// NOTE: `recovery` (a WATCHED post was recovered — audience: watchers) still
// has no sender; its kind, payload variant and route ship so the sender, when
// built, only has to call the shared send utility.
// `credited` (YOUR sighting was credited — audience: the winning spotter) is
// deliberately its OWN kind so the two never collide: different audience,
// different destination (/payouts, not the post), different copy. Sender:
// notify-credited (2026-08-04).
