/**
 * WHAT:  Asserts the notification kinds are the SAME set in the payload
 *        schema and the tap router.
 * WHY:   A kind added on one side only fails silently in the worst way: the
 *        push arrives and the tap goes nowhere.
 *        The matching assertion against the DATABASE's push_sends_kind_chk
 *        lives in `supabase/tests/notificationKinds.test.ts` instead of here,
 *        because reading a file needs node types and `src/` is compiled with
 *        `types: ["jest","react"]` only — `supabase/tests` is excluded from
 *        tsconfig, which is exactly why migrationChain.test.ts lives there.
 * LINKS: ./notificationKinds.ts, ./pushPayload.ts, ./pushRoute.ts;
 *        supabase/tests/notificationKinds.test.ts (the SQL half).
 */

import { NOTIFICATION_KINDS } from './notificationKinds';
import { pushPayloadSchema } from './pushPayload';
import { pushRouteFor } from './pushRoute';

const POST_ID = '11111111-2222-3333-4444-555555555555';
const THREAD_ID = '66666666-7777-8888-9999-000000000000';
const SIGHTING_ID = '99999999-8888-7777-6666-555555555555';

/** The dispute-loop kinds key off the spotter's SIGHTING — the post is
 *  invisible to them once closed. */
const SIGHTING_KEYED = ['closed_uncredited', 'dispute_upheld', 'dispute_rejected'] as const;
type SightingKeyed = (typeof SIGHTING_KEYED)[number];
const isSightingKeyed = (kind: string): kind is SightingKeyed =>
  (SIGHTING_KEYED as readonly string[]).includes(kind);

describe('notification kinds stay in sync', () => {
  it('the payload schema covers exactly the declared kinds', () => {
    const variants = pushPayloadSchema.options.map((option) => option.shape.type.value as string);
    expect([...variants].sort()).toEqual([...NOTIFICATION_KINDS].sort());
  });

  it('every kind routes somewhere', () => {
    // Building one payload per kind proves the router's switch is exhaustive
    // at RUNTIME, not just to the type checker. The pattern names every legal
    // destination family — `credited` and `dispute_upheld` land on /payouts,
    // where the money gets its address; the dispute-loop taps land on the
    // dispute screen keyed by the spotter's own sighting.
    for (const kind of NOTIFICATION_KINDS) {
      const payload =
        kind === 'message'
          ? ({ type: 'message', threadId: THREAD_ID } as const)
          : isSightingKeyed(kind)
            ? ({ type: kind, sightingId: SIGHTING_ID } as const)
            : ({ type: kind, postId: POST_ID } as const);
      expect(pushRouteFor(payload)).toMatch(/^\/(post\/|chat\/|payouts$|sighting-dispute\?)/);
    }
  });
});
