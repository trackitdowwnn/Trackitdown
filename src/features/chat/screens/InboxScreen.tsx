/**
 * WHAT:  ChatInboxScreen — the Inbox tab's signed-in content: the thread
 *        list (FlashList of ThreadRows, newest activity first) with
 *        skeleton rows while loading, a calm EmptyState when no
 *        conversations exist, pull-to-refresh, and an error state with
 *        retry. Guest handling stays in the route (existing gate).
 * WHY:   Refetch-on-focus (in useInbox) keeps rows and the tab badge honest
 *        at every glance — the v1 freshness mechanism. Skeletons are
 *        surfaceSubtle blocks (design system: no spinners on lists).
 * LINKS: src/features/chat/hooks/useInbox.ts; src/features/chat/components/
 *        ThreadRow.tsx; src/app/(tabs)/inbox.tsx (route + guest state).
 */

import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';

import { useEntranceGate } from '@/shared/hooks';
import { colors, motion, radii, sizes, spacing } from '@/shared/theme';
import { EmptyState, ErrorState } from '@/shared/ui';

import { ThreadRow } from '../components/ThreadRow';
import { useInbox } from '../hooks/useInbox';
import type { InboxThread } from '../types';

export function ChatInboxScreen() {
  const router = useRouter();
  const { status, threads, refreshing, refresh, retry } = useInbox();
  // Window opens when data is READY (not at mount, which is the skeleton
  // phase) so a slow load still gets the entrance; recycled cells don't.
  const entranceActive = useEntranceGate(status === 'ready');

  if (status === 'loading') {
    return (
      <View
        style={styles.container}
        testID="inbox-skeleton"
        accessibilityLabel="Loading conversations"
      >
        {[0, 1, 2].map((n) => (
          <View key={n} style={styles.skeletonRow}>
            <View style={styles.skeletonAvatar} />
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
          title="We couldn’t load your inbox"
          body="Check your connection and try again."
          onRetry={retry}
        />
      </View>
    );
  }

  if (threads.length === 0) {
    return (
      <View style={styles.centered}>
        <EmptyState
          title="No conversations yet"
          body="Conversations open when a spotter reports a sighting on your car — or when you report one."
        />
      </View>
    );
  }

  return (
    <FlashList
      data={threads}
      keyExtractor={(thread: InboxThread) => thread.threadId}
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
          <ThreadRow
            thread={item}
            onPress={(thread) => router.push(`/chat/${thread.threadId}`)}
          />
        </Animated.View>
      )}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
      }
      contentContainerStyle={styles.list}
      testID="inbox-list"
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: spacing.md,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.lg,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  list: {
    paddingVertical: spacing.sm,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  skeletonAvatar: {
    width: sizes.avatarMd,
    height: sizes.avatarMd,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceSubtle,
  },
  skeletonBody: {
    flex: 1,
    gap: spacing.sm,
  },
  skeletonLineWide: {
    height: sizes.skeletonLine,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    width: '70%',
  },
  skeletonLine: {
    height: sizes.skeletonLine,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
    width: '45%',
  },
});
