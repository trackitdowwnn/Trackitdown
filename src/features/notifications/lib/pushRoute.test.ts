/**
 * WHAT:  Tests that every push kind opens the right screen.
 * WHY:   Tap routing is the notification's whole job, and the failure mode is
 *        silent — a push that opens the app to nowhere looks like the user
 *        mis-tapped. Testing the pure mapping means the device only has to
 *        prove the plumbing, not the destinations.
 * LINKS: ./pushRoute.ts, ./pushPayload.ts; docs/TESTING.md.
 */

import { pushRouteFor } from './pushRoute';

const POST_ID = '11111111-2222-3333-4444-555555555555';
const THREAD_ID = '66666666-7777-8888-9999-000000000000';

describe('pushRouteFor', () => {
  it('routes an alert to the post detail', () => {
    expect(pushRouteFor({ type: 'alert', postId: POST_ID })).toBe(`/post/${POST_ID}`);
  });

  it('routes a sighting to the post detail', () => {
    expect(pushRouteFor({ type: 'sighting', postId: POST_ID })).toBe(`/post/${POST_ID}`);
  });

  it('routes a recovery to the post detail', () => {
    expect(pushRouteFor({ type: 'recovery', postId: POST_ID })).toBe(`/post/${POST_ID}`);
  });

  it('routes a message to its chat thread', () => {
    expect(pushRouteFor({ type: 'message', threadId: THREAD_ID })).toBe(`/chat/${THREAD_ID}`);
  });

  it('routes "you’ve earned" to payouts, not to the car', () => {
    // The context of this tap is the money getting an address. The post id
    // still travels (analytics, future deep-link needs) but the destination is
    // where the answer gets given.
    expect(pushRouteFor({ type: 'credited', postId: POST_ID })).toBe('/payouts');
  });

  // The OWNER's money news (ADR-0021) lands on the listing, where the money
  // card says the same thing with its date — not on /payouts, which is the
  // spotter's side and would show an owner nothing.
  it('routes "£X refunded" to the owner’s listing', () => {
    expect(pushRouteFor({ type: 'refund_sent', postId: POST_ID })).toBe(`/post/${POST_ID}`);
  });

  it('routes "£X sent to your spotter" to the owner’s listing', () => {
    expect(pushRouteFor({ type: 'reward_delivered', postId: POST_ID })).toBe(`/post/${POST_ID}`);
  });
});

// The parse-then-route path lives in NotificationsHost (parsePushPayload +
// pushRouteFor), and the refusal cases are asserted where the refusing happens:
// pushPayload.test.ts for the schema, NotificationsHost.test.tsx for what the
// app does with an unroutable push.
