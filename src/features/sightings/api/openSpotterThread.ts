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
 *
 *        Every error it throws carries words a person can read: the chat
 *        feature's own calm copy (ChatActionError), or one generic line —
 *        never a parser's message about a reply of the wrong shape (security
 *        review of #145). The screen shows the message as it is.
 * LINKS: src/features/chat/api/chatApi.ts (openThreadForSighting);
 *        src/features/sightings/screens/SightingDetailScreen.tsx.
 */

const OPEN_FAILED = 'We couldn’t open the conversation.';

/** The thread for this sighting's spotter — see the header. */
export async function openSpotterThread(sightingId: string): Promise<{ threadId: string }> {
  let chat: typeof import('@/features/chat');
  try {
    chat = await import('@/features/chat');
  } catch {
    throw new Error(OPEN_FAILED);
  }
  try {
    return await chat.openThreadForSighting(sightingId);
  } catch (error) {
    if (error instanceof chat.ChatActionError) throw error;
    throw new Error(OPEN_FAILED);
  }
}
