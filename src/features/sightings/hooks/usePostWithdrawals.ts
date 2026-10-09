/**
 * WHAT:  usePostWithdrawals — the sightings taken back that a post's OWNER
 *        was told about (get_post_withdrawals), refreshed silently whenever
 *        the screen gains focus.
 * WHY:   2026-10-09 (owner request): a "Something else" note is read in the
 *        app, never in a push, and the "taken back" push opens the listing —
 *        so the listing must show it. Quiet by design: this list is
 *        secondary to the live sightings, so loading and a failed load both
 *        render as nothing (no skeleton, no error line), and a failed
 *        BACKGROUND refresh keeps what is on screen. Owner-only: `enabled`
 *        is false on the public face, so no request is made at all.
 * LINKS: src/features/sightings/api/sightingApi.ts (fetchPostWithdrawals);
 *        src/features/sightings/components/PostSightingsSection.tsx;
 *        src/features/sightings/hooks/usePostSightings.ts (same shape).
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchPostWithdrawals } from '../api/sightingApi';
import type { PostWithdrawal } from '../types';

export function usePostWithdrawals(postId: string, enabled = true): PostWithdrawal[] {
  const [withdrawals, setWithdrawals] = useState<PostWithdrawal[]>([]);

  const load = useCallback(async () => {
    try {
      setWithdrawals(await fetchPostWithdrawals(postId));
    } catch {
      // Keep whatever is on screen — see the header.
    }
  }, [postId]);

  // One request on arrival (a focused screen runs this on mount, and again
  // if `enabled` or the post changes) and one each time it regains focus.
  // setState only ever runs after the await (react-compiler rule).
  useFocusEffect(
    useCallback(() => {
      if (enabled) void load();
    }, [enabled, load]),
  );

  return enabled ? withdrawals : [];
}
