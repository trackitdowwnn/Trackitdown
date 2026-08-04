/**
 * WHAT:  Route /sighting-dispute?sightingId=… — thin wrapper for the spotter's
 *        dispute screen ("my sighting led to this recovery").
 * WHY:   Route files stay thin (ARCHITECTURE.md rule 3). Flat route: the
 *        destination of the closed_uncredited and dispute_rejected pushes.
 * LINKS: src/features/sightings/screens/SightingDisputeScreen.tsx.
 */

import { useLocalSearchParams } from 'expo-router';

import { SightingDisputeScreen } from '@/features/sightings';

export default function SightingDisputeRoute() {
  const { sightingId } = useLocalSearchParams<{ sightingId: string }>();
  return <SightingDisputeScreen sightingId={sightingId} />;
}
