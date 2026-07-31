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
      return `/post/${payload.postId}`;
    case 'message':
      return `/chat/${payload.threadId}`;
  }
}
