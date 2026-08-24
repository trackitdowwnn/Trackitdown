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
// The feed reads `createdAt` from here to decide whether a user is tenured
// enough for the garage nudge — it INJECTS that into the garage, which must
// never import this feature back (profile already imports garage).
export { useMyProfile } from './hooks/useMyProfile';
export { ProfileScreen } from './screens/ProfileScreen';
export { ReportBugScreen } from './screens/ReportBugScreen';
export { SettingsScreen } from './screens/SettingsScreen';
export { useTrackVisitedTab } from './lib/lastArea';
export { SpotterStoryScreen } from './screens/SpotterStoryScreen';
export type { MyProfile, PublicProfile, ReputationCounters } from './types';
