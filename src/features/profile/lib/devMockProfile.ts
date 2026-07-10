/**
 * WHAT:  A sample profile for the __DEV__ "preview with sample data" path.
 * WHY:   Real auth doesn't exist yet; this lets every profile state be
 *        eyeballed on device now. Counters chosen to show earned AND ghosted
 *        badges at once. Never imported by production code paths.
 * LINKS: src/features/profile/screens/ProfileScreen.tsx (dev preview).
 */

import type { MyProfile } from '../types';

export const DEV_MOCK_PROFILE: MyProfile = {
  id: 'dev-mock',
  firstName: 'Ollie',
  displayName: 'Ollie B',
  avatarUrl: null,
  createdAt: '2026-05-14T09:00:00Z',
  counters: {
    sightingsReported: 7,
    sightingsHelpful: 4,
    recoveriesCredited: 1,
  },
};
