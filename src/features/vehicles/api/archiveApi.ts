/**
 * WHAT:  setPostArchived — archive or unarchive one of the caller's own CLOSED
 *        listings (set_post_archived). Archived listings sit in the collapsed
 *        "Archived" section of My listings.
 * WHY:   Owner's call, 2026-09-24: finished listings (recovered, cancelled,
 *        expired) take up room in My listings. Archiving is personal
 *        organisation only — no status, no money, nothing public changes — and
 *        it is stored on the account so it follows the owner to any phone.
 *        Live listings can't be archived: an owner must never lose sight of a
 *        car that is still being searched for. The server enforces that
 *        (NOT_CLOSED) and ownership (NOT_OWNER); the app only decides which
 *        rows to offer.
 * LINKS: supabase/migrations/20260924130000_archive_listings.sql (the RPC);
 *        src/features/vehicles/screens/MyPostsScreen.tsx (the section);
 *        src/features/vehicles/lib/ownerPermissions.ts (canArchive).
 */

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

const log = createLogger('vehicles');

/** Server codes worth their own words. A raw server message is never shown. */
const MESSAGES: Record<string, string> = {
  NOT_CLOSED: 'Only finished listings can be archived. A live listing stays in view.',
  NOT_OWNER: 'Only the owner of a listing can archive it.',
  POST_NOT_FOUND: 'We couldn’t find that listing.',
  NOT_AUTHENTICATED: 'Please log in again, then try once more.',
};
const FALLBACK = 'We couldn’t update that listing. Please try again.';

export class ArchiveError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'ArchiveError';
    this.code = code;
  }
}

/**
 * Archive (`true`) or unarchive (`false`) a listing. Idempotent server-side:
 * archiving an archived listing keeps its original archive time.
 *
 * Resolves to the server's archive stamp (null once unarchived), so the list
 * can move the card straight away instead of waiting for a reload.
 */
export async function setPostArchived(postId: string, archived: boolean): Promise<string | null> {
  const { data, error } = await supabase.rpc('set_post_archived', {
    p_post_id: postId,
    p_archived: archived,
  });
  if (error) {
    // The RPC raises bare codes; Postgres wraps them, so match on inclusion.
    const code = Object.keys(MESSAGES).find((known) => error.message.includes(known)) ?? 'UNKNOWN';
    log.warn('set_post_archived failed', { postId, archived, code });
    throw new ArchiveError(Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : FALLBACK, code);
  }
  log.info(archived ? 'post_archived' : 'post_unarchived', { postId });
  const stamp = (data as { archivedAt?: unknown } | null)?.archivedAt;
  if (!archived) {
    return null;
  }
  // The server always returns the stamp; a now-ish time keeps the card in the
  // right section if it somehow doesn't (the next reload corrects it).
  return typeof stamp === 'string' ? stamp : new Date().toISOString();
}
