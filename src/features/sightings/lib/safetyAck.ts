/**
 * WHAT:  The in-memory proof that the report safety sheet was just confirmed
 *        for a post: `markSafetyAck(postId)` when its "Continue" is
 *        pressed, `hasFreshSafetyAck(postId)` when the report screen mounts.
 * WHY:   The report screen must not open the camera unless the sheet was
 *        shown (SECURITY_AND_TRUST §1). The first version said so with a
 *        `safety=seen` route param, and a security review caught that any
 *        deep link could carry it: `trackitdown://report-sighting?postId=X
 *        &safety=seen` went straight to the camera (2026-09-30). Module memory
 *        can't be put in a URL and dies with the JS session, like the auth
 *        gate's pending intent.
 *        FRESH, NOT CONSUMED: the screen reads it in a useState initialiser,
 *        which StrictMode runs twice, so a take-once flag would show the sheet
 *        again in dev. It expires instead: 30s covers the push and the mount
 *        many times over, and is far too short to reuse on a later report.
 * LINKS: src/features/sightings/components/ReportSafetySheet.tsx (marks it);
 *        src/features/sightings/screens/ReportSightingScreen.tsx (reads it);
 *        src/features/auth/lib/gateIntent.ts (the same in-memory idea).
 */

const FRESH_MS = 30_000;

let lastAck: { postId: string; at: number } | null = null;

/** The sheet was confirmed for this post, now. */
export function markSafetyAck(postId: string, now: number = Date.now()): void {
  lastAck = { postId, at: now };
}

/** Was the sheet confirmed for THIS post in the last 30 seconds? */
// SAFETY: the only check between a report route and the camera.
export function hasFreshSafetyAck(postId: string, now: number = Date.now()): boolean {
  if (lastAck === null || lastAck.postId !== postId) return false;
  const age = now - lastAck.at;
  // A clock set BACK makes the age negative; that's not "fresh", it's unknown.
  return age >= 0 && age < FRESH_MS;
}

/** Tests only: forget any acknowledgement. */
export function resetSafetyAck(): void {
  lastAck = null;
}
