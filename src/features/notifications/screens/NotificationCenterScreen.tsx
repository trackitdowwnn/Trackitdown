/**
 * WHAT:  NotificationCenterScreen — the Inbox tab's second face: the
 *        persistent feed of everything notification-worthy, newest first, in
 *        one flat list, with "Mark all as read" and tap-through to each row's
 *        destination.
 * WHY:   Pushes were fire-and-forget; this is where they stop disappearing.
 *        Behaviour rules (Airbnb's, adopted): opening the segment NEVER
 *        auto-marks-read — unread is the user's to clear, by tap or the one
 *        header affordance; freshness is refetch-on-focus + pull-to-refresh
 *        (chat's documented inbox choice, mirrored in the hook); the tap
 *        routes through parsePushPayload → pushRouteFor, the exact tested
 *        machinery pushes use, so a row and its push can never land in
 *        different places.
 * LINKS: ../hooks/useNotificationCenter.ts; ../components/NotificationRowItem;
 *        ../lib/pushRoute.ts; src/app/(tabs)/inbox.tsx
 *        (the segment host); docs/decisions/ADR-0012-notification-center.md.
 */

import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';

import { useEntranceGate } from '@/shared/hooks';
import { createLogger } from '@/shared/lib/logger';
import { motion, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import {
  EmptyState,
  ErrorState,
  ThemedRefreshControl,
} from '@/shared/ui';

import type { NotificationRow } from '../api/notificationsApi';
import { NotificationRowItem, NotificationRowSkeleton } from '../components/NotificationRowItem';
import { useNotificationCenter } from '../hooks/useNotificationCenter';
import { pushRouteFor } from '../lib/pushRoute';

const log = createLogger('notifications');

export interface NotificationCenterScreenProps {
  /**
   * Whether this face is the one on screen. The inbox mounts both and hides
   * one, so "mounted" and "visible" are no longer the same thing — see the
   * `center_view` effect below. Defaults true for any other consumer.
   */
  active?: boolean;
}

export function NotificationCenterScreen({ active = true }: NotificationCenterScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { status, rows, refreshing, markRead, markAllRead, refresh, retry } =
    useNotificationCenter();
  // Same entrance the Messages face uses — the two faces move the same way.
  const entranceActive = useEntranceGate(status === 'ready');

  // The funnel's entry point: how often the center is even LOOKED AT.
  //
  // ⚠️ ON THE false → true EDGE, not on mount. The inbox keeps both faces
  // mounted (2026-08-28) so switching segments doesn't lose scroll — which
  // means mounting no longer implies being seen. Left on mount, this would
  // have fired for every user who opened the tab and never left Messages, and
  // quietly turned the metric into "opened the inbox".
  //
  // The metric therefore changes meaning as of that date: per-VIEW, not
  // per-mount. Numbers before and after are not comparable.
  const wasActive = useRef(false);
  useEffect(() => {
    if (active && !wasActive.current) log.info('center_view');
    wasActive.current = active;
  }, [active]);

  // Flat: the rows themselves, newest first. No day grouping since 2026-09-04.
  const items = rows;
  const hasUnread = rows.some((row) => row.readAt === null);

  const onRowPress = (row: NotificationRow) => {
    markRead(row.id);
    // Tap-through by kind: the number that tells us which notifications earn
    // their existence (feeds volume-cap tuning). Ids only, never content.
    log.info('notification_tap', { kind: row.kind });
    if (row.payload) {
      router.push(pushRouteFor(row.payload));
    }
    // A row whose payload no longer parses (schema moved on) still marks
    // read; it just has nowhere to go — better than routing somewhere wrong.
  };

  if (status === 'loading') {
    return (
      <View style={styles.container} testID="center-skeleton" accessibilityLabel="Loading notifications">
        {/* No day header any more — the real list leads with a row, so the
            skeleton does too. */}
        {[0, 1, 2, 3].map((n) => (
          <NotificationRowSkeleton key={n} />
        ))}
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.centered}>
        <ErrorState
          title="We couldn’t load your notifications"
          body="Check your connection and try again."
          onRetry={retry}
        />
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View style={styles.centered}>
        <EmptyState
          title="Nothing yet"
          body="Alerts, sightings and payout updates will land here."
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* ⚠️ "Mark all as read" LOST ITS HOME ON 2026-09-04 and this is the
          third one it has had. The day headers went (flat list, owner's call)
          and it had been riding the first header's line, which needed no band
          because the header was always there.

          The two remaining options are both ones this screen has already
          rejected, and the old note ranked them: a row rendered only while
          there is something to mark JUMPS when you clear the last unread; a
          permanently reserved row is dead space on every visit, since most of
          the time there is nothing unread. Its own words — "a jump happens
          once, on a tap you chose; dead space is there every time you open the
          tab" — pick the first, so that is what it goes back to.

          Two things soften it against the version that was rejected: the strip
          is a caption action rather than a 52pt band, so the collapse is ~32pt
          not 52; and it sits ABOVE the scroll rather than inside it, so the
          list's own offset never changes underneath a reader mid-scroll. */}
      {hasUnread ? (
        <View style={styles.markAllRow}>
          <Pressable
            onPress={markAllRead}
            accessibilityRole="button"
            hitSlop={spacing.md}
            style={({ pressed }) => pressed && styles.markAllPressed}
            testID="mark-all-read"
          >
            <Text style={styles.markAllLabel}>Mark all as read</Text>
          </Pressable>
        </View>
      ) : null}
      {/* ⚠️ FLAT SINCE 2026-09-04, matching the Messages face. Both lists
          dropped their day grouping together, which is what keeps "one tab,
          one vocabulary" true — the rule was never "both must group", it was
          "both must do the same thing", and each row's own `formatListStamp`
          now carries the day the header used to.

          `getItemType` went with the headers: it was mandatory while ~38pt
          headers recycled into ~106pt rows, and there is one cell type now. */}
      <FlashList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <Animated.View
            entering={
              entranceActive
                ? FadeInDown.duration(motion.standard)
                    .delay(Math.min(index, 6) * motion.listStagger)
                    .reduceMotion(ReduceMotion.System)
                : undefined
            }
          >
            <NotificationRowItem row={item} onPress={onRowPress} />
          </Animated.View>
        )}
        refreshControl={
          // ThemedRefreshControl, not a bare one: `tintColor` is iOS-only, so
          // the hand-rolled version pulled down a stock BLUE spinner on
          // Android in a monochrome app. The shared one sets `colors` too.
          <ThemedRefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
        contentContainerStyle={styles.list}
        testID="center-list"
      />
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  container: {
    flex: 1,
    // Matches the Messages face — switching segments must not shift where
    // content starts.
    paddingTop: spacing.md,
  },
  // ⚠️ NO PADDING OF ITS OWN — see the Messages face's copy of this comment.
  // EmptyState/ErrorState pad themselves; this added a second 24 per side.
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // A caption-height strip, not a band: it appears and disappears with the
  // unread state, so its collapse must cost as little as possible.
  markAllRow: {
    alignItems: 'flex-end',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  markAllPressed: {
    opacity: 0.6,
  },
  markAllLabel: {
    ...typography.label,
    color: c.textPrimary,
    textDecorationLine: 'underline',
  },
  // The row skeleton lives in NotificationRowItem (it shares the row's own
  // styles, so the two cannot drift the way this hand-copied block had). The
  // day label that used to be named here went with the grouping on 2026-09-04;
  // `shared/ui/DayHeader` still exists and is still used by MySightingsScreen.
  list: {
    paddingBottom: spacing.xl,
  },
});
