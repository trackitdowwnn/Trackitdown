/**
 * WHAT:  Layout for the main tab group — wires Expo Router's Tabs to the
 *        shared AppTabBar with the app's tab config (Explore · Watchlist ·
 *        Inbox · Profile) and hosts the badge provider. The
 *        Profile tab is
 *        dynamic: members see their avatar and "You"; a non-member's tap
 *        holds the current tab and opens the AuthSheet (useProfileTab).
 * WHY:   Route files stay thin (docs/ARCHITECTURE.md rule 3): everything
 *        here is declarative wiring — the APP_TABS array IS the app's tab
 *        set, so adding a tab is one entry plus one screen file. Badges
 *        (Inbox unread) flow from TabBadgeProvider so any screen can set
 *        them. The Profile-tab auth override is deliberate and Profile-only —
 *        Inbox keeps its invitation screen (features/auth/README.md records
 *        the rule split). My Cars left the bar (2026-07-23): it's now a push
 *        from Profile (src/app/my-cars.tsx).
 * LINKS: src/shared/ui/AppTabBar.tsx; src/features/profile/hooks/useProfileTab.ts;
 *        docs/DESIGN_SYSTEM.md.
 */

import { Tabs, useRouter } from 'expo-router';
import { Bookmark, Compass, MessageCircle, Plus, User } from 'lucide-react-native';
import { useMemo } from 'react';

import { useRequireAuth } from '@/features/auth';
import { useProfileTab } from '@/features/profile';
import {
  AppTabBar,
  type AppTabConfig,
  TabBadgeProvider,
  useTabBadges,
} from '@/shared/ui';

/** Static tabs; the Profile entry's label/iconUri are filled in per render. */
const BASE_TABS: AppTabConfig[] = [
  { route: 'explore', label: 'Explore', icon: Compass },
  // Watchlist earned the bar (product call 2026-07-22): vigilance wants the
  // list ambient. My cars moved to a Profile push (2026-07-23), so the four
  // tabs split 2/2 around the centre action button.
  { route: 'watchlist', label: 'Watchlist', icon: Bookmark },
  {
    route: 'inbox',
    label: 'Inbox',
    icon: MessageCircle,
    badgeKey: 'inbox',
    badgeLabel: (count) => `${count} unread`,
  },
  { route: 'profile', label: 'Profile', icon: User },
];

function BadgedTabs() {
  const { badges } = useTabBadges();
  const router = useRouter();
  const requireAuth = useRequireAuth();
  const profileTab = useProfileTab();

  // Session/avatar changes re-render this layout, so the tab bar reacts live:
  // sign-in flips "Profile" → "You", an EditProfile avatar save (shared
  // useMyProfile invalidation) swaps the icon without a restart.
  const tabs = useMemo(
    () =>
      BASE_TABS.map((tab) =>
        tab.route === 'profile'
          ? { ...tab, label: profileTab.label, iconUri: profileTab.iconUri }
          : tab,
      ),
    [profileTab.label, profileTab.iconUri],
  );

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => (
        <AppTabBar
          {...props}
          tabs={tabs}
          badges={badges}
          action={{
            icon: Plus,
            accessibilityLabel: 'Report a stolen car',
            // Gated: a guest signs in first (sheet), then the wizard opens
            // without re-tapping. Full-screen flow OUTSIDE the (tabs) group,
            // so the tab bar is gone for the wizard.
            onPress: () =>
              requireAuth({ context: 'post_car', run: () => router.push('/post-a-car') }),
          }}
        />
      )}
    >
      <Tabs.Screen name="explore" />
      <Tabs.Screen name="watchlist" />
      <Tabs.Screen name="inbox" />
      {/* Non-members: the press is prevented (stay on the current tab) and
          the AuthSheet opens — Profile-only override of the invitation rule. */}
      <Tabs.Screen name="profile" listeners={profileTab.listeners} />
    </Tabs>
  );
}

export default function TabsLayout() {
  return (
    <TabBadgeProvider>
      <BadgedTabs />
    </TabBadgeProvider>
  );
}
