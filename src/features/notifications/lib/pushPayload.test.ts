/**
 * WHAT:  Tests for the push payload fence — what it accepts, and (mostly)
 *        what it refuses.
 * WHY:   SAFETY. A push payload leaves our infrastructure, so the interesting
 *        assertions here are ABSENCE ones: a plate, a coordinate, or message
 *        content must make the parse FAIL rather than travel. These are the
 *        Tier 1 tests for docs/SECURITY_AND_TRUST.md §3.
 * LINKS: ./pushPayload.ts; docs/TESTING.md.
 */

import { parsePushPayload, pushPayloadSchema } from './pushPayload';

const POST_ID = '11111111-2222-3333-4444-555555555555';
const THREAD_ID = '66666666-7777-8888-9999-000000000000';

describe('parsePushPayload', () => {
  it('accepts each of the four notification kinds', () => {
    expect(parsePushPayload({ type: 'alert', postId: POST_ID })).toEqual({
      type: 'alert',
      postId: POST_ID,
    });
    expect(parsePushPayload({ type: 'sighting', postId: POST_ID })?.type).toBe('sighting');
    expect(parsePushPayload({ type: 'recovery', postId: POST_ID })?.type).toBe('recovery');
    expect(parsePushPayload({ type: 'message', threadId: THREAD_ID })).toEqual({
      type: 'message',
      threadId: THREAD_ID,
    });
  });

  it('returns null for an unknown notification type', () => {
    expect(parsePushPayload({ type: 'bounty_paid', postId: POST_ID })).toBeNull();
  });

  it('returns null rather than throwing on junk', () => {
    expect(parsePushPayload(undefined)).toBeNull();
    expect(parsePushPayload(null)).toBeNull();
    expect(parsePushPayload('alert')).toBeNull();
    expect(parsePushPayload({})).toBeNull();
  });

  it('returns null when the id is not a uuid', () => {
    expect(parsePushPayload({ type: 'alert', postId: 'not-a-uuid' })).toBeNull();
  });

  // --- SAFETY: the absence assertions. Each of these is a real field that
  // exists elsewhere in the app and must never ride along on a push.
  it('rejects a payload carrying a plate', () => {
    expect(parsePushPayload({ type: 'alert', postId: POST_ID, plate: 'AB12CDE' })).toBeNull();
  });

  it('rejects a payload carrying coordinates', () => {
    expect(
      parsePushPayload({ type: 'alert', postId: POST_ID, lat: 51.5074, lng: -0.1278 }),
    ).toBeNull();
  });

  it('rejects a payload carrying message content', () => {
    expect(
      parsePushPayload({ type: 'message', threadId: THREAD_ID, content: 'is it still there?' }),
    ).toBeNull();
  });

  it('rejects a message payload carrying the sender id', () => {
    expect(
      parsePushPayload({ type: 'message', threadId: THREAD_ID, senderId: POST_ID }),
    ).toBeNull();
  });

  // The owner's two money pushes (ADR-0021). The amount lives in the visible
  // title only; the payload is the post id and nothing else.
  it('accepts the owner’s money pushes carrying only the post id', () => {
    expect(parsePushPayload({ type: 'refund_sent', postId: POST_ID })).toEqual({
      type: 'refund_sent',
      postId: POST_ID,
    });
    expect(parsePushPayload({ type: 'reward_delivered', postId: POST_ID })).toEqual({
      type: 'reward_delivered',
      postId: POST_ID,
    });
  });

  it('rejects an owner money push carrying an amount', () => {
    expect(
      parsePushPayload({ type: 'refund_sent', postId: POST_ID, amountPence: 52500 }),
    ).toBeNull();
    expect(
      parsePushPayload({ type: 'reward_delivered', postId: POST_ID, amountPence: 50000 }),
    ).toBeNull();
  });

  it('rejects a reward_delivered push carrying anything about the spotter', () => {
    expect(
      parsePushPayload({ type: 'reward_delivered', postId: POST_ID, spotterId: THREAD_ID }),
    ).toBeNull();
    expect(
      parsePushPayload({ type: 'reward_delivered', postId: POST_ID, sightingId: THREAD_ID }),
    ).toBeNull();
  });

  it('rejects an owner money push without a uuid post id', () => {
    expect(parsePushPayload({ type: 'refund_sent' })).toBeNull();
    expect(parsePushPayload({ type: 'refund_sent', postId: 'not-a-uuid' })).toBeNull();
    expect(parsePushPayload({ type: 'reward_delivered', sightingId: POST_ID })).toBeNull();
  });

  it('has no payload variant that permits an unknown key', () => {
    // Belt to the braces above: every option is strict, so this holds for
    // variants added later without anyone remembering to test them.
    for (const type of ['alert', 'sighting', 'recovery'] as const) {
      expect(pushPayloadSchema.safeParse({ type, postId: POST_ID, extra: 1 }).success).toBe(false);
    }
    expect(
      pushPayloadSchema.safeParse({ type: 'message', threadId: THREAD_ID, extra: 1 }).success,
    ).toBe(false);
  });
});
