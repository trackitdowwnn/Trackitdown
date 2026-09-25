/**
 * WHAT:  usePostMoney — the owner's money for one listing, re-read whenever the
 *        screen regains focus or the caller's `refreshKey` changes (the post's
 *        status is the natural key: every money move changes it, or follows one).
 * WHY:   Money moves while the owner is elsewhere — a held refund released by
 *        the sweep, a payout released by the webhook — so a read taken once on
 *        mount goes stale exactly when it matters. Focus is when the owner is
 *        looking; that is when to ask. A failed read keeps the last good answer
 *        rather than blanking the card: money copy that flickers away reads as
 *        money that went away.
 * LINKS: src/features/vehicles/api/postMoneyApi.ts;
 *        src/features/vehicles/components/PostMoneyCard.tsx (the consumer).
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchPostMoney } from '../api/postMoneyApi';
import type { PostMoney } from '../lib/postMoney';

export interface UsePostMoneyResult {
  /** The money, or null while loading / when there is nothing to show. */
  money: PostMoney | null;
  /** Re-read now — after the owner's own action moved money. */
  refresh: () => void;
}

/**
 * @param postId   the listing
 * @param enabled  false for anyone but the owner — no request is made at all
 * @param refreshKey re-read when this changes (pass the post's status)
 */
export function usePostMoney(
  postId: string,
  enabled: boolean,
  refreshKey?: string,
): UsePostMoneyResult {
  const [money, setMoney] = useState<PostMoney | null>(null);
  const [generation, setGeneration] = useState(0);

  const refresh = useCallback(() => setGeneration((g) => g + 1), []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    fetchPostMoney(postId)
      .then((next) => {
        if (!cancelled) setMoney(next);
      })
      .catch(() => {
        // Keep the last good answer; the next focus retries.
      });
    return () => {
      cancelled = true;
    };
  }, [postId, enabled, refreshKey, generation]);

  // The FIRST focus is the mount, which the effect above already read for —
  // re-reading there would double every screen open. Every later focus is a
  // return, which is exactly when money may have moved.
  const seenFirstFocus = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!seenFirstFocus.current) {
        seenFirstFocus.current = true;
        return;
      }
      if (enabled) refresh();
    }, [enabled, refresh]),
  );

  return { money: enabled ? money : null, refresh };
}
