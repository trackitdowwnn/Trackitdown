/**
 * WHAT:  The client boundary for reporting a post — calls the flag_post RPC,
 *        which records the caller's report into post_flags (one per user/post).
 * WHY:   Live-on-payment publishes posts instantly, so abuse is handled
 *        reactively — a report must be CAPTURED (attributably), not logged and
 *        forgotten. The RPC pins reporter_id to auth.uid() and is idempotent, so
 *        this file just forwards the post id and surfaces failures. Reporting is
 *        auth-gated (accountability), so the caller is always signed in here.
 * LINKS: supabase/migrations/20260730110000_post_flags.sql (flag_post, post_flags);
 *        src/features/vehicles/screens/PostDetailScreen.tsx (the report button);
 *        docs/DOMAIN.md (reactive safety model).
 */

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

const log = createLogger('vehicles');

/** Record the signed-in caller's report of a post. Idempotent server-side (a
 *  re-report is a no-op). Throws on failure so the screen can show a retry. */
export async function flagPost(postId: string): Promise<void> {
  const { error } = await supabase.rpc('flag_post', { p_post_id: postId });
  if (error) {
    log.warn('flag_post failed', { code: error.code });
    throw error;
  }
  log.info('post_flagged', { postId });
}
