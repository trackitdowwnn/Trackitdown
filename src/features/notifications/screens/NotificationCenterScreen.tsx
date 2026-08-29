/**
 * WHAT:  NotificationCenterScreen — the Inbox tab's second face: the
 *        persistent feed of everything notification-worthy, newest first,
 *        day-grouped, with "Mark all as read" and tap-through to each row's
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
 *        @/shared/lib (groupByDay); ../lib/pushRoute.ts; src/app/(tabs)/inbox.tsx
 *        (the segment host); docs/decisions/ADR-0012-notification-center.md.
 */

import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';

import { useEntranceGate } from '@/shared/hooks';
import { groupByDay } from '@/shared/lib';
import { createLogger } from '@/shared/lib/logger';
import { motion, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import {
  DayHeader,
  DayHeaderSkeleton,
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

  const items = useMemo(() => groupByDay(rows), [rows]);
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
        {/* A day header leads the real list, so one leads the skeleton — a bar
            rather than the word, because the newest notification usually is not
            from today. */}
        <DayHeaderSkeleton />
        {[0, 1, 2].map((n) => (
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
      {/* ⚠️ NO HEADER BAND. "Mark all as read" rides on the first day header's
          own line (below) instead of owning a row.

          It had a row of its own, rendered only while there was something to
          mark — so clearing the last unread collapsed 52pt and yanked the list
          under the reader's thumb. Reserving that height permanently fixed the
          jump and replaced it with something worse: 52pt of nothing at the top
          of the list on every single visit, since most of the time there IS
          nothing unread. A jump happens once, on a tap you chose; dead space
          is there every time you open the tab.

          On the header's line, the action needs no band, and the header is
          always present — so nothing moves whether the action is there or
          not. */}
      <FlashList
        data={items}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.type}
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
            {item.type === 'header' ? (
              <DayHeader
                label={item.label}
                // Only the first header carries it, and only while there is
                // something to mark. hitSlop, not a taller box: the touch
                // target reaches 44 without the header growing.
                trailing={
                  index === 0 && hasUnread ? (
                    <Pressable
                      onPress={markAllRead}
                      accessibilityRole="button"
                      hitSlop={spacing.md}
                      style={({ pressed }) => pressed && styles.markAllPressed}
                      testID="mark-all-read"
                    >
                      <Text style={styles.markAllLabel}>Mark all as read</Text>
                    </Pressable>
                  ) : undefined
                }
              />
            ) : (
              <NotificationRowItem row={item.row} onPress={onRowPress} />
            )}
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
  markAllPressed: {
    opacity: 0.6,
  },
  markAllLabel: {
    ...typography.label,
    color: c.textPrimary,
    textDecorationLine: 'underline',
  },
  // The day label and the row skeleton both moved out — to shared/ui's
  // DayHeader (three lists group by day now) and to NotificationRowItem's own
  // NotificationRowSkeleton (which shares the row's styles, so the two cannot
  // drift the way this hand-copied block had).
  list: {
    paddingBottom: spacing.xl,
  },
});
