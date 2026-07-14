/**
 * WHAT:  Route /report-sighting?postId=…&source=detail|map&bounty=<pence> —
 *        thin wrapper rendering the sightings feature's report wizard.
 * WHY:   Route files stay thin (ARCHITECTURE.md rule 3). Full-screen, outside
 *        the (tabs) group, so the tab bar is absent for the whole speed flow.
 * LINKS: src/features/sightings/screens/ReportSightingScreen.tsx.
 */

import { useLocalSearchParams } from 'expo-router';

import { ReportSightingScreen } from '@/features/sightings';

export default function ReportSightingRoute() {
  const { postId, source, bounty } = useLocalSearchParams<{
    postId: string;
    source?: string;
    bounty?: string;
  }>();
  const bountyPence = Number(bounty);
  return (
    <ReportSightingScreen
      postId={postId}
      source={source === 'map' ? 'map' : 'detail'}
      bountyPence={Number.isFinite(bountyPence) && bountyPence > 0 ? bountyPence : undefined}
    />
  );
}
