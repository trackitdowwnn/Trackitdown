/**
 * WHAT:  Public API of the profile feature.
 * WHY:   Routes import the screens; the tab layout renders the Profile tab
 *        from useProfileTab; the sightings feature (later) opens the
 *        PublicProfileSheet with fetchPublicProfile — everything else stays
 *        internal (docs/ARCHITECTURE.md rule 1).
 * LINKS: src/features/profile/README.md.
 */

export { fetchPublicProfile } from './api/profileApi';
export {
  PublicProfileSheet,
  type PublicProfileSheetProps,
} from './components/PublicProfileSheet';
export { EditProfileScreen } from './screens/EditProfileScreen';
export { useProfileTab } from './hooks/useProfileTab';
export { ProfileScreen } from './screens/ProfileScreen';
export { SpotterStoryScreen } from './screens/SpotterStoryScreen';
export type { MyProfile, PublicProfile, ReputationCounters } from './types';
