/**
 * WHAT:  The blocked-accounts data path — reading the caller's own block list
 *        and lifting a block. Wrappers over list_my_blocks / unblock_user.
 * WHY:   Blocking is CREATED in chat (you block the person you are talking to,
 *        and blockThreadPeer takes a thread id because a chat client holds no
 *        peer uid). It is MANAGED here, because Settings is where a person
 *        looks for "who have I blocked" and it is the only surface that can
 *        offer an undo. Splitting it that way keeps each half in the feature
 *        that owns its screen — chat never imports profile at runtime, and
 *        profile never imports chat (ARCHITECTURE rule 1; a runtime chat →
 *        profile import would also close the profile → garage → vehicles →
 *        chat require cycle).
 *
 * ⚠️ THIS LIST IS OUTBOUND ONLY. list_my_blocks returns who the CALLER has
 *        blocked, never who has blocked them — that second list would tell a
 *        blocked person they were blocked, which is the one thing ADR-0017
 *        refuses to reveal. If this file ever grows an "accounts that blocked
 *        me" read, that is a privacy regression, not a feature.
 *
 * ⚠️ THE ID IS THE ONLY IDENTIFIER HERE, and it is safe precisely because the
 *        caller already knows this person: they blocked them. It exists so
 *        unblock_user has something to name. Everything else follows the
 *        passport rule — first name only, never display_name (may carry a
 *        surname) or avatar_path (embeds the uid).
 * LINKS: supabase/migrations/20260901150000_user_blocking.sql;
 *        docs/decisions/ADR-0017-user-blocking.md;
 *        src/features/chat/api/chatApi.ts (blockThreadPeer — the other half);
 *        src/features/profile/screens/BlockedAccountsScreen.tsx (the consumer).
 */

import { z } from 'zod';

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

const log = createLogger('profile');

/** One account the caller has blocked. */
export interface BlockedAccount {
  /** Needed by unblockAccount, and known to the caller already. */
  id: string;
  firstName: string;
  /** When the block was made — the list is newest first. */
  createdAt: string;
}

// .strict(), like every other cross-user payload in this app: a server that
// starts sending display_name or avatar_path must fail loudly here rather than
// quietly reach a screen nobody reviewed for it.
const blockRowSchema = z
  .object({
    id: z.guid(),
    first_name: z.string(),
    created_at: z.string(),
  })
  .strict();

/** Accounts the caller has blocked, newest first. Never who blocked them. */
export async function fetchMyBlocks(): Promise<BlockedAccount[]> {
  const { data, error } = await supabase.rpc('list_my_blocks');
  if (error) {
    log.warn('list_my_blocks failed', { code: error.code });
    throw new Error('We couldn’t load your blocked accounts. Please try again.');
  }
  const parsed = z.object({ blocks: z.array(blockRowSchema) }).strict().parse(data);
  return parsed.blocks.map((row) => ({
    id: row.id,
    firstName: row.first_name,
    createdAt: row.created_at,
  }));
}

/**
 * Lifts the caller's block on one account. Contact becomes possible again;
 * the thread's history was never removed, so it simply becomes writable.
 *
 * Silent server-side when no such block exists — that is already the state the
 * caller wanted — so this needs no "was it there?" branch.
 */
export async function unblockAccount(blockedId: string): Promise<void> {
  const { error } = await supabase.rpc('unblock_user', { p_blocked_id: blockedId });
  if (error) {
    log.warn('unblock_user failed', { code: error.code });
    throw new Error('We couldn’t unblock that account. Please try again.');
  }
  // No id in the event: this one names a specific person, and the count is
  // what a funnel needs.
  log.info('account_unblocked');
}
