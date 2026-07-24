/**
 * WHAT:  Tiny haptic helpers — a light selection tick and a success buzz — that
 *        lazily load expo-haptics and degrade SILENTLY if the native module (or
 *        the device's taptic support) isn't present.
 * WHY:   Haptics are polish, never load-bearing: a missing binary or a device
 *        without a haptic engine must never throw. One helper keeps the lazy-
 *        require + swallow pattern in a single place instead of per-component
 *        (the OS already honours the user's system haptics setting, so no extra
 *        guard is needed here).
 * LINKS: src/features/watchlist/components/WatchToggle.tsx (light tick);
 *        src/features/vehicles/post (submit + picker/swatch feedback);
 *        docs/DESIGN_SYSTEM.md (Motion — restrained feedback).
 */

interface HapticsModule {
  impactAsync(style: unknown): Promise<void>;
  notificationAsync(type: unknown): Promise<void>;
  ImpactFeedbackStyle: { Light: unknown };
  NotificationFeedbackType: { Success: unknown };
}

function haptics(): HapticsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy load so a build without the module no-ops
    return require('expo-haptics') as HapticsModule;
  } catch {
    return null; // not in this binary yet — callers no-op
  }
}

/** A light tick for a selection/pick (list row, swatch). Silent if unsupported. */
export function lightHaptic(): void {
  const h = haptics();
  if (h) {
    void h.impactAsync(h.ImpactFeedbackStyle.Light).catch(() => {});
  }
}

/** A confirming success buzz for a completed action (e.g. a submitted report). */
export function successHaptic(): void {
  const h = haptics();
  if (h) {
    void h.notificationAsync(h.NotificationFeedbackType.Success).catch(() => {});
  }
}
