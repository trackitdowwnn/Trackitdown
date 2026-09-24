/**
 * WHAT:  useOpenOnArrival — run `open` exactly ONCE, the first time `ready`
 *        becomes true, after the screen's push transition has finished.
 * WHY:   A long-press on My listings lands on the post with `?manage=1`, and
 *        the owner's Manage sheet should rise by itself. "Once" matters: the
 *        post reloads on pull-to-refresh and after every section edit, and a
 *        sheet that re-opened on each of those would fight the owner.
 *        runAfterInteractions so the page settles before the sheet slides up,
 *        rather than the two animating over each other.
 * LINKS: src/features/vehicles/screens/PostDetailScreen.tsx (the caller);
 *        src/features/vehicles/screens/MyPostsScreen.tsx (the long-press).
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
