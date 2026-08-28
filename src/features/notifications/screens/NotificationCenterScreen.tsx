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
import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';

import { useEntranceGate } from '@/shared/hooks';
import { groupByDay } from '@/shared/lib';
import { createLogger } from '@/shared/lib/logger';
import {
  motion,
  radii,
  sizes,
  spacing,
  typography,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { EmptyState, ErrorState, ThemedRefreshControl } from '@/shared/ui';

import type { NotificationRow } from '../api/notificationsApi';
import { NotificationRowItem } from '../components/NotificationRowItem';
import { useNotificationCenter } from '../hooks/useNotificationCenter';
import { pushRouteFor } from '../lib/pushRoute';

const log = createLogger('notifications');

export function NotificationCenterScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { status, rows, refreshing, markRead, markAllRead, refresh, retry } =
    useNotificationCenter();
  // Same entrance the Messages face uses — the two faces move the same way.
  const entranceActive = useEntranceGate(status === 'ready');

  // The funnel's entry point: how often the center is even looked at.
  useEffect(() => {
    log.info('center_view');
  }, []);

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
        {[0, 1, 2].map((n) => (
          <View key={n} style={styles.skeletonRow}>
            <View style={styles.skeletonCircle} />
            <View style={styles.skeletonBody}>
              <View style={styles.skeletonLineWide} />
              <View style={styles.skeletonLine} />
            </View>
          </View>
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
      {/* The one header affordance. Rendered only while it can DO something —
          a permanent disabled "mark all" is furniture. */}
      {hasUnread ? (
        <View style={styles.headerRow}>
          <Pressable
            onPress={markAllRead}
            accessibilityRole="button"
            style={({ pressed }) => [styles.markAll, pressed && styles.markAllPressed]}
            testID="mark-all-read"
          >
            <Text style={styles.markAllLabel}>Mark all as read</Text>
          </Pressable>
        </View>
      ) : null}
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
              <Text style={styles.dayHeader} accessibilityRole="header">
                {item.label}
              </Text>
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
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  // Same vertical rhythm as the Messages face's chip row (44pt control +
  // spacing.sm), so switching tabs doesn't shift where the list starts.
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  markAll: {
    minHeight: sizes.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  markAllPressed: {
    opacity: 0.6,
  },
  markAllLabel: {
    ...typography.label,
    color: c.textPrimary,
    textDecorationLine: 'underline',
  },
  // Sentence case, no tracking — the label scale carries the hierarchy
  // (ALL CAPS is reserved for number plates, design system rule).
  dayHeader: {
    ...typography.label,
    color: c.textSecondary,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  list: {
    paddingBottom: spacing.xl,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  skeletonCircle: {
    width: sizes.avatarMd,
    height: sizes.avatarMd,
    borderRadius: radii.full,
    backgroundColor: c.surfaceSubtle,
  },
  skeletonBody: {
    flex: 1,
    gap: spacing.sm,
  },
  skeletonLineWide: {
    height: sizes.skeletonLine,
    borderRadius: radii.sm,
    backgroundColor: c.surfaceSubtle,
    width: '70%',
  },
  skeletonLine: {
    height: sizes.skeletonLine,
    borderRadius: radii.sm,
    backgroundColor: c.surfaceSubtle,
    width: '45%',
  },
});
