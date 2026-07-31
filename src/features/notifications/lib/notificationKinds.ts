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

/** Mirrored EXACTLY by the migration's `push_sends_kind_chk` whitelist. */
export const NOTIFICATION_KINDS = ['alert', 'sighting', 'message', 'recovery'] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

// NOTE: `recovery` has no sender yet — no code path anywhere moves a post to
// `recovered` (no migration function, no Edge Function). Its kind, payload
// variant and route ship now so the transition, when it is built, only has to
// call the shared send utility. See README § "watched-post-recovered".
