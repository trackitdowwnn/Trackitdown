/**
 * WHAT:  useEntranceGate — returns true for a short window that opens when
 *        `ready` first becomes true, then closes. Gate a list's `entering`
 *        animation with it so ONLY the initial on-screen rows animate in once;
 *        recycled/off-screen cells (which reuse the same components as the
 *        user scrolls) never re-animate.
 * WHY:   Reanimated layout `entering` on a FlashList/FlatList item re-fires
 *        every time a cell is recycled — rows visibly re-animate mid-scroll,
 *        which reads as a glitch (motion-audit finding). Turning the animation
 *        OFF a beat after the list first appears confines it to the first
 *        paint. The window MUST start when the DATA arrives, not at screen
 *        mount: a screen that shows a skeleton first would otherwise burn the
 *        window during loading and drop the entrance on slow networks. Pass
 *        the data-ready flag as `ready`.
 * LINKS: consumers: chat InboxScreen, sightings list, feed;
 *        docs/DESIGN_SYSTEM.md (Motion — lists).
 */

import { useEffect, useState } from 'react';

/** True from when `ready` first flips true until `durationMs` later (default
 *  500ms — covers the initial batch's stagger), then false so recycled cells
 *  don't animate. Pass the list's data-ready status as `ready` so the window
 *  opens at first paint, not at mount (skeleton phase). */
export function useEntranceGate(ready = true, durationMs = 500): boolean {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!ready) return;
    // setExpired in a timeout is async — not a synchronous setState-in-effect;
    // the [ready] dep means the window opens the moment data arrives.
    const timer = setTimeout(() => setExpired(true), durationMs);
    return () => clearTimeout(timer);
  }, [ready, durationMs]);
  return ready && !expired;
}
