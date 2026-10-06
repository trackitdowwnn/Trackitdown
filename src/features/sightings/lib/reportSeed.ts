/**
 * WHAT:  reportSeedFromDetail — the read-only facts the report wizard is
 *        seeded with, taken from the post's public detail: the owner's
 *        registered marks (the context step's "Could you see any of these?")
 *        and the car itself (the check-and-send step's "You're reporting").
 * WHY:   One fetch, two uses: ReportSightingScreen already loads the post
 *        detail for the marks, so the car rides along at no network cost —
 *        and so does the LIVE reward, which the success screen promises.
 *        Pure, so the mapping is tested without the network. Both are SEEDS:
 *        never submitted (submitAnswersSchema strips them, and
 *        buildCreateSightingParams maps fields explicitly; both pinned in
 *        sightingApi.test.ts).
 *        Best-effort: anything but a visible post yields the empty seed, and
 *        the wizard simply shows no marks section and no car card.
 * LINKS: src/features/sightings/screens/ReportSightingScreen.tsx (the fetch);
 *        src/features/sightings/components/ConfirmStep.tsx (the car card);
 *        src/features/vehicles/types.ts (PostDetail).
 */

import type { PostDetailResult } from '@/features/vehicles';

import type { ConfirmableFeature, ReportedCar } from '../types';

/** The wizard's read-only facts about the post being reported. */
export interface ReportSeed {
  confirmableFeatures: readonly ConfirmableFeature[];
  reportedCar?: ReportedCar;
  /**
   * The listing's reward AS IT IS NOW — for the success screen's promise. The
   * route's `bounty` param was written when the spotter tapped "I've seen
   * this car", from a page that may have been open for hours; a reward can
   * change or END in between (ADR-0020), and "you'll receive the £200
   * reward" must not outlive the reward. Absent when the read failed: the
   * screen then falls back to the param.
   */
  reward?: { bountyPence: number | null; rewardEnded: boolean };
}

/** No marks, no car: what a failed or hidden fetch seeds. Frozen, because one
 *  object is shared by every report and must never be changed in place. */
export const EMPTY_REPORT_SEED: ReportSeed = Object.freeze({
  confirmableFeatures: Object.freeze([]),
});

/** The seed from a post-detail result. Best-effort: anything but a visible
 *  post yields EMPTY_REPORT_SEED. */
export function reportSeedFromDetail(result: PostDetailResult): ReportSeed {
  if (result.kind !== 'visible') return EMPTY_REPORT_SEED;
  const { post } = result;
  return {
    // A mark without an id (an old cached payload) can't be confirmed: the
    // sighting references marks by id. The photo goes too, so the context
    // step can show the spotter what they're looking for.
    confirmableFeatures: post.distinctiveFeatures.flatMap((feature) =>
      feature.id
        ? [{ id: feature.id, description: feature.description, photoUrl: feature.photoUrl || undefined }]
        : [],
    ),
    reportedCar: {
      make: post.make,
      model: post.model,
      colour: post.colour,
      plate: post.plate,
      photoUrl: post.photos[0]?.uri || undefined,
    },
    reward: { bountyPence: post.bountyPence, rewardEnded: post.rewardEnded },
  };
}
