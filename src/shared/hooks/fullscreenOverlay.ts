/**
 * WHAT:  Whether a FULL-SCREEN overlay (the SelectScreen picker) is up —
 *        `holdFullscreenOverlay()` while one is mounted (it returns its
 *        release), `useFullscreenOverlayOpen()` to read it.
 * WHY:   2026-10-12 (motion review). The Android keyboard events are global,
 *        so a screen's own keyboard lift (the wizard footer's
 *        useAndroidKeyboardHeight) also rose and fell for a keyboard that
 *        belonged to a picker drawn OVER it. While the picker's backdrop was a
 *        static opaque fill that never showed; now it fades, so the wizard's
 *        Next button was seen hanging at keyboard height and snapping down
 *        as a picker closed after a typed search. A screen behind reads this
 *        and holds its lift still while an overlay is up.
 * LINKS: src/shared/ui/SelectScreen.tsx (holds it);
 *        src/shared/wizard/WizardScreen.tsx (reads it).
 */

import { useSyncExternalStore } from 'react';

let held = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Mark a full-screen overlay as up; call the returned release when it has
 *  gone. Safe to release once only — a second call does nothing. */
export function holdFullscreenOverlay(): () => void {
  held += 1;
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held -= 1;
    notify();
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => held > 0;

/** True while any full-screen overlay holds the screen. */
export function useFullscreenOverlayOpen(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
