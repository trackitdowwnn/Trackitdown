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

/** YOUR sighting was credited — the earn moment. The amount lives in the
 *  visible title, never in this payload; the tap opens /payouts, where
 *  "where do we send it" gets answered. */
const creditedPayloadSchema = z
  .object({ type: z.literal('credited'), postId: z.guid() })
  .strict();

/** Credited on a listing that carries NO cash reward (ADR-0014's £5 fee mode).
 *  Its own kind rather than a flag on `credited`, because the two land on
 *  different screens: there is no payout to arrange, so the tap opens
 *  /my-sightings where the credit is actually visible. Same postId shape as its
 *  sibling — there is no amount to carry, and inventing one is the mistake the
 *  server-side branch exists to avoid. */
const creditedNoRewardPayloadSchema = z
  .object({ type: z.literal('credited_no_reward'), postId: z.guid() })
  .strict();

/** A post you sighted closed without crediting anyone — the 72-hour window to
 *  contest is open. The sighting id, not the post id: the post is invisible
 *  to the spotter once closed, and the dispute screen keys off THEIR sighting. */
const closedUncreditedPayloadSchema = z
  .object({ type: z.literal('closed_uncredited'), sightingId: z.guid() })
  .strict();

/** Your dispute won — "you've earned £X" (amount in the visible title only). */
const disputeUpheldPayloadSchema = z
  .object({ type: z.literal('dispute_upheld'), sightingId: z.guid() })
  .strict();

/** Your dispute was reviewed and didn't stand. Final; no reasons in a push. */
const disputeRejectedPayloadSchema = z
  .object({ type: z.literal('dispute_rejected'), sightingId: z.guid() })
  .strict();

/** Your bounty transfer actually went out. Amount lives in the visible title
 *  only — never in this payload. */
const payoutSentPayloadSchema = z
  .object({ type: z.literal('payout_sent'), postId: z.guid() })
  .strict();

/** A car you reported was recovered on someone else's sighting. The POST id,
 *  not a sighting id: there is no dispute to file here (see notificationKinds),
 *  so the tap goes to the car itself. Nothing about the winner travels — the
 *  visible copy says "another spotter" and this payload says even less. */
const notCreditedPayloadSchema = z
  .object({ type: z.literal('not_credited'), postId: z.guid() })
  .strict();

/** The owner confirmed a sighting YOU filed. The SIGHTING id, and only that:
 *  the audience is the spotter, whose destination is their own record — they
 *  cannot open the owner-side sighting detail and its RPC would refuse them.
 *  A postId here would hand them a listing they were never shown. */
const sightingConfirmedPayloadSchema = z
  .object({ type: z.literal('sighting_confirmed'), sightingId: z.guid() })
  .strict();

/** "Is your {car} still missing?" — the ADR-0019 liveness check. The POST id:
 *  the audience is the owner, the destination is their own listing, and the
 *  banner with both answers is already on it. Carries no ask_count and no
 *  deadline, because there is no deadline — nothing expires, nothing refunds,
 *  and a number here would imply a consequence the system does not have. */
const stillMissingPayloadSchema = z
  .object({ type: z.literal('still_missing'), postId: z.guid() })
  .strict();

export const pushPayloadSchema = z.discriminatedUnion('type', [
  alertPayloadSchema,
  sightingPayloadSchema,
  sightingConfirmedPayloadSchema,
  messagePayloadSchema,
  recoveryPayloadSchema,
  creditedPayloadSchema,
  creditedNoRewardPayloadSchema,
  closedUncreditedPayloadSchema,
  disputeUpheldPayloadSchema,
  disputeRejectedPayloadSchema,
  payoutSentPayloadSchema,
  notCreditedPayloadSchema,
  stillMissingPayloadSchema,
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
