/**
 * WHAT:  useTabAuthGate — the hold-and-sheet tabPress listener a guest-facing
 *        tab hands to <Tabs.Screen listeners={...}>. A member's press passes
 *        through untouched; anyone else has the press PREVENTED (so they stay
 *        on the tab they were already on) and the AuthSheet opened, with that
 *        tab as the gate's continuation — signing in lands there without a
 *        second tap.
 * WHY:   ⚠️ This is the sanctioned override of "tabs get invitations, sheets
 *        fire on actions" (features/auth/README.md), granted to the tabs that
 *        have nothing to show a guest BUT the invitation — Profile, and Inbox
 *        since 2026-08-06. It lives here, once, because the two copies had
 *        already started to differ, and the failure mode of a drifted copy is
 *        silent: the tab simply navigates and the guest reads an empty screen
 *        instead of the sheet. 'loading' standing gates too — the sheet
 *        watches standing and self-closes if the restoring session turns out
 *        to be a member, so a cold-start tap is never swallowed.
 *        The listener object is memoised because React Navigation reads it
 *        from the live render (expo-router's useNavigationBuilder looks up
 *        screens[name].props.listeners at emit time), so a fresh object per
 *        render is correct but needless.
 * LINKS: src/features/auth/gate/useRequireAuth.ts (the gate itself);
 *        src/app/(tabs)/_layout.tsx and src/features/profile/hooks/useProfileTab.ts
 *        (the two consumers); features/auth/README.md (the rule split).
 */

import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';

import { useAuthStanding } from '../hooks/useAuthStanding';
import type { GateContext } from './gateIntent';
import { useRequireAuth } from './useRequireAuth';

/** The slice of React Navigation's tabPress event the gate needs. */
export interface TabPressEvent {
  preventDefault: () => void;
}

/** Spread onto <Tabs.Screen listeners={...}>. */
export interface TabAuthGate {
  tabPress: (event: TabPressEvent) => void;
}

export interface TabAuthGateOptions {
  /** Which gate fired — drives the sheet title and the funnel logs. */
  context: GateContext;
  /** Where the continuation lands once auth completes. */
  route: Href;
}

/** Hold-and-sheet tabPress listeners for a guest-facing tab (see header). */
export function useTabAuthGate({ context, route }: TabAuthGateOptions): TabAuthGate {
  const standing = useAuthStanding();
  const requireAuth = useRequireAuth();
  const router = useRouter();

  return useMemo(
    () => ({
      tabPress: (event: TabPressEvent) => {
        if (standing === 'member') {
          return; // normal navigation
        }
        event.preventDefault();
        requireAuth({ context, run: () => router.navigate(route) });
      },
    }),
    [standing, requireAuth, router, context, route],
  );
}
