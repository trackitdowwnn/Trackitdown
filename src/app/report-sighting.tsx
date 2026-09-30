/**
 * WHAT:  Route /report-sighting?postId=…&source=detail|map&bounty=<pence|none> —
 *        thin wrapper rendering the sightings feature's report wizard.
 *        ⚠️ Whether the safety sheet was already shown is NOT a param: a URL
 *        can be forged, so the screen checks an in-memory proof instead
 *        (sightings/lib/safetyAck.ts).
 * WHY:   Route files stay thin (ARCHITECTURE.md rule 3). Full-screen, outside
 *        the (tabs) group, so the tab bar is absent for the whole speed flow.
 *
 *        `bounty=none` is a REAL value, not a missing one (ADR-0014): it says
 *        this listing offers no cash reward, which the success screen must state
 *        rather than promising "the bounty". It is spelled distinctly because a
 *        null bounty stringifies to "null" and parses to NaN — indistinguishable
 *        from the param simply being absent, which is what made the screen
 *        promise money that was never coming.
 * LINKS: src/features/sightings/screens/ReportSightingScreen.tsx.
 */

import { useLocalSearchParams } from 'expo-router';

import { ReportSightingScreen } from '@/features/sightings';
import { NO_BOUNTY_PARAM } from '@/shared/lib';

export default function ReportSightingRoute() {
  const { postId, source, bounty } = useLocalSearchParams<{
    postId: string;
    source?: string;
    bounty?: string;
  }>();
  const parsed = Number(bounty);
  // Three distinct states, and the difference between the last two matters:
  //   number    — a known bounty; the success copy names it.
  //   null      — this listing has NO reward; the copy must not promise one.
  //   undefined — unknown (param absent or unparseable); generic copy.
  const bountyPence =
    bounty === NO_BOUNTY_PARAM ? null : Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  return (
    // Keyed on the post: the screen reads the safety proof once, at mount,
    // so a reused route with a new postId must start over, sheet and all.
    <ReportSightingScreen
      key={postId}
      postId={postId}
      source={source === 'map' ? 'map' : 'detail'}
      bountyPence={bountyPence}
    />
  );
}
