/**
 * WHAT:  Layout for the main tab group — wires Expo Router's Tabs to the
 *        shared AppTabBar with the app's tab config (Explore · My Cars ·
 *        Inbox · Profile) and hosts the badge provider.
 * WHY:   Route files stay thin (docs/ARCHITECTURE.md rule 3): everything
 *        here is declarative wiring — the APP_TABS array IS the app's tab
 *        set, so adding a tab is one entry plus one screen file. Badges
 *        (Inbox unread, My Cars activity) flow from TabBadgeProvider so any
 *        screen can set them.
 * LINKS: src/shared/ui/AppTabBar.tsx; docs/DESIGN_SYSTEM.md.
 */

import { Tabs, useRouter } from 'expo-router';
import { Car, Compass, MessageCircle, Plus, User } from 'lucide-react-native';

import {
  AppTabBar,
  type AppTabConfig,
  TabBadgeProvider,
  useTabBadges,
} from '@/shared/ui';

const APP_TABS: AppTabConfig[] = [
  { route: 'explore', label: 'Explore', icon: Compass },
  { route: 'my-cars', label: 'My cars', icon: Car, badgeKey: 'myCars' },
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
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => (
        <AppTabBar
          {...props}
          tabs={APP_TABS}
          badges={badges}
          action={{
            icon: Plus,
            accessibilityLabel: 'Report a stolen car',
            // Full-screen flow OUTSIDE the (tabs) group, so the tab bar is gone
            // for the wizard (AppTabBar's hide contract isn't even needed here).
            onPress: () => router.push('/post-a-car'),
          }}
        />
      )}
    >
      <Tabs.Screen name="explore" />
      <Tabs.Screen name="my-cars" />
      <Tabs.Screen name="inbox" />
      <Tabs.Screen name="profile" />
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
