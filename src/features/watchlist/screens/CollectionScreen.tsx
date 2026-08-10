/**
 * WHAT:  CollectionScreen — one list: watched posts as standard VehicleCards
 *        (newest watch first, toggle in the card corner removes), then a quiet
 *        'No longer active' section of resolved watches (recovered cards +
 *        tombstones) inside their 30-day window. Named lists carry a ⋯ menu
 *        for Rename / Delete; the implicit 'Saved' bucket does not.
 * WHY:   This is the old one-list Watchlist tab, scoped to a collection — kept
 *        as a rename (git mv) rather than a rewrite so its behaviour, and the
 *        reasons for it, survive intact. Removal is still the toggle itself:
 *        no swipe convention exists in this app and the watchlist doesn't
 *        invent one. Resolved entries keep their StatusBadge — learning the
 *        outcome is the section's whole job.
 *
 *        Each card also carries a quiet 'Move' action, which exists ONLY here:
 *        the save toast's Change auto-dismisses, so without a permanent
 *        affordance a mis-filed car would be stranded. It is deliberately not
 *        on the feed, map or rails, where VehicleCard's single overlay slot is
 *        already the bookmark.
 * LINKS: src/features/watchlist/README.md (spec);
 *        hooks/useWatchlist.ts (grouping rules);
 *        screens/CollectionsGridScreen.tsx (what opens this);
 *        components/{WatchToggle,WatchlistTombstoneRow}.tsx.
 */

import { useRouter } from 'expo-router';
import { ChevronLeft, MoreHorizontal } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { createLogger } from '@/shared/lib/logger';
import {
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import {
  BottomSheet,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  ListRow,
  Screen,
  SkeletonVehicleCard,
  TextField,
  ThemedRefreshControl,
  VehicleCard,
  useToast,
} from '@/shared/ui';
import type { BottomSheetRef, ConfirmDialogRef } from '@/shared/ui';

import { WatchToggle } from '../components/WatchToggle';
import { WatchlistTombstoneRow } from '../components/WatchlistTombstoneRow';
import { useCollections } from '../hooks/useCollections';
import { useWatchlist } from '../hooks/useWatchlist';
import { SAVED_NAME } from '../lib/collectionsModel';
import { requestCollectionPicker } from '../lib/pickerIntent';
import { useIsWatched } from '../lib/watchedStore';
import type { CollectionId, WatchlistEntry, WatchedPost } from '../types';

const log = createLogger('watchlist');

/** One watched card. Toggle-to-remove: when THIS session unwatches the post
 *  (watched flips true→false after mount), the row leaves the list — but an
 *  unhydrated store (watched false throughout) never hides anything. */
function WatchedCardRow({
  entry,
  onPress,
  onMove,
}: {
  entry: WatchedPost;
  onPress: () => void;
  onMove: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
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
        topRightAction={
          <WatchToggle postId={entry.post.id} source="watchlist" />
        }
      />
      {/* Quiet text action, not an overlay: VehicleCard's one overlay slot is
          the bookmark, and re-filing is a tidying job that must never compete
          with removing. */}
      <Pressable
        onPress={onMove}
        accessibilityRole="button"
        accessibilityLabel={`Move ${entry.post.make} ${entry.post.model} to another list`}
        style={styles.moveAction}
        testID={`move-${entry.post.id}`}
      >
        <Text style={styles.moveLabel}>Move</Text>
      </Pressable>
    </View>
  );
}

/** Flattened list rows: entries + the one section divider. */
type Row =
  | { type: 'entry'; key: string; entry: WatchlistEntry }
  | { type: 'resolvedHeader'; key: 'resolved_header' };

export interface CollectionScreenProps {
  /** null = the implicit 'Saved' bucket, which has no row and no ⋯ menu. */
  collectionId: CollectionId;
}

export function CollectionScreen({ collectionId }: CollectionScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const router = useRouter();
  const toast = useToast();
  const { status, active, resolved, refreshing, refresh, retry } = useWatchlist(
    { collectionId },
  );
  const { collections, rename, remove } = useCollections();

  const menuRef = useRef<BottomSheetRef>(null);
  const renameRef = useRef<BottomSheetRef>(null);
  const deleteRef = useRef<ConfirmDialogRef>(null);
  const [draftName, setDraftName] = useState('');
  const [busy, setBusy] = useState(false);

  // The name comes from the collections list, not the route — a rename must
  // retitle this screen without a navigation round trip. An id we can't find
  // (deleted on another device) falls back to Saved's label rather than
  // rendering an empty header.
  const collection = collections.find((c) => c.id === collectionId) ?? null;
  const title =
    collectionId === null ? SAVED_NAME : (collection?.name ?? SAVED_NAME);
  const editable = collectionId !== null && collection !== null;

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
        ...resolved.map((entry): Row => ({
          type: 'entry',
          key: entryKey(entry),
          entry,
        })),
      );
    }
    return items;
  }, [active, resolved]);

  // Screen-view funnel: how many people look, and at how much. The list NAME
  // is never logged — it is private free text (see collectionsApi).
  const count = active.length + resolved.length;
  useEffect(() => {
    if (status === 'ready') {
      log.info('collection_view', { collectionId, count });
    }
    // Log per landing, not per count change while sat on the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const onRename = useCallback(async () => {
    if (collectionId === null || busy) {
      return;
    }
    setBusy(true);
    try {
      await rename(collectionId, draftName);
      renameRef.current?.close();
    } catch (error) {
      toast.show(
        error instanceof Error ? error.message : 'Please try again.',
        'error',
      );
    } finally {
      setBusy(false);
    }
  }, [collectionId, busy, rename, draftName, toast]);

  const onDelete = useCallback(() => {
    if (collectionId === null) {
      return;
    }
    void remove(collectionId)
      .then(() => {
        // Back to the grid: this screen's subject no longer exists.
        router.back();
      })
      .catch((error: unknown) => {
        toast.show(
          error instanceof Error ? error.message : 'Please try again.',
          'error',
        );
      });
  }, [collectionId, remove, router, toast]);

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
        <WatchedCardRow
          entry={entry}
          onPress={() => router.push(`/post/${entry.post.id}`)}
          onMove={() =>
            requestCollectionPicker({
              postId: entry.post.id,
              currentCollectionId: collectionId,
              source: 'collection_card',
            })
          }
        />
      );
    },
    // `styles` joins the deps now that it comes from useThemedStyles rather
    // than module scope: it is a new object when the palette flips, and a
    // renderItem holding the old one would keep drawing light rows in a dark
    // list until something else invalidated the callback.
    [router, collectionId, styles],
  );

  return (
    <Screen>
      {/* The title lives OUTSIDE the state branch — loading, error, and
          empty states keep the screen's identity (ui review 2026-07-22). */}
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.back}
          testID="collection-back"
        >
          <ChevronLeft size={sizes.icon} color={palette.textPrimary} />
        </Pressable>
        <Text
          accessibilityRole="header"
          style={styles.title}
          numberOfLines={1}
          testID="collection-title"
        >
          {title}
        </Text>
        {editable ? (
          <Pressable
            onPress={() => {
              setDraftName(title);
              menuRef.current?.open();
            }}
            accessibilityRole="button"
            accessibilityLabel="List options"
            style={styles.back}
            testID="collection-menu"
          >
            <MoreHorizontal size={sizes.icon} color={palette.textPrimary} />
          </Pressable>
        ) : null}
      </View>
      {status === 'loading' ? (
        <View style={styles.skeletons}>
          <SkeletonVehicleCard />
          <SkeletonVehicleCard />
        </View>
      ) : status === 'error' ? (
        <ErrorState body="We couldn't load your watchlist." onRetry={retry} />
      ) : count === 0 ? (
        <EmptyState
          title={
            collectionId === null ? 'Keeping an eye out' : 'Nothing here yet'
          }
          body={
            collectionId === null
              ? 'Tap the bookmark on any post to follow it here.'
              : 'Save a car, then tap Change on the confirmation to file it here.'
          }
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
            <ThemedRefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
            />
          }
        />
      )}

      {/* Rename / Delete, mounted ONLY for a real collection: the implicit
          'Saved' bucket has no row, so these could never be opened there — and
          an unreachable sheet is still a sheet in the tree, duplicating its
          title to a screen reader walking the page. */}
      {editable ? (
        <>
          <BottomSheet ref={menuRef} title={title}>
            <View style={styles.menu}>
              <ListRow
                title="Rename list"
                testID="menu-rename"
                onPress={() => {
                  menuRef.current?.close();
                  renameRef.current?.open();
                }}
              />
              <ListRow
                title="Delete list"
                destructive
                testID="menu-delete"
                onPress={() => {
                  menuRef.current?.close();
                  deleteRef.current?.open();
                }}
              />
            </View>
          </BottomSheet>

          <BottomSheet ref={renameRef} title="Rename list">
            <View style={styles.menu}>
              <TextField
                label="List name"
                value={draftName}
                onChangeText={setDraftName}
                autoFocus
                maxLength={40}
                returnKeyType="done"
                onSubmitEditing={() => void onRename()}
              />
              <Button
                label="Save"
                onPress={() => void onRename()}
                disabled={busy || draftName.trim().length === 0}
              />
            </View>
          </BottomSheet>

          <ConfirmDialog
            ref={deleteRef}
            title="Delete this list?"
            // Says what actually happens. The cars are SET NULL by the foreign key,
            // never deleted — copy implying otherwise would be the most damaging
            // possible bug here, since it would stop people tidying at all.
            body="The cars in it will move back to Saved."
            // Just "Delete": the title already says what of, and repeating
            // "list" made the confirm button indistinguishable from the menu
            // row that opens this dialog.
            confirmLabel="Delete"
            destructive
            onConfirm={onDelete}
          />
        </>
      ) : null}
    </Screen>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  back: {
    minWidth: sizes.control,
    minHeight: sizes.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.title,
    color: c.textPrimary,
    // flex so a long list name truncates instead of shoving the ⋯ off screen.
    flex: 1,
  },
  menu: {
    gap: spacing.md,
  },
  moveAction: {
    alignSelf: 'flex-start',
    // Small label, full-size target (DESIGN_SYSTEM Accessibility).
    minHeight: sizes.touchTarget,
    justifyContent: 'center',
  },
  moveLabel: {
    ...typography.caption,
    color: c.textSecondary,
    textDecorationLine: 'underline',
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
    color: c.textPrimary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
});
