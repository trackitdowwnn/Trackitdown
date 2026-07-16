/**
 * WHAT:  useProfileTab — everything the tab layout needs to render the Profile
 *        tab: the dynamic label ("You" for members, "Profile" otherwise), the
 *        avatar as the tab icon (null → the person icon stays), and tabPress
 *        listeners that hold-and-sheet a non-member (the press is prevented,
 *        the AuthSheet opens over the CURRENT tab, and signing in lands on
 *        Profile via the gate's continuation).
 * WHY:   ⚠️ Deliberate, Profile-only override of "tabs get invitations,
 *        sheets fire on actions" (features/auth/README.md): a guest's Profile
 *        tab has nothing to show but the invitation, so the tap IS the action.
 *        My Cars and Inbox keep their invitation screens. One boundary —
 *        standing 'member' — drives label, icon AND tap, so 'incomplete'
 *        (orphaned session) reads as signed-out here; its tap opens the sheet
 *        at the first-name step, exactly like every other gate. Avatar
 *        liveness: useMyProfile's shared invalidation re-renders this hook on
 *        any profile save, and the URL itself is cache-busted by updated_at,
 *        so a replaced photo can't be served stale by expo-image.
 * LINKS: src/app/(tabs)/_layout.tsx (consumer); src/shared/ui/AppTabBar.tsx
 *        (iconUri contract); src/features/auth/gate/useRequireAuth.ts.
 */

import { useRouter } from 'expo-router';
import { useMemo } from 'react';

import { useAuthStanding, useRequireAuth } from '@/features/auth';

import { useMyProfile } from './useMyProfile';

/** The slice of React Navigation's tabPress event the gate needs. */
interface TabPressEvent {
  preventDefault: () => void;
}

export interface ProfileTabState {
  /** Members are greeted as "You"; everyone else sees the neutral "Profile". */
  label: string;
  /** The member's avatar for the tab icon; null keeps the person icon. */
  iconUri: string | null;
  /** Spread onto <Tabs.Screen name="profile" listeners={...}>. */
  listeners: { tabPress: (event: TabPressEvent) => void };
}

/** Label, icon URI, and tabPress listeners for the Profile tab (see header). */
export function useProfileTab(): ProfileTabState {
  const standing = useAuthStanding();
  const profileState = useMyProfile();
  const requireAuth = useRequireAuth();
  const router = useRouter();

  const isMember = standing === 'member';
  const iconUri =
    isMember && profileState.status === 'ready' ? profileState.profile.avatarUrl : null;

  return useMemo(
    () => ({
      label: isMember ? 'You' : 'Profile',
      iconUri,
      listeners: {
        tabPress: (event: TabPressEvent) => {
          if (isMember) {
            return; // normal navigation
          }
          // Hold-and-sheet: don't switch tabs — the sheet opens over where the
          // guest already is, and dismissal leaves them exactly there. A
          // 'loading' press is safe too: the sheet self-resolves the moment a
          // restoring session turns out to be a member, then the intent runs.
          event.preventDefault();
          requireAuth({
            context: 'tab_profile',
            run: () => router.navigate('/(tabs)/profile'),
          });
        },
      },
    }),
    [isMember, iconUri, requireAuth, router],
  );
}
