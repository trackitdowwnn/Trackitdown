/**
 * WHAT:  Route /recover-post?postId=…&bounty=<pence|none> — thin wrapper for
 *        the recovery screen.
 * WHY:   Route files stay thin (ARCHITECTURE.md rule 3). Flat route, matching
 *        the /post-about and /post-sightings pattern.
 *
 *        `bounty` carries the PRICING MODE, not just an amount. The recovery
 *        screen's options promise "your bounty comes back to you" and "we'll
 *        send your bounty to that spotter"; both are false on a no-reward
 *        listing (ADR-0014), and the screen has no other way to know — it is
 *        given a post id and reads sightings, never the post's price. Same
 *        encoder/token as /report-sighting so 'none' can never be confused with
 *        an absent param (String(null) parses to NaN, which cannot).
 * LINKS: src/features/vehicles/screens/RecoverPostScreen.tsx;
 *        src/shared/lib/money.ts (bountyParam / NO_BOUNTY_PARAM).
 */

import { useLocalSearchParams } from 'expo-router';

import { RecoverPostScreen } from '@/features/vehicles';
import { NO_BOUNTY_PARAM } from '@/shared/lib';

export default function RecoverPostRoute() {
  const { postId, bounty } = useLocalSearchParams<{ postId: string; bounty?: string }>();
  const parsed = Number(bounty);
  // number → a bounty listing; null → explicitly no reward; undefined → unknown,
  // which keeps the pre-2026-08-20 bounty copy (the conservative default).
  const bountyPence =
    bounty === NO_BOUNTY_PARAM ? null : Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  return <RecoverPostScreen postId={postId} bountyPence={bountyPence} />;
}
