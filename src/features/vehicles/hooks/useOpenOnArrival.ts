/**
 * WHAT:  useOpenOnArrival — run `open` exactly ONCE, the first time `ready`
 *        becomes true, deferred to the next tick.
 * WHY:   A long-press on My listings raises the owner's Manage sheet as soon as
 *        that listing's details have loaded. "Once" matters: the details
 *        reload after every edit and on the 30s poll, and a sheet that
 *        re-opened on each of those would fight the owner.
 *        The defer only moves the open out of the commit that made `ready`
 *        true. It does NOT wait for the push transition: RN 0.86's
 *        runAfterInteractions (used here before) was only this next-tick stub.
 * LINKS: src/features/vehicles/screens/MyPostsScreen.tsx (ListingManager,
 *        the caller).
 */

import { useEffect, useRef } from 'react';

export function useOpenOnArrival(ready: boolean, open: () => void): void {
  const done = useRef(false);
  // The latest `open`, so an inline callback does not re-arm the effect.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!ready || done.current) {
      return;
    }
    const timer = setTimeout(() => {
      // Marked done only once it has actually run, so a `ready` that flickers
      // off before this fires (and cancels it) still gets its turn.
      done.current = true;
      openRef.current();
    }, 0);
    return () => clearTimeout(timer);
  }, [ready]);
}
