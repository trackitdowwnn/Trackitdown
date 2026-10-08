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

import { Tabs, useSegments } from 'expo-router';
import { Bookmark, Compass, MessageCircle, Plus, User } from 'lucide-react-native';
import { useMemo } from 'react';

import { useRequireAuth, useTabAuthGate } from '@/features/auth';
import { useInboxBadgeSync } from '@/features/chat';
import { useHasSavedCar, useStartReport } from '@/features/garage';
import { useProfileTab, useTrackVisitedTab } from '@/features/profile';
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
  // The Inbox badge from app start, not from the first visit to the Inbox —
  // tabs mount lazily, and the Inbox's own hooks were its only reporters.
  useInboxBadgeSync();
  // Remembers which TAB is active so the bug reporter can pre-select the right
  // area. ⚠️ The TAB NAME only — never the pathname, which can be /post/<id>
  // and would tie a bug report to one specific stolen car. See
  // features/profile/lib/lastArea.ts, which refuses anything it does not
  // recognise.
  const segments = useSegments();
  useTrackVisitedTab(segments[segments.length - 1]);

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

  // ONE way into a report (2026-10-07): the + always opens /post-a-car, whose
  // host shows the blank form, the "Which car?" chooser or the prefilled form
  // IN PLACE. The old split — decide a route here, push a chooser route that
  // then replaced itself with the form — meant two full-screen transitions
  // back to back. useStartReport instead waits (briefly, bounded) for the
  // garage answer and the saved draft, so the form slides up already built.
  //
  // This call is the WARM-UP: it fetches the garage once per session, as soon
  // as a signed-in user is on the tabs, so by the time + is tapped the answer
  // is usually already cached and the wait is zero. One list_my_vehicles per
  // app session (loadGarage dedupes it), not one per mount of this layout.
  useHasSavedCar({ enabled: true });
  const startReport = useStartReport();

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
              requireAuth({ context: 'post_car', run: startReport }),
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
