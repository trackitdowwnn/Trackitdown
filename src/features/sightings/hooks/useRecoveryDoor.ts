/**
 * WHAT:  useRecoveryDoor — whether the owner's sighting page may offer "Got
 *        your car back?" under a confirmed sighting, and with what words and
 *        route param: null (no door), or `{ noReward, bounty }`.
 * WHY:   Confirming a sighting ("Yes, it's my car") does NOT pay anyone — the
 *        reward moves only through the recovery flow — and the page used to
 *        end there, with nothing to do next (dev-team review, 2026-10-19).
 *        The door is the post's question, not the sighting's: the recovery
 *        RPC accepts an ACTIVE listing and nothing else, so the same rule the
 *        post page uses (`canMarkRecovered`) decides here, and the pricing
 *        mode rides along (`bountyParam`) because the recovery screen's copy
 *        promises a refund and a payout that are both false on a no-reward
 *        listing (ADR-0014).
 *
 *        Fetched only while `enabled` (a confirmed sighting), and again each
 *        time the screen regains focus — no polling: it gates a link, and the
 *        recovery screen re-checks everything. The refetch on focus is so the
 *        door closes after a recovery finished elsewhere ("I found it another
 *        way" leaves this sighting `helpful`; security review, 2026-10-19).
 *        ⚠️ A DOOR IS KEPT WITH THE POST IT CAME FROM and shown only for that
 *        post: a reused screen with a new `postId` must never show the last
 *        listing's reward wording — refund copy on a no-reward listing is the
 *        ADR-0014 mistake. A failure is simply no door — never an error on a
 *        page about something else. Deferred import keeps sightings' module graph off the vehicles
 *        feature (vehicles renders sightings' components), as in
 *        PostSightingsScreen and ReportSightingScreen.
 * LINKS: src/features/sightings/screens/SightingDetailScreen.tsx;
 *        src/features/vehicles/lib/ownerPermissions.ts (canMarkRecovered);
 *        src/features/vehicles/screens/PostDetailScreen.tsx (onRecovered —
 *        the same route and params); src/shared/lib/money.ts (bountyParam).
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import type { PostDetail, PostDetailResult } from '@/features/vehicles';
import { bountyParam } from '@/shared/lib';

export interface RecoveryDoor {
  /** A no-reward listing: credit is the spotter's whole reward. */
  noReward: boolean;
  /** The /recover-post `bounty` param, encoded. */
  bounty: string;
}

/** The door, from the post — pure, so it is tested without the deferred
 *  import (which Jest here cannot run). `canRecover` is vehicles'
 *  `canMarkRecovered`, passed in for the same reason. */
export function recoveryDoorFrom(
  result: PostDetailResult,
  canRecover: (post: PostDetail) => boolean,
): RecoveryDoor | null {
  if (result.kind !== 'visible' || !canRecover(result.post)) return null;
  return {
    noReward: result.post.bountyPence === null,
    bounty: bountyParam(result.post.bountyPence),
  };
}

/** The two vehicles functions the door needs, and how to load them. */
type VehiclesForDoor = Pick<
  typeof import('@/features/vehicles'),
  'canMarkRecovered' | 'fetchPostDetail'
>;
export type VehiclesLoader = () => Promise<VehiclesForDoor>;

/** Deferred — see the header. Module-level, so the focus effect's deps stay
 *  stable and it doesn't refetch every render. */
const loadVehicles: VehiclesLoader = () => import('@/features/vehicles');

/**
 * Whether to offer "Got your car back?" for `postId`, and its words and
 * param — null while `enabled` is false, until the post has been read, or
 * when the listing can't be recovered.
 *
 * `load` exists for tests (Jest here can't run the deferred import); the
 * screen never passes it.
 */
export function useRecoveryDoor(
  postId: string,
  enabled: boolean,
  load: VehiclesLoader = loadVehicles,
): RecoveryDoor | null {
  const [found, setFound] = useState<{ postId: string; door: RecoveryDoor | null } | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      let cancelled = false;
      (async () => {
        try {
          const { canMarkRecovered, fetchPostDetail } = await load();
          const result = await fetchPostDetail(postId);
          if (!cancelled) setFound({ postId, door: recoveryDoorFrom(result, canMarkRecovered) });
        } catch {
          // no door is a complete, honest page
          if (!cancelled) setFound({ postId, door: null });
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [postId, enabled, load]),
  );

  return enabled && found?.postId === postId ? found.door : null;
}
