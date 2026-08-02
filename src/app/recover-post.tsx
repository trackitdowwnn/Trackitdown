/**
 * WHAT:  Route /recover-post?postId=… — thin wrapper for the recovery screen.
 * WHY:   Route files stay thin (ARCHITECTURE.md rule 3). Flat route, matching
 *        the /post-about and /post-sightings pattern.
 * LINKS: src/features/vehicles/screens/RecoverPostScreen.tsx.
 */

import { useLocalSearchParams } from 'expo-router';

import { RecoverPostScreen } from '@/features/vehicles';

export default function RecoverPostRoute() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  return <RecoverPostScreen postId={postId} />;
}
