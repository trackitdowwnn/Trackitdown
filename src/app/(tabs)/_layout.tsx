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
 *        them. Profile AND Inbox (owner call, 2026-08-06) hold-and-sheet a
 *        guest's tap — both tabs have nothing to show a guest but an
 *        invitation, so the tap IS the action; their routes keep invitation
 *        screens for deep links (features/auth/README.md records the rule
 *        split). My Cars left the bar (2026-07-23): it's now a push
 *        from Profile (src/app/my-cars.tsx).
 * LINKS: src/shared/ui/AppTabBar.tsx; src/features/profile/hooks/useProfileTab.ts;
 *        docs/DESIGN_SYSTEM.md.
 */

import { Tabs, useRouter } from 'expo-router';
import { Bookmark, Compass, MessageCircle, Plus, User } from 'lucide-react-native';
import { useMemo } from 'react';

import { useRequireAuth, useTabAuthGate } from '@/features/auth';
import { useHasSavedCar } from '@/features/garage';
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

  // Inbox joined the hold-and-sheet override (owner call, 2026-08-06): like
  // Profile, a guest's Inbox has nothing to show but an invitation, so the tap
  // IS the action. Both tabs run the SAME gate (useTabAuthGate) — the two
  // hand-written copies this replaced could drift apart without anything
  // failing loudly. The route keeps its invitation screen for deep links.
  const inboxListeners = useTabAuthGate({
    context: 'tab_inbox',
    route: '/(tabs)/inbox',
  });

  // Where + goes: someone with cars in the garage picks one and gets the whole
  // vehicle phase prefilled; everyone else goes straight to the blank wizard.
  //
  // Resolved HERE, before the tap, so the decision costs nothing at the moment
  // of a theft — no spinner, no chooser that turns out to be empty. 'unknown'
  // (guest, still loading, failed fetch) means the blank wizard: the honest
  // default is the one that always works.
  //
  // `enabled` is true rather than gated on the nudge rules, because unlike
  // those this answer is needed for EVERY signed-in user. It is one
  // list_my_vehicles per app session (useHasSavedCar dedupes and caches it in
  // savedCarSignal), not one per mount of this layout.
  const savedCar = useHasSavedCar({ enabled: true });
  // ⚠️ ONLY A CONFIRMED 'none' SKIPS THE CHOOSER. This read
  // `savedCar === 'some' ? chooser : blank`, so 'unknown' went to the blank
  // wizard — and 'unknown' is exactly what a GUEST reports. The action below is
  // auth-gated, so the overwhelmingly common path is: guest taps +, signs in
  // through the sheet, and `run` fires with a route decided while they were
  // still signed out. Their saved cars were never offered, which is the bug
  // reported on 2026-08-22.
  //
  // The same read is wrong a second way even when signed in: the garage fetch
  // is in flight for a beat after sign-in, and 'unknown' during that window
  // sent people past their own cars.
  //
  // Sending 'unknown' to the chooser is safe BECAUSE THE CHOOSER SELF-CORRECTS:
  // with nothing offerable it replaces itself with /post-a-car (see
  // ChooseCarToReportScreen's `nothingToOffer`). So the worst case is a brief
  // spinner for someone who has no cars; the previous worst case was silently
  // withholding a feature from everyone who had just signed in.
  const startPostRoute = savedCar === 'none' ? '/post-a-car' : '/report-stolen';

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
            //
            // NO __DEV__ BYPASS. One lived here so the wizard could be opened
            // without signing in, and it made dev AND PREVIEW builds — the ones
            // testers use — let a guest walk all thirteen steps, upload photos,
            // and only fail at submit, where `create_post` raises
            // NOT_AUTHENTICATED with no sheet to recover through. It had also
            // started spreading (SaveYourCarSheet grew a workaround for it).
            // Seed a dev session instead of skipping the gate.
            onPress: () =>
              requireAuth({ context: 'post_car', run: () => router.push(startPostRoute) }),
          }}
        />
      )}
    >
      <Tabs.Screen name="explore" />
      <Tabs.Screen name="watchlist" />
      {/* Non-members: press prevented + AuthSheet, same as Profile below. */}
      <Tabs.Screen name="inbox" listeners={inboxListeners} />
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
