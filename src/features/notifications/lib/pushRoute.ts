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
    // A sighting of your own car opens THAT sighting — the page where you
    // answer "is this your car?" (2026-10-08). A payload from before the
    // server sent the id still opens the post, as it always did.
    case 'sighting':
      return payload.sightingId
        ? {
            pathname: '/sighting/[sightingId]',
            params: { sightingId: payload.sightingId, postId: payload.postId },
          }
        : `/post/${payload.postId}`;
    // An alert and a recovery resolve to the post. Different reasons to look,
    // one thing to look at.
    case 'alert':
    case 'recovery':
    // "A car you reported was found" — the runner-up's ending. The car, not
    // the dispute screen: the post WAS credited, so there is nothing to
    // contest, and the thing they actually want to see is that it went home.
    case 'not_credited':
    // "Is your car still missing?" — the post is where the question is
    // ANSWERED: the owner banner carries both buttons, and it is there whether
    // or not this push ever arrived. The push is a reminder that the door
    // exists, never the only way through it (the lesson of the push-only
    // dispute screen).
    case 'still_missing':
    // "Deleted in about 3 days" — the post itself, where "delete it now" is
    // one tap away in Manage post. After the purge lands, the detail screen's
    // own not-found state is the honest answer; routing to My Posts instead
    // would hide WHICH listing this was about while it still exists.
    case 'deletion_soon':
    // "Your reward ends on …" — the listing, whose reward banner shows the
    // date and, in the last 14 days, Renew. "Your reward has ended" — also the
    // listing; PR4's "Reward ended" state is what explains it there, and the
    // expiry (PR5) must not send this kind before that state exists.
    case 'reward_ending':
    case 'reward_ended':
      return `/post/${payload.postId}`;
    case 'message':
      return `/chat/${payload.threadId}`;
    // "You've earned £X" lands where the money gets an address, not on the
    // car: the context of this tap is the payout. /payouts is guest-open like
    // every destination here, so even a signed-out tap never dead-ends.
    case 'credited':
    // "Your £190 reward is waiting — add your bank details by …": the same
    // errand as `credited`, against a deadline (20261007100000).
    case 'payout_reminder':
    // A won dispute is the same earn moment with a different door.
    case 'dispute_upheld':
    // "£X on its way" lands where the money's status lives, not on the car.
    case 'payout_sent':
      return '/payouts';
    // The dispute surface: filing (closed_uncredited) and the resolved answer
    // (rejected) are the same screen in different states — it reads its own
    // truth from my_dispute_context, so both taps land there.
    case 'closed_uncredited':
    case 'dispute_rejected':
      return `/sighting-dispute?sightingId=${payload.sightingId}`;
    // "The owner confirmed your sighting" — the spotter's OWN record, not the
    // post and not the owner-side sighting detail. That screen's RPC is
    // owner-gated and would refuse them outright, so routing there would send
    // someone from good news straight into an error.
    //
    // The record page takes no parameter: it shows everything they have filed,
    // newest first, so the confirmed one is at the top and the tap lands
    // somewhere true even if a second verdict arrived in between.
    case 'sighting_confirmed':
    // ⚠️ NOT /payouts, unlike its sibling `credited`. A credit on a £5 fee
    // listing carries no money, so the payouts screen would show this spotter
    // nothing and imply something is coming. Their record IS the reward here —
    // DOMAIN's "recognition is the reward" — so the tap lands where the credit
    // is actually visible.
    case 'credited_no_reward':
    // "We couldn't send your reward" — the money went back to the owner, but
    // the credit did not: their record is where it still shows, and the
    // payouts screen would now show nothing.
    case 'payout_lapsed':
      return '/my-sightings';
  }
}
