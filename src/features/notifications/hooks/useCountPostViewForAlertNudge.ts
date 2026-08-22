/**
 * WHAT:  Counts a finished post view and, on the third, raises the alert-area
 *        offer. Called by the post-detail ROUTE, not the screen.
 * WHY:   Three listings opened is the clearest cheap signal that someone is
 *        watching cars near them — the moment "want to know when one goes
 *        missing?" answers a question they are already asking.
 *
 *        It counts on UNMOUNT, not mount, so the offer lands as they leave a
 *        listing rather than on top of the one they just asked to see. That is
 *        the same rule the garage's exit sheet follows (garage/README.md: "The
 *        exit sheet fires on EXIT, never on entry") — an interstitial over
 *        content someone just tapped is a tax on the tap.
 *
 *        ONLY A HOME-FEED TAP COUNTS (2026-08-22). The route reads ?from=feed
 *        and passes it in; everything else — My Posts, a chat, a watchlist
 *        collection — is explicitly not browsing, and was raising the offer at
 *        owners managing their own theft.
 *
 *        Lives in notifications and is called from the route so that
 *        features/vehicles never imports features/notifications — exactly why
 *        src/app/post-a-car.tsx, not the wizard screen, raises the garage
 *        intent.
 * LINKS: ../lib/alertNudgeStorage.ts (the persisted count + the once-only flag);
 *        ../lib/alertNudgeIntent.ts (what the third view raises);
 *        src/app/post/[id].tsx (the only caller).
 */

import { useEffect } from 'react';

import { requestAlertNudge } from '../lib/alertNudgeIntent';
import {
  ALERT_NUDGE_VIEW_THRESHOLD,
  bumpAlertNudgePostViews,
  hasOfferedAlertNudge,
} from '../lib/alertNudgeStorage';

/**
 * @param countsAsBrowsing whether THIS view is evidence the reader is watching
 *   cars near them. Only a tap from the home feed is; opening your own listing
 *   from My Posts, a car from a chat, or a watchlist entry is not.
 *
 *   ⚠️ REQUIRED, and false is the safe answer. Until 2026-08-22 every view
 *   counted, so an owner working through their own listings raised an offer
 *   reading "want to know when a car goes missing near you?" — to someone whose
 *   car had just been stolen. The parameter exists so a caller has to make the
 *   claim explicitly rather than inherit it.
 */
export function useCountPostViewForAlertNudge(countsAsBrowsing: boolean): void {
  useEffect(() => {
    if (!countsAsBrowsing) {
      return;
    }
    // The whole body runs on UNMOUNT. Nothing is read at mount time, so there
    // is no stale-closure risk and a view that is still open never counts.
    return () => {
      void (async () => {
        // Settled users cost one read and no writes: once the offer has been
        // made the counter stops mattering forever.
        if (await hasOfferedAlertNudge()) {
          return;
        }
        const views = await bumpAlertNudgePostViews();
        // >=, NOT ===. The sheet SUPPRESSES without marking offered in several
        // cases — signed out, the garage sheet holding the slot, the alert list
        // still resolving. With `===` a guest who crossed the threshold while
        // signed out would have the intent raised, suppressed, no flag written,
        // and every later view miss by one: the offer dead for the life of the
        // install, including after they register. Browse-then-register is the
        // main funnel for this feature.
        //
        // This cannot become a nag: hasOfferedAlertNudge() above returns early
        // the moment the sheet actually presents, and it writes that flag on
        // present rather than on the user's answer.
        if (views >= ALERT_NUDGE_VIEW_THRESHOLD) {
          requestAlertNudge();
        }
      })();
    };
  }, [countsAsBrowsing]);
}
