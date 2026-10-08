/**
 * WHAT:  openSpotterThread — opens (or reuses) the owner's chat with the
 *        spotter of ONE sighting, by sighting id, and returns its thread id.
 * WHY:   The chat feature is loaded only when the owner actually taps
 *        "Message": a deferred import keeps the sightings screens' module
 *        graph (and their tests') off chat. It lives in its own module so a
 *        test can stand in for it — Jest here cannot run a dynamic import()
 *        ("--experimental-vm-modules"), which is why the page's Message
 *        path went untested until this existed (2026-10-08).
 *
 *        PRIVACY (§1): the SIGHTING id is the handle — the server resolves
 *        the spotter; no spotter id ever reaches this client.
 * LINKS: src/features/chat/api/chatApi.ts (openThreadForSighting);
 *        src/features/sightings/screens/SightingDetailScreen.tsx.
 */

/** The thread for this sighting's spotter — see the header. */
export async function openSpotterThread(sightingId: string): Promise<{ threadId: string }> {
  const { openThreadForSighting } = await import('@/features/chat');
  return openThreadForSighting(sightingId);
}
