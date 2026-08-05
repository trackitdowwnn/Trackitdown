/**
 * WHAT:  Maps a push payload to the in-app route its tap should open.
 * WHY:   Tap routing is the whole point of a notification — one pure
 *         function, so "does an alert open the post?" is a unit test rather
 *         than a device experiment. Kept free of router/navigation imports
 *         so it stays testable without a navigator.
 * LINKS: ./pushPayload.ts; src/features/notifications/components/
 *        NotificationsHost.tsx (the only caller); src/app/post/[id].tsx and
 *        src/app/chat/[threadId].tsx (the destinations, both gate-aware).
 */

// TYPE-ONLY import: `Href` is what typedRoutes checks router.push against, and
// types erase at build time — this file still pulls in no navigation runtime,
// so it stays unit-testable without a navigator.
import type { Href } from 'expo-router';

import type { PushPayload } from './pushPayload';

/** The route a tapped push opens. Every destination is a live, gate-aware
 *  route: AuthGate leaves them open to guests, so a deep link never dead-ends
 *  on a login wall (features/auth README — guest-first). */
export function pushRouteFor(payload: PushPayload): Href {
  switch (payload.type) {
    // An alert, a sighting on your own car, and a recovery all resolve to the
    // same place: the post. Different reasons to look, one thing to look at.
    case 'alert':
    case 'sighting':
    case 'recovery':
    // "A car you reported was found" — the runner-up's ending. The car, not
    // the dispute screen: the post WAS credited, so there is nothing to
    // contest, and the thing they actually want to see is that it went home.
    case 'not_credited':
      return `/post/${payload.postId}`;
    case 'message':
      return `/chat/${payload.threadId}`;
    // "You've earned £X" lands where the money gets an address, not on the
    // car: the context of this tap is the payout. /payouts is guest-open like
    // every destination here, so even a signed-out tap never dead-ends.
    case 'credited':
    // A won dispute is the same earn moment with a different door.
    case 'dispute_upheld':
    // "On its way" lands where the money's status lives, not on the car.
    case 'payout_sent':
      return '/payouts';
    // The dispute surface: filing (closed_uncredited) and the resolved answer
    // (rejected) are the same screen in different states — it reads its own
    // truth from my_dispute_context, so both taps land there.
    case 'closed_uncredited':
    case 'dispute_rejected':
      return `/sighting-dispute?sightingId=${payload.sightingId}`;
  }
}
