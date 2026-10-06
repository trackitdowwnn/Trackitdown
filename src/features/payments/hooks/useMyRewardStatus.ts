/**
 * WHAT:  useMyRewardStatus — the owner's reward status for one listing,
 *        re-read on every focus, with the moment it was read.
 * WHY:   The listing (banner + stat-band line) and the stats page all speak
 *        about the same reward; one read per screen keeps them agreeing.
 *        Re-reading on focus is what makes returning from a renewal show the
 *        new date.
 *
 *        "Now" is captured WITH the read, never computed in render: the React
 *        Compiler memoises render-time clock reads on device, which would
 *        freeze whether the renew window has opened (memory:
 *        react-compiler-freezes-now).
 *
 *        A failed read is nobody's problem to see: status stays as it was
 *        (null at first), every surface then renders nothing it cannot state
 *        truthfully, and the next focus retries.
 * LINKS: ../api/rewardChangeApi.ts (fetchMyRewardStatus);
 *        ../lib/rewardTerm.ts (what the status means at readAt).
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchMyRewardStatus, type RewardStatus } from '../api/rewardChangeApi';

export interface MyRewardStatusState {
  /** Null until the first successful read, or while disabled. */
  status: RewardStatus | null;
  /** Epoch ms of that read — the "now" every phase is computed against. */
  readAt: number;
}

/**
 * Reads the owner's reward status for one listing on every focus, with the
 * moment of the read.
 * @param enabled false for anyone but the owner of a live listing: the RPC is
 *        owner-scoped and would only refuse, so it is not called.
 */
export function useMyRewardStatus(postId: string, enabled = true): MyRewardStatusState {
  const [state, setState] = useState<MyRewardStatusState>({ status: null, readAt: 0 });

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      let active = true;
      fetchMyRewardStatus(postId)
        .then((status) => {
          if (active) setState({ status, readAt: Date.now() });
        })
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }, [postId, enabled]),
  );

  return enabled ? state : { status: null, readAt: 0 };
}
