/**
 * WHAT:  fetchMyRewardTimeline — the owner's history of their listing's reward
 *        money (get_my_reward_timeline): each reward taken, and whether and
 *        when it was paid out, refunded, or held before a refund.
 * WHY:   PR4 of the payments UX plan (2026-10-13). An owner could only see a
 *        reward while it was held; once money moved they got a toast and then
 *        nothing. This feeds the listing's "Your reward" card.
 *
 *        Null on any failure, never a throw: the card is a record of what
 *        happened, and a read that fails must not take the listing with it.
 * LINKS: supabase/migrations/20261013120000_an_owner_can_see_their_reward.sql;
 *        ../lib/rewardTimeline.ts (turns it into steps);
 *        ../hooks/useMyRewardTimeline.ts.
 */

import { z } from 'zod';

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';
import type { PostStatus } from '@/shared/types';

const log = createLogger('payments');

const rewardSchema = z.object({
  status: z.enum(['held', 'released', 'refunded', 'superseded']),
  amountPence: z.number().int().positive(),
  capturedAt: z.string(),
  termEndsAt: z.string().nullable(),
  releasedAt: z.string().nullable(),
  refundedAt: z.string().nullable(),
  refundedPence: z.number().int().nonnegative().nullable(),
  supersededAt: z.string().nullable(),
  holdUntil: z.string().nullable(),
  holdReason: z.string().nullable(),
});

const timelineSchema = z.object({
  postStatus: z.string(),
  rewards: z.array(rewardSchema),
  creditedAt: z.string().nullable(),
  disputeOpen: z.boolean(),
});

export type TimelineReward = z.infer<typeof rewardSchema>;

export interface RewardTimeline {
  postStatus: PostStatus;
  /** Every reward taken on this listing, oldest first. */
  rewards: TimelineReward[];
  /** When a sighting was credited, if one was. */
  creditedAt: string | null;
  /** A spotter has contested a refund and it's being reviewed. */
  disputeOpen: boolean;
}

/** The owner's reward history for one listing, or null. */
export async function fetchMyRewardTimeline(postId: string): Promise<RewardTimeline | null> {
  const { data, error } = await supabase.rpc('get_my_reward_timeline', { p_post_id: postId });
  if (error) {
    log.warn('get_my_reward_timeline failed', { code: error.code });
    return null;
  }
  const parsed = timelineSchema.safeParse(data);
  if (!parsed.success) {
    log.error('get_my_reward_timeline returned an unexpected shape');
    return null;
  }
  return { ...parsed.data, postStatus: parsed.data.postStatus as PostStatus };
}
