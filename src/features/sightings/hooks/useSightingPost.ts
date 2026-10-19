/**
 * WHAT:  useSightingPost — the two facts the owner's sighting page needs from
 *        the LISTING (not the sighting): all of the owner's distinctive marks,
 *        and whether "Got your car back?" may be offered — with what words and
 *        route param. Null until the listing has been read, or if it can't be.
 * WHY:   - MARKS (owner, 2026-10-19): the page lists every mark the owner
 *          registered with the ones the spotter could see ticked — the report
 *          wizard's own "Could you see any of these?" list, read back. The
 *          sighting carries only the ticked ones, so the rest come from here.
 *        - RECOVERY: confirming a sighting ("Yes, it's my car") does NOT pay
 *          anyone — the reward moves only through the recovery flow (dev-team
 *          review, 2026-10-19). That is the post's question: the recovery RPC
 *          accepts an ACTIVE listing and nothing else, so the post page's own
 *          rule (`canMarkRecovered`) decides, and the pricing mode rides along
 *          (`bountyParam`) because the recovery screen promises a refund and a
 *          payout that are both false on a no-reward listing (ADR-0014).
 *
 *        Read once per focus — no polling — so the door closes after a
 *        recovery finished elsewhere ("I found it another way" leaves the
 *        sighting `helpful`; security review, 2026-10-19).
 *        ⚠️ THE FACTS ARE KEPT WITH THE POST THEY CAME FROM and returned only
 *        for that post: a reused screen with a new `postId` must never show
 *        the last listing's marks or reward wording. A failure is simply
 *        null — never an error on a page about something else. Deferred
 *        import keeps sightings' module graph off the vehicles feature
 *        (vehicles renders sightings' components), as in PostSightingsScreen
 *        and ReportSightingScreen.
 * LINKS: src/features/sightings/screens/SightingDetailScreen.tsx;
 *        ../lib/reportSeed.ts (the same marks the wizard offered);
 *        src/features/vehicles/lib/ownerPermissions.ts (canMarkRecovered);
 *        src/features/vehicles/screens/PostDetailScreen.tsx (onRecovered —
 *        the same route and params); src/shared/lib/money.ts (bountyParam).
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import type { PostDetail, PostDetailResult } from '@/features/vehicles';
import { bountyParam } from '@/shared/lib';

import { reportSeedFromDetail } from '../lib/reportSeed';
import type { ConfirmableFeature } from '../types';

export interface RecoveryDoor {
  /** A no-reward listing: credit is the spotter's whole reward. */
  noReward: boolean;
  /** The /recover-post `bounty` param, encoded. */
  bounty: string;
}

export interface SightingPostFacts {
  /** Every mark the owner registered, in their order — exactly the list the
   *  spotter was asked about. */
  marks: readonly ConfirmableFeature[];
  /** "Got your car back?" — null when the listing can't be recovered. */
  recovery: RecoveryDoor | null;
}

/** The facts, from the post — pure, so they are tested without the deferred
 *  import (which Jest here cannot run). `canRecover` is vehicles'
 *  `canMarkRecovered`, passed in for the same reason. Null for a listing that
 *  isn't visible. */
export function sightingPostFacts(
  result: PostDetailResult,
  canRecover: (post: PostDetail) => boolean,
): SightingPostFacts | null {
  if (result.kind !== 'visible') return null;
  const { post } = result;
  return {
    // The wizard's own mapping, so both sides list the same marks.
    marks: reportSeedFromDetail(result).confirmableFeatures,
    recovery: canRecover(post)
      ? { noReward: post.bountyPence === null, bounty: bountyParam(post.bountyPence) }
      : null,
  };
}

/** The two vehicles functions the page needs, and how to load them. */
type VehiclesForPage = Pick<
  typeof import('@/features/vehicles'),
  'canMarkRecovered' | 'fetchPostDetail'
>;
export type VehiclesLoader = () => Promise<VehiclesForPage>;

/** Deferred — see the header. Module-level, so the focus effect's deps stay
 *  stable and it doesn't refetch every render. */
const loadVehicles: VehiclesLoader = () => import('@/features/vehicles');

/**
 * The listing's facts for `postId` — null while `enabled` is false, until
 * the listing has been read, or when it can't be.
 *
 * `load` exists for tests (Jest here can't run the deferred import); the
 * screen never passes it.
 */
export function useSightingPost(
  postId: string,
  enabled: boolean,
  load: VehiclesLoader = loadVehicles,
): SightingPostFacts | null {
  const [found, setFound] = useState<{ postId: string; facts: SightingPostFacts | null } | null>(
    null,
  );

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      let cancelled = false;
      (async () => {
        try {
          const { canMarkRecovered, fetchPostDetail } = await load();
          const result = await fetchPostDetail(postId);
          if (!cancelled) setFound({ postId, facts: sightingPostFacts(result, canMarkRecovered) });
        } catch {
          // null is a complete, honest page: the marks fall back to the ticked
          // ones, and there is no door.
          if (!cancelled) setFound({ postId, facts: null });
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [postId, enabled, load]),
  );

  return enabled && found?.postId === postId ? found.facts : null;
}
