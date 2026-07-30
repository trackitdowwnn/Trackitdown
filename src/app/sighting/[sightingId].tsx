/**
 * WHAT:  Route /sighting/[sightingId]?postId=… — thin wrapper rendering
 *        one sighting's full detail (owner-only surface; the RPC enforces it).
 * WHY:   Route files stay thin (ARCHITECTURE.md rule 3). postId rides along
 *        because the detail is served from the same owner payload as the
 *        list — one RPC, one privacy review surface.
 * LINKS: src/features/sightings/screens/SightingDetailScreen.tsx.
 */

import { useLocalSearchParams } from 'expo-router';

import { SightingDetailScreen } from '@/features/sightings';

export default function SightingDetailRoute() {
  const { sightingId, postId } = useLocalSearchParams<{ sightingId: string; postId: string }>();
  return <SightingDetailScreen postId={postId} sightingId={sightingId} />;
}
