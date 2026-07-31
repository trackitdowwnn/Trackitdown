/**
 * WHAT:  The typed data payload every push carries, and the parser that
 *        turns an untrusted notification body into it.
 * WHY:   A push travels through third-party infrastructure (Expo, then FCM /
 *        APNs), so its payload is the one part of the app whose contents are
 *        readable by parties outside it. This schema is the fence.
 *        SAFETY: `.strict()` is load-bearing — it makes "a plate, a
 *        coordinate, or a message body appeared in a push" a PARSE FAILURE
 *        rather than a silent leak, and pushPayload.test.ts asserts exactly
 *        that. Ids only: the client re-fetches everything else through RLS.
 * LINKS: ./notificationKinds.ts, ./pushRoute.ts;
 *        supabase/functions/_shared/push.ts (the sender side);
 *        docs/SECURITY_AND_TRUST.md §3.
 */

import { z } from 'zod';

/** A car went missing inside the spotter's alert zone. */
const alertPayloadSchema = z
  .object({ type: z.literal('alert'), postId: z.guid() })
  .strict();

/** Someone reported a sighting of the owner's car. */
const sightingPayloadSchema = z
  .object({ type: z.literal('sighting'), postId: z.guid() })
  .strict();

/** A new chat message. NOTE the absence of any content field — message text
 *  never transits push (ROADMAP contract / SECURITY_AND_TRUST §3). The
 *  sender's first name lives in the visible title, not in this payload. */
const messagePayloadSchema = z
  .object({ type: z.literal('message'), threadId: z.guid() })
  .strict();

/** A watched post was recovered. No sender yet — see notificationKinds.ts. */
const recoveryPayloadSchema = z
  .object({ type: z.literal('recovery'), postId: z.guid() })
  .strict();

export const pushPayloadSchema = z.discriminatedUnion('type', [
  alertPayloadSchema,
  sightingPayloadSchema,
  messagePayloadSchema,
  recoveryPayloadSchema,
]);

export type PushPayload = z.infer<typeof pushPayloadSchema>;

/**
 * Parse an untrusted `notification.request.content.data` blob.
 * Returns null on anything unrecognised — a malformed or unexpected payload
 * must never throw inside a notification listener, or the tap is lost.
 */
export function parsePushPayload(data: unknown): PushPayload | null {
  const parsed = pushPayloadSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
