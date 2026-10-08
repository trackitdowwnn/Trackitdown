/**
 * WHAT:  forgetLocationMemory — clears every in-memory location cache the app
 *        keeps for speed (the place-label lookups, the map-centre read-ahead).
 *        Each cache registers its own clear when its module loads.
 * WHY:   A deliberate sign-out and an account deletion are the hand-over
 *        points for a shared or sold phone (SECURITY_AND_TRUST §3), and they
 *        already delete the saved report draft. The speed caches added on
 *        2026-10-08 hold points and labels from that session too, so they go
 *        at the same moment (security review of #142). A registry rather than
 *        direct imports keeps the caller (profileApi) off expo-location and
 *        storage: a cache whose module never loaded has nothing to forget.
 * LINKS: ./placeLabels.ts; ./useDefaultMapCentre.ts;
 *        src/features/profile/api/profileApi.ts (signOut, requestAccountDeletion).
 */

const clears = new Set<() => void>();

/** Called by each cache's module, once, as it loads. */
export function registerLocationMemory(clear: () => void): void {
  clears.add(clear);
}

/** Forget every registered cache. Never throws. */
export function forgetLocationMemory(): void {
  clears.forEach((clear) => {
    try {
      clear();
    } catch {
      // A cache that fails to clear must not block a sign-out.
    }
  });
}
