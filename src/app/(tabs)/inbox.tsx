/**
 * WHAT:  Inbox tab — guest-aware route hosting the tab's TWO faces behind a
 *        segment control: Messages (features/chat) and Notifications
 *        (features/notifications). Remembers the last-viewed segment, and on
 *        every focus re-reads the HIDDEN face's unread count so the one tab
 *        badge stays the honest sum.
 * WHY:   The Airbnb inbox pattern: one tab, one badge (chat unread + center
 *        unread, summed by the inboxBadge aggregator), two segments. THIS
 *        ROUTE is the composition point on purpose — chat and notifications
 *        must not import each other's screens (chat already imports the
 *        notifications barrel for its send path, so the reverse import would
 *        close a require cycle), and a route may import both.
 *
 *        THE HIDDEN-HALF SYNC IS LOAD-BEARING: each screen's hook reports its
 *        own unread half, but only the visible screen MOUNTS — without this
 *        sync a messages-segment user's badge would never include center
 *        unread at all (the exact users the center exists for). The segment
 *        control is ChoiceChips — the house chip styling IS the segment
 *        styling. Guests get the same friendly invitation as before: tabs
 *        never wall or auto-fire the auth sheet (deferred auth).
 * LINKS: src/features/chat (ChatInboxScreen, fetchInbox, totalUnread);
 *        src/features/notifications/screens/NotificationCenterScreen.tsx,
 *        lib/inboxSegmentStorage.ts, api/notificationsApi.ts (imported by
 *        module path — the notifications barrel is deliberately light, see
 *        its footer); src/features/notifications/lib/inboxBadge.ts.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRequireAuth, useSession } from '@/features/auth';
import { ChatInboxScreen, fetchInbox, totalUnread } from '@/features/chat';
import { reportInboxBadge } from '@/features/notifications';
import { fetchUnreadNotificationsCount } from '@/features/notifications/api/notificationsApi';
import {
  loadInboxSegment,
  saveInboxSegment,
  type InboxSegment,
} from '@/features/notifications/lib/inboxSegmentStorage';
import { NotificationCenterScreen } from '@/features/notifications/screens/NotificationCenterScreen';
import { spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { EmptyState, SurfaceTabs, useTabBadges } from '@/shared/ui';

const SEGMENTS: { value: InboxSegment; label: string }[] = [
  { value: 'messages', label: 'Messages' },
  { value: 'notifications', label: 'Notifications' },
];

export default function InboxRoute() {
  const styles = useThemedStyles(makeStyles);
  const session = useSession();
  const requireAuth = useRequireAuth();
  const { setBadge } = useTabBadges();
  const [segment, setSegment] = useState<InboxSegment>('messages');
  // The restore must never overwrite a choice the user already made while
  // storage was still answering.
  const userChose = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void loadInboxSegment().then((remembered) => {
      if (!cancelled && !userChose.current) setSegment(remembered);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onSelectSegment = (next: InboxSegment) => {
    userChose.current = true;
    setSegment(next);
    void saveInboxSegment(next); // fail-soft — a lost write costs one default
  };

  // THE HIDDEN-HALF SYNC: the visible screen's hook reports its own half; the
  // unmounted one cannot, so the route re-reads it on every focus. Best-effort
  // — a failed sync leaves the last honest value standing.
  const signedIn = session.status !== 'signedOut';
  useFocusEffect(
    useCallback(() => {
      if (!signedIn) return;
      let cancelled = false;
      void (async () => {
        try {
          if (segment === 'messages') {
            const centerUnread = await fetchUnreadNotificationsCount();
            if (!cancelled) setBadge('inbox', reportInboxBadge('center', centerUnread));
          } else {
            const threads = await fetchInbox();
            if (!cancelled) setBadge('inbox', reportInboxBadge('chat', totalUnread(threads)));
          }
        } catch {
          // badge sync only — never surfaces
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [segment, setBadge, signedIn]),
  );

  if (session.status === 'signedOut') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <EmptyState
          title="Your messages and updates live here"
          body="Chat with owners and spotters about sightings, and catch every alert and payout update — all in one place."
          actionLabel="Log in"
          // No continuation: the tab re-renders signed-in reactively.
          onAction={() => requireAuth({ context: 'tab_inbox' })}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Title, then the surface switch, then the hairline that ends the
          chrome — and nothing else. The switch is UNDERLINE TABS, deliberately
          a different grammar from the filter chips inside the Messages face:
          chips filter a list, tabs choose a surface, and when both were pill
          rows the top of this screen read as one confusing band. SurfaceTabs
          is full-bleed (it owns its own gutter) so its rule reaches both
          edges — hence the title, not the tabs, carries the padding here. */}
      <View style={styles.titleRow}>
        <Text style={styles.screenTitle} accessibilityRole="header">
          Inbox
        </Text>
      </View>
      <SurfaceTabs options={SEGMENTS} value={segment} onSelect={onSelectSegment} />
      {segment === 'messages' ? <ChatInboxScreen /> : <NotificationCenterScreen />}
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  titleRow: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  screenTitle: {
    ...typography.title,
    color: c.textPrimary,
  },
});
