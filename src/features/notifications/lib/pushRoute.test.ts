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
const SIGHTING_ID = '99999999-8888-7777-6666-555555555555';

describe('pushRouteFor', () => {
  it('routes an alert to the post detail', () => {
    expect(pushRouteFor({ type: 'alert', postId: POST_ID })).toBe(`/post/${POST_ID}`);
  });

  // 2026-10-08: a sighting opens THAT sighting — where the owner answers
  // "is this your car?" — once the server sends its id.
  it('routes a sighting to the sighting itself when its id is sent', () => {
    expect(pushRouteFor({ type: 'sighting', postId: POST_ID, sightingId: SIGHTING_ID })).toEqual({
      pathname: '/sighting/[sightingId]',
      params: { sightingId: SIGHTING_ID, postId: POST_ID },
    });
  });

  it('routes a sighting without its id (an older push) to the post detail', () => {
    expect(pushRouteFor({ type: 'sighting', postId: POST_ID })).toBe(`/post/${POST_ID}`);
  });

  it('routes a recovery to the post detail', () => {
    expect(pushRouteFor({ type: 'recovery', postId: POST_ID })).toBe(`/post/${POST_ID}`);
  });

  it('routes the reward-term pushes to the owner’s listing, where Renew is', () => {
    expect(pushRouteFor({ type: 'reward_ending', postId: POST_ID })).toBe(`/post/${POST_ID}`);
    expect(pushRouteFor({ type: 'reward_ended', postId: POST_ID })).toBe(`/post/${POST_ID}`);
  });

  // The payout deadline (2026-10-07): the reminder is the payouts errand; the
  // lapse lands on the spotter's own record, where the credit still shows.
  it('routes the payout-deadline pushes to the errand, then to the record', () => {
    expect(pushRouteFor({ type: 'payout_reminder' })).toBe('/payouts');
    expect(pushRouteFor({ type: 'payout_lapsed', sightingId: SIGHTING_ID })).toBe('/my-sightings');
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
});

// The parse-then-route path lives in NotificationsHost (parsePushPayload +
// pushRouteFor), and the refusal cases are asserted where the refusing happens:
// pushPayload.test.ts for the schema, NotificationsHost.test.tsx for what the
// app does with an unroutable push.
