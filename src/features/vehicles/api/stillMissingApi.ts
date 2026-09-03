/**
 * WHAT:  The ADR-0019 liveness check, client side: which of the caller's posts
 *        have an outstanding "is your car still missing?" ask, and the call
 *        that answers "still missing".
 * WHY:   ⚠️ THIS EXISTS SO THE ASK IS NOT PUSH-ONLY. Review finding #15 was
 *        /sighting-dispute being reachable only through a notification, so a
 *        spotter who declined push could never contest a denial. Repeating that
 *        here would be worse: the audience for this ask is BY DEFINITION the
 *        owner who has stopped opening the app, and push is the least reliable
 *        way to reach them. The banner these calls feed is the door; the push
 *        is only a reminder that the door is there.
 *
 *        There is no `iveFoundIt` call, and there should not be: that button
 *        routes into the existing recovery flow, which is unchanged and remains
 *        the only thing in the system that moves escrow.
 * LINKS: supabase/migrations/20260902140000_still_missing_check.sql (both RPCs);
 *        docs/decisions/ADR-0019-the-abandoned-post.md;
 *        src/features/vehicles/hooks/useStillMissingAsk.ts;
 *        src/features/vehicles/components/StillMissingBanner.tsx.
 */

import { z } from 'zod';

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

import { StillMissingError } from '../lib/stillMissingError';

const log = createLogger('posts');

// Re-exported so this stays the one import for callers that raise and catch in
// the same breath; the class lives in lib/ so a screen can narrow on it without
// pulling the supabase client into every test that mocks the data layer.
export { StillMissingError };

const STILL_MISSING_ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: 'Please sign in and try again.',
  // One opaque server token covers missing / not-yours / not-active, so the
  // copy has to cover all three without guessing which it was.
  POST_NOT_FOUND: 'We couldn’t update that listing.',
};

const FALLBACK = 'Something went wrong. Please try again.';

const askSchema = z.object({
  post_id: z.guid(),
  asked_at: z.string(),
  ask_count: z.number().int(),
});

export interface StillMissingAsk {
  postId: string;
  askedAt: string;
  /** How many asks have gone out since the last confirmation (1–3). */
  askCount: number;
}

/**
 * The caller's posts with an outstanding ask. Empty for a guest, and empty is
 * the overwhelmingly normal answer — this is polled by screens the owner opens
 * anyway, not by anything on a timer.
 */
export async function listOpenStillMissingAsks(): Promise<StillMissingAsk[]> {
  const { data, error } = await supabase.rpc('list_my_open_still_missing_asks');
  if (error) {
    // ⚠️ SWALLOWED, NOT THROWN, and this is the one place in this file where
    // that is right. The banner is an ADDITION to a screen that has its own
    // job: a failure here must not turn someone's post detail into an error
    // state. The ask is not lost — it is a row in the database until answered,
    // so the next open shows it.
    log.warn('still_missing_asks failed', { code: error.code });
    return [];
  }
  const rows = z.array(askSchema).parse(data ?? []);
  return rows.map((row) => ({
    postId: row.post_id,
    askedAt: row.asked_at,
    askCount: row.ask_count,
  }));
}

/**
 * "Still missing" — resets the clock and the counter. The owner gets a full
 * fresh cycle rather than a shrinking allowance, because answering is exactly
 * the behaviour this feature wants.
 */
export async function confirmStillMissing(postId: string): Promise<void> {
  const { error } = await supabase.rpc('confirm_still_missing', { p_post_id: postId });
  if (error) {
    // hasOwn, not `in`: `in` walks the prototype chain, so a Postgres message
    // of "toString" would look known and hand a FUNCTION to the user as copy.
    const known = Object.hasOwn(STILL_MISSING_ERROR_MESSAGES, error.message);
    log.warn('still_missing_confirm rejected', {
      postId,
      code: error.code,
      reason: known ? error.message : undefined,
    });
    throw new StillMissingError(
      known ? STILL_MISSING_ERROR_MESSAGES[error.message] : FALLBACK,
      known ? error.message : 'RPC_ERROR',
    );
  }
  log.info('still_missing_confirmed', { postId });
}
