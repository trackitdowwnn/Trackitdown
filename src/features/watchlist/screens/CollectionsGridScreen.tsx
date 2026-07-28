/**
 * WHAT:  CollectionsGridScreen — the Watchlist tab: a two-column grid of the
 *        user's lists (the implicit "Saved" bucket plus any they named), each
 *        opening onto its own screen.
 * WHY:   One flat list stopped being enough once a spotter watches more than a
 *        handful of cars; grouping by where they'd actually see them ("My
 *        commute") is what makes a long watchlist usable. The grid is derived
 *        from the SAME single payload the old list used — no second round trip,
 *        and no way for a tile's count to disagree with what it opens onto.
 *
 *        Guests keep the invitation they had (useWatchlist is empty, never an
 *        error, signed out), and someone with nothing saved sees the same warm
 *        empty state as before rather than a grid of one empty tile.
 * LINKS: src/features/watchlist/lib/collectionsModel.ts (the rules);
 *        src/features/watchlist/screens/CollectionScreen.tsx (what a tile
 *        opens); src/features/watchlist/README.md.
 */

import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { FlatList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { createLogger } from '@/shared/lib/logger';
import { colors, spacing, typography } from '@/shared/theme';
import { EmptyState, ErrorState, Screen, SkeletonVehicleCard, ThemedRefreshControl } from '@/shared/ui';

import { CollectionTile } from '../components/CollectionTile';
import { useCollections } from '../hooks/useCollections';
import { useWatchlist } from '../hooks/useWatchlist';
import { buildCollectionTiles } from '../lib/collectionsModel';
import type { CollectionTile as CollectionTileData } from '../lib/collectionsModel';

const log = createLogger('watchlist');

const COLUMNS = 2;
/** Feed gutter (DESIGN_SYSTEM feed-surface exception) and the gap between tiles. */
const GUTTER = spacing.lg;
const GAP = spacing.lg;

export function CollectionsGridScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { status, entries, refreshing, refresh, retry } = useWatchlist();
  const { collections, status: collectionsStatus, reload } = useCollections();

  // Floor, not a raw divide: a fractional width rounds differently per tile on
  // Android and leaves a visible 1px stagger down the right-hand column.
  const tileWidth = Math.floor((width - GUTTER * 2 - GAP * (COLUMNS - 1)) / COLUMNS);

  const tiles = useMemo(
    () => buildCollectionTiles(entries, collections),
    [entries, collections],
  );

  // A collections failure alone must NOT error the screen: the watchlist
  // payload still describes every list that has something in it, so the worst
  // case is that a list the user made but hasn't filled yet is missing — far
  // better than showing nothing.
  const failed = status === 'error';
  const loading = status === 'loading' || (collectionsStatus === 'loading' && !failed);

  useEffect(() => {
    if (status === 'ready') {
      log.info('collections_view', { tiles: tiles.length, watches: entries.length });
    }
    // Per landing, not per change while sat on the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const onRefresh = useCallback(() => {
    reload();
    return refresh();
  }, [reload, refresh]);

  const renderTile = useCallback(
    ({ item }: { item: CollectionTileData }) => (
      <CollectionTile
        tile={item}
        width={tileWidth}
        onPress={() =>
          router.push({
            pathname: '/collection/[collectionId]',
            params: { collectionId: item.routeId },
          })
        }
      />
    ),
    [router, tileWidth],
  );

  return (
    <Screen>
      {/* The title lives OUTSIDE the state branch — loading, error, and empty
          states keep the screen's identity (ui review 2026-07-22). */}
      <Text accessibilityRole="header" style={styles.title}>
        Watchlist
      </Text>
      {loading ? (
        <View style={styles.skeletons}>
          <SkeletonVehicleCard />
          <SkeletonVehicleCard />
        </View>
      ) : failed ? (
        <ErrorState body="We couldn't load your watchlist." onRetry={retry} />
      ) : entries.length === 0 && collections.length === 0 ? (
        <EmptyState
          title="Keeping an eye out"
          body="Tap the bookmark on any post to follow it here."
          actionLabel="Explore posts"
          onAction={() => router.push('/(tabs)/explore')}
        />
      ) : (
        <FlatList
          data={tiles}
          renderItem={renderTile}
          keyExtractor={(item) => item.routeId}
          numColumns={COLUMNS}
          columnWrapperStyle={styles.column}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <ThemedRefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
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
    paddingHorizontal: GUTTER,
    // Breathing room above the tab bar for the last row.
    paddingBottom: spacing.xl,
  },
  column: {
    // flex-start, NOT space-between: with an odd number of tiles the last row
    // holds one, and space-between would leave it centred against nothing.
    justifyContent: 'flex-start',
    gap: GAP,
    marginBottom: spacing.xl,
  },
});
