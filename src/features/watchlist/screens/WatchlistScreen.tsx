/**
 * WHAT:  WatchlistScreen — the Watchlist tab: watched posts as standard
 *        VehicleCards (newest watch first, toggle in the card corner
 *        removes), then a quiet "No longer active" section of resolved
 *        watches (recovered cards + tombstones) inside their 30-day window.
 *        Warm empty state inviting the first bookmark; error state retries.
 * WHY:   One list in v1 (named lists are ROADMAP-deferred). Removal is the
 *        toggle itself — no swipe convention exists in this app and the
 *        watchlist doesn't invent one. Resolved entries keep their
 *        StatusBadge: learning the outcome is the section's whole job.
 *        Guests see the invitation instantly (useWatchlist returns empty,
 *        never an error, signed out).
 * LINKS: src/features/watchlist/README.md (spec);
 *        hooks/useWatchlist.ts (grouping rules);
 *        components/{WatchToggle,WatchlistTombstoneRow}.tsx.
 */

import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { createLogger } from '@/shared/lib/logger';
import { colors, spacing, typography } from '@/shared/theme';
import {
  EmptyState,
  ErrorState,
  Screen,
  SkeletonVehicleCard,
  ThemedRefreshControl,
  VehicleCard,
} from '@/shared/ui';

import { WatchToggle } from '../components/WatchToggle';
import { WatchlistTombstoneRow } from '../components/WatchlistTombstoneRow';
import { useWatchlist } from '../hooks/useWatchlist';
import { useIsWatched } from '../lib/watchedStore';
import type { WatchlistEntry, WatchedPost } from '../types';

const log = createLogger('watchlist');

/** One watched card. Toggle-to-remove: when THIS session unwatches the post
 *  (watched flips true→false after mount), the row leaves the list — but an
 *  unhydrated store (watched false throughout) never hides anything. */
function WatchedCardRow({ entry, onPress }: { entry: WatchedPost; onPress: () => void }) {
  const watched = useIsWatched(entry.post.id);
  // Render-phase state adjustment (house pattern — see VehicleCard's
  // carousel reset): remember that the store confirmed this row watched.
  const [everWatched, setEverWatched] = useState(watched);
  if (watched && !everWatched) {
    setEverWatched(true);
  }
  if (everWatched && !watched) {
    return null;
  }
  return (
    <View style={[styles.rowGutter, styles.cardRow]}>
      <VehicleCard
        post={entry.post}
        onPress={onPress}
        topRightAction={<WatchToggle postId={entry.post.id} source="watchlist" />}
      />
    </View>
  );
}

/** Flattened list rows: entries + the one section divider. */
type Row =
  | { type: 'entry'; key: string; entry: WatchlistEntry }
  | { type: 'resolvedHeader'; key: 'resolved_header' };

export function WatchlistScreen() {
  const router = useRouter();
  const { status, active, resolved, refreshing, refresh, retry } = useWatchlist();

  const rows = useMemo<Row[]>(() => {
    const entryKey = (entry: WatchlistEntry) =>
      entry.kind === 'post' ? entry.post.id : entry.postId;
    const items: Row[] = active.map((entry) => ({
      type: 'entry',
      key: entryKey(entry),
      entry,
    }));
    if (resolved.length > 0) {
      items.push({ type: 'resolvedHeader', key: 'resolved_header' });
      items.push(
        ...resolved.map(
          (entry): Row => ({ type: 'entry', key: entryKey(entry), entry }),
        ),
      );
    }
    return items;
  }, [active, resolved]);

  // Screen-view funnel: how many people look, and at how much.
  const count = active.length + resolved.length;
  useEffect(() => {
    if (status === 'ready') {
      log.info('watchlist_view', { count });
    }
    // Log per landing, not per count change while sat on the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const renderRow = useCallback(
    ({ item }: { item: Row }) => {
      if (item.type === 'resolvedHeader') {
        return (
          <Text accessibilityRole="header" style={styles.resolvedHeader}>
            No longer active
          </Text>
        );
      }
      if (item.entry.kind === 'tombstone') {
        return (
          <View style={styles.rowGutter}>
            <WatchlistTombstoneRow entry={item.entry} />
          </View>
        );
      }
      const entry = item.entry;
      return (
        <WatchedCardRow entry={entry} onPress={() => router.push(`/post/${entry.post.id}`)} />
      );
    },
    [router],
  );

  return (
    <Screen>
      {/* The title lives OUTSIDE the state branch — loading, error, and
          empty states keep the screen's identity (ui review 2026-07-22). */}
      <Text accessibilityRole="header" style={styles.title}>
        Watchlist
      </Text>
      {status === 'loading' ? (
        <View style={styles.skeletons}>
          <SkeletonVehicleCard />
          <SkeletonVehicleCard />
        </View>
      ) : status === 'error' ? (
        <ErrorState body="We couldn't load your watchlist." onRetry={retry} />
      ) : count === 0 ? (
        <EmptyState
          title="Keeping an eye out"
          body="Tap the bookmark on any post to follow it here."
          actionLabel="Explore posts"
          onAction={() => router.push('/(tabs)/explore')}
        />
      ) : (
        <FlatList
          data={rows}
          renderItem={renderRow}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <ThemedRefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.title,
    color: colors.textPrimary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  skeletons: {
    padding: spacing.lg,
    gap: spacing.xl,
  },
  listContent: {
    // Breathing room above the tab bar for the last card.
    paddingBottom: spacing.xl,
  },
  // Feed gutter: 16 per the DESIGN_SYSTEM feed-surface exception.
  rowGutter: {
    paddingHorizontal: spacing.lg,
  },
  cardRow: {
    marginBottom: spacing.xl,
  },
  resolvedHeader: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
});
