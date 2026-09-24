/**
 * WHAT:  useOpenOnArrival — run `open` exactly ONCE, the first time `ready`
 *        becomes true, after the screen's push transition has finished.
 * WHY:   A long-press on My listings raises the owner's Manage sheet as soon as
 *        that listing's details have loaded. "Once" matters: the details
 *        reload after every edit and on the 30s poll, and a sheet that
 *        re-opened on each of those would fight the owner.
 *        runAfterInteractions so anything still animating settles before the
 *        sheet slides up, rather than the two animating over each other.
 * LINKS: src/features/vehicles/screens/MyPostsScreen.tsx (ListingManager,
 *        the caller).
 */

import { useEffect, useRef } from 'react';
import { InteractionManager } from 'react-native';

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
    const task = InteractionManager.runAfterInteractions(() => {
      // Marked done only once it has actually run, so a `ready` that flickers
      // off before the transition ends (and cancels this) still gets its turn.
      done.current = true;
      openRef.current();
    });
    return () => task.cancel();
  }, [ready]);
}
