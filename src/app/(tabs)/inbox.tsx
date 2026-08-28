/**
 * WHAT:  Inbox tab — guest-aware route hosting the tab's TWO faces behind a
 *        segment control: Messages (features/chat) and Notifications
 *        (features/notifications). Remembers the last-viewed segment, and
 *        keeps BOTH faces mounted so switching between them costs nothing.
 * WHY:   The Airbnb inbox pattern: one tab, one badge (chat unread + center
 *        unread, summed by the inboxBadge aggregator), two segments. THIS
 *        ROUTE is the composition point on purpose — chat and notifications
 *        must not import each other's screens (chat already imports the
 *        notifications barrel for its send path, so the reverse import would
 *        close a require cycle), and a route may import both.
 *
 *        ⚠️ THE HIDDEN-HALF SYNC IS GONE (2026-08-28) and its premise with it.
 *        This file used to re-read the hidden face's unread count on every
 *        focus, because only the VISIBLE face mounted and an unmounted hook
 *        cannot report its own half. Both faces are mounted now, each hook
 *        reports itself, and `inboxBadge` sums them — so the manual mirror was
 *        a second source of truth and one extra round trip per focus.
 *
 *        ⚠️ The segment control is SurfaceTabs — underline tabs, deliberately
 *        a different grammar from the filter chips inside the Messages face.
 *        (This comment said ChoiceChips for months after the pill track was
 *        replaced; the inline comment below has always been right.)
 *
 *        Guests get the same friendly invitation as before: tabs never wall or
 *        auto-fire the auth sheet (deferred auth).
 * LINKS: src/features/chat (ChatInboxScreen);
 *        src/features/notifications/screens/NotificationCenterScreen.tsx,
 *        lib/inboxSegmentStorage.ts;
 *        src/features/notifications/lib/inboxBadge.ts (the aggregator both
 *        faces report into); docs/design-refs/inbox/.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRequireAuth, useSession } from '@/features/auth';
import { ChatInboxScreen } from '@/features/chat';
import {
  loadInboxSegment,
  saveInboxSegment,
  type InboxSegment,
} from '@/features/notifications/lib/inboxSegmentStorage';
import { NotificationCenterScreen } from '@/features/notifications/screens/NotificationCenterScreen';
import { spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { EmptyState, SurfaceTabs } from '@/shared/ui';

const SEGMENTS: { value: InboxSegment; label: string }[] = [
  { value: 'messages', label: 'Messages' },
  { value: 'notifications', label: 'Notifications' },
];

export default function InboxRoute() {
  const styles = useThemedStyles(makeStyles);
  const session = useSession();
  const requireAuth = useRequireAuth();
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

  // ⚠️ THE HIDDEN-HALF SYNC IS GONE (2026-08-28), and its absence is the point.
  // It existed because only the visible face MOUNTED, so the hidden one could
  // not report its own unread count and the route re-fetched it by hand on
  // every focus. Both faces are now mounted, `useInbox` and
  // `useNotificationCenter` each report their own half, and `inboxBadge` sums
  // them — so the hand-maintained mirror was one extra round trip per focus
  // and a second place for the badge to be wrong.

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
      {/* ⚠️ BOTH FACES STAY MOUNTED; the inactive one is hidden, not unmounted.
          A ternary here meant switching segments destroyed the other list —
          scroll position gone, data refetched, entrance animation replayed
          every single time, which made a two-tab screen feel like two screens.

          OPACITY, NOT `display: 'none'`. Setting display collapses the hidden
          face to 0×0 in Yoga, so its FlashList measures an empty viewport,
          drops its rendered window and has to re-measure on reveal — the blank
          first frame this change exists to remove, plus the scroll offset at
          risk. Opacity keeps the subtree laid out, so the switch is a hard cut.

          ⚠️ BOTH a11y PROPS ARE REQUIRED, and this is the likeliest bug to
          ship unnoticed: `accessibilityElementsHidden` is iOS-only and
          `importantForAccessibility` is Android-only, so omitting either leaves
          the hidden list fully reachable by that platform's screen reader while
          looking perfect to a sighted reviewer. Test with VoiceOver AND
          TalkBack.

          The cost, stated: both hooks now load on every inbox open, so the tab
          costs two RPCs instead of one-and-a-count. And the hidden face spends
          its entrance animation while invisible — a Messages-first user will
          never see the Notifications list animate in. Accepted deliberately. */}
      <View style={styles.faces}>
        <Face active={segment === 'messages'}>
          <ChatInboxScreen />
        </Face>
        <Face active={segment === 'notifications'}>
          <NotificationCenterScreen active={segment === 'notifications'} />
        </Face>
      </View>
    </SafeAreaView>
  );
}

/**
 * One inbox face, kept mounted whether or not it is the one being looked at.
 *
 * Local to this route on purpose: there is exactly one segment host in the app,
 * and ARCHITECTURE prefers feature-local until a second consumer turns up.
 */
function Face({ active, children }: { active: boolean; children: ReactNode }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View
      style={[styles.face, !active && styles.faceHidden]}
      pointerEvents={active ? 'auto' : 'none'}
      // iOS
      accessibilityElementsHidden={!active}
      // Android
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
    >
      {children}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  faces: {
    flex: 1,
  },
  face: {
    ...StyleSheet.absoluteFill,
  },
  faceHidden: {
    opacity: 0,
    // Belt and braces: parent `pointerEvents` has historically been unreliable
    // on Android, and a fully-laid-out invisible list must not catch a touch.
    zIndex: -1,
  },
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
