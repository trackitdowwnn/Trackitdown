/**
 * WHAT:  The `?from=` value the home feed stamps on a post route, and the test
 *        for it. That value is what tells the alert-area offer a post view was
 *        BROWSING rather than someone managing their own theft.
 * WHY:   A constant instead of the literal `'feed'` written at both ends: a
 *        typo in either file would silently stop the offer ever being made,
 *        with nothing failing and no error to notice.
 *
 *        ⚠️ ITS OWN FILE, deliberately. It belongs beside
 *        useCountPostViewForAlertNudge, but that module reaches
 *        alertNudgeStorage → AsyncStorage, and HomeFeedScreen imports this. Put
 *        together, the feed's test suite fails to even load ("NativeModule:
 *        AsyncStorage is null"). Same reason useMyAlerts imports useSession by
 *        path rather than through the auth barrel — see that file's note.
 * LINKS: ../hooks/useCountPostViewForAlertNudge.ts (the consumer that counts);
 *        src/features/search-map/screens/HomeFeedScreen.tsx (the only stamper);
 *        src/app/post/[id].tsx (the reader).
 */

/** The one `?from=` value that counts as browsing. */
export const BROWSING_SOURCE = 'feed';

/**
 * Does a post route's `?from=` value represent browsing?
 *
 * Anything else — My Posts, a chat, a watchlist collection, the map, a push —
 * is not, and must not feed the alert-area offer. The map is arguably browsing
 * too; leaving it out is a deliberate product call, not an oversight.
 */
export function isBrowsingSource(from: string | undefined): boolean {
  return from === BROWSING_SOURCE;
}
