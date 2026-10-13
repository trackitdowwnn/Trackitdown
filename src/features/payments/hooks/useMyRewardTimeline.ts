/**
 * WHAT:  useMyRewardTimeline — reads the owner's reward history for a listing
 *        on every focus (get_my_reward_timeline), for the "Your reward" card.
 * WHY:   PR4 of the payments UX plan (2026-10-13). On focus, as
 *        useMyRewardStatus is: a refund hold ends or a payout lands while the
 *        owner is elsewhere, and coming back should show it.
 * LINKS: ../api/rewardTimelineApi.ts; ../lib/rewardTimeline.ts;
 *        ./useMyRewardStatus.ts (the same shape for the live reward).
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchMyRewardTimeline, type RewardTimeline } from '../api/rewardTimelineApi';

/**
 * The owner's reward history, or null until read (or while disabled).
 * @param enabled false for anyone but the owner: the RPC is owner-scoped and
 *        would only refuse, so it is not called.
 */
export function useMyRewardTimeline(postId: string, enabled: boolean): RewardTimeline | null {
  const [timeline, setTimeline] = useState<RewardTimeline | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      let active = true;
      void fetchMyRewardTimeline(postId).then((next) => {
        if (active && next) setTimeline(next);
      });
      return () => {
        active = false;
      };
    }, [postId, enabled]),
  );

  return enabled ? timeline : null;
}
