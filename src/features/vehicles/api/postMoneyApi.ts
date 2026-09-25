/**
 * WHAT:  The client boundary to get_post_money — the owner's money for one of
 *        their listings, parsed. Returns null for "nothing to show": not the
 *        owner, no such listing, or nothing captured yet (a draft).
 * WHY:   The owner's money had no read at all until 20260925110000. One
 *        function, so the parse and the null contract live in one place.
 *        The server makes the ownership decision; a null here is never an
 *        error and is never distinguished ("not yours" and "nothing yet" are
 *        the same answer by design).
 * LINKS: supabase/migrations/20260925110000_money_you_can_see.sql;
 *        src/features/vehicles/lib/postMoney.ts (schema + copy);
 *        src/features/vehicles/hooks/usePostMoney.ts (the caller).
 */

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

import { postMoneySchema, type PostMoney } from '../lib/postMoney';

const log = createLogger('vehicles');

export async function fetchPostMoney(postId: string): Promise<PostMoney | null> {
  const { data, error } = await supabase.rpc('get_post_money', { p_post_id: postId });
  if (error) {
    log.warn('post_money_load failed', { code: error.code });
    throw error;
  }
  if (data === null || data === undefined) {
    return null;
  }
  const money = postMoneySchema.parse(data);
  log.info('post_money_load', { state: money.state });
  return money;
}
