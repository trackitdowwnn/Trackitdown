/**
 * WHAT:  ChatInboxScreen — the Inbox tab's signed-in content: filter chips
 *        (All · Unread · My cars · My sightings) over the thread list
 *        (FlashList of ThreadRows, newest activity first), skeleton rows
 *        while loading, per-filter empty states, pull-to-refresh, and an
 *        error state with retry. Guest handling stays in the route.
 * WHY:   Airbnb's 2024 inbox pillars, translated: one unified list with
 *        Unread as the workhorse chip, and their category filters becoming
 *        our owner-side/spotter-side split. Filtering is CLIENT-side over
 *        the loaded payload (inboxModel) — a chip must never cost a round
 *        trip. Refetch-on-focus (in useInbox) keeps rows and the tab badge
 *        honest at every glance — the v1 freshness mechanism. Skeletons are
 *        surfaceSubtle blocks (design system: no spinners on lists).
 *
 *        The chips row renders only when there ARE threads: a first-time
 *        user gets the plain invitation, not four filters over nothing. An
 *        empty FILTER keeps the chips visible (switching away must stay
 *        possible) with copy specific to what's empty — an empty Unread is
 *        good news and reads like it. The row SCROLLS rather than wraps
 *        (2026-08-05): four labels don't fit a phone, and the wrapped orphan
 *        read as broken layout — scrolling also pins the header height, so a
 *        growing count ("Unread (12)") can't shove the list down.
 * LINKS: src/features/chat/hooks/useInbox.ts; src/features/chat/lib/
 *        inboxModel.ts (filter maths + empty copy); src/features/chat/
 *        components/ThreadRow.tsx; src/app/(tabs)/inbox.tsx (route/guest).
 */

import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ReduceMotion } from 'react-native-reanimated';

import { useEntranceGate } from '@/shared/hooks';
import { motion, radii, sizes, spacing, useThemedStyles, type Palette } from '@/shared/theme';
import { ChoiceChips, EmptyState, ErrorState, ThemedRefreshControl } from '@/shared/ui';

import { ThreadRow } from '../components/ThreadRow';
import { useInbox } from '../hooks/useInbox';
import {
  INBOX_FILTERS,
  emptyFilterCopy,
  filterLabel,
  filterThreads,
  type InboxFilter,
} from '../lib/inboxModel';
import type { InboxThread } from '../types';

export function ChatInboxScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { status, threads, refreshing, refresh, retry } = useInbox();
  // Window opens when data is READY (not at mount, which is the skeleton
  // phase) so a slow load still gets the entrance; recycled cells don't.
  const entranceActive = useEntranceGate(status === 'ready');

  // Session-local, deliberately not persisted: a filter is a glance tool,
  // and reopening the app onto a stale "Unread" filter would read as a
  // half-empty inbox.
  const [filter, setFilter] = useState<InboxFilter>('all');
  const visible = useMemo(() => filterThreads(threads, filter), [threads, filter]);
  const chipOptions = useMemo(
    () => INBOX_FILTERS.map((value) => ({ value, label: filterLabel(value, threads) })),
    [threads],
  );

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

  // A truly empty inbox: the invitation, no chips — four filters over
  // nothing would be furniture.
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

  const empty = emptyFilterCopy(filter);

  return (
    <View style={styles.container}>
      {/* Scrollable, not wrapping: the four labels overflow a phone by ~20px,
          so "My sightings" used to drop to a second line as an orphan. The
          chips own the gutter themselves (full-bleed scroller), so this
          wrapper carries only the vertical rhythm. */}
      <View style={styles.chipsRow}>
        <ChoiceChips options={chipOptions} value={filter} onSelect={setFilter} scrollable />
      </View>
      {visible.length === 0 ? (
        // Chips stay mounted: the way OUT of an empty filter is the chips
        // themselves. keyed by filter so switching between two empty filters
        // still reads as a change.
        <Animated.View
          key={filter}
          style={styles.centered}
          entering={FadeIn.duration(motion.fast).reduceMotion(ReduceMotion.System)}
        >
          <EmptyState title={empty.title} body={empty.body} />
        </Animated.View>
      ) : (
        <FlashList
          data={visible}
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
            // ThemedRefreshControl, not a bare one: `tintColor` is iOS-only, so
            // the hand-rolled version pulled down a stock BLUE spinner on
            // Android in a monochrome app. The shared one sets `colors` too.
            <ThemedRefreshControl refreshing={refreshing} onRefresh={refresh} />
          }
          contentContainerStyle={styles.list}
          testID="inbox-list"
        />
      )}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
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
  chipsRow: {
    paddingBottom: spacing.sm,
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
