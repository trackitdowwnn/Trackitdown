/**
 * WHAT:  MyPostsScreen — the pushed "My Posts" page (reached from Profile): the
 *        owner's own listings as standard VehicleCards (newest first, every
 *        status incl. drafts/pending, each showing its StatusBadge). Tap to open
 *        the post; press and hold for its "Manage your listing" sheet, right
 *        here over the list. Guests get a friendly invitation through the auth
 *        gate; loading/empty/error states keep the page's identity.
 * WHY:   Your own posts are their own destination (product call — split from the
 *        "My cars" garage concept). A tap opens the post and its owner controls.
 *        The long-press (owner's call, 2026-09-24) is the shortcut to those same
 *        controls without leaving the list: every edit, deactivate & refund,
 *        delete and send-the-reward, via the SAME PostOwnerActions the listing
 *        page uses — never a copy. Mirrors WatchlistScreen (the house pattern
 *        for an owner/user-scoped card list).
 * LINKS: src/app/my-posts.tsx (route); src/features/profile/screens/
 *        ProfileScreen.tsx (the push); src/features/vehicles/hooks/useMyPosts.ts;
 *        src/features/vehicles/components/PostOwnerActions.tsx (the sheet and
 *        every owner action); src/features/vehicles/hooks/usePostDetail.ts
 *        (ListingManager's loader).
 */

import { useRouter } from 'expo-router';
import { ChevronLeft, Hourglass } from 'lucide-react-native';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useRequireAuth, useSession } from '@/features/auth';
import { lightHaptic } from '@/shared/lib/haptics';
import { sizes, spacing, typography, usePalette, useThemedStyles, type Palette } from '@/shared/theme';
import type { PostSummary } from '@/shared/types';
import {
  EmptyState,
  ErrorState,
  NudgeRow,
  Screen,
  SkeletonVehicleCard,
  ThemedRefreshControl,
  useToast,
  VehicleCard,
} from '@/shared/ui';

import { PostOwnerActions, type PostOwnerActionsHandle } from '../components/PostOwnerActions';
import { useMyPosts } from '../hooks/useMyPosts';
import { useOpenOnArrival } from '../hooks/useOpenOnArrival';
import { usePostDetail } from '../hooks/usePostDetail';
import { useStillMissingAsks } from '../hooks/useStillMissingAsk';

export function MyPostsScreen() {
  const styles = useThemedStyles(makeStyles);
  const session = useSession();
  const requireAuth = useRequireAuth();
  const router = useRouter();
  const { status, posts, refreshing, refresh, retry } = useMyPosts();
  // ADR-0019's second door. The banner on the post is the first, but it is only
  // reachable by someone who already thought to open that listing — and the
  // owner this asks about is the one who has stopped thinking about it.
  const stillMissingAsks = useStillMissingAsks();
  const toast = useToast();
  // The listing whose Manage sheet a long-press asked for. `nonce` remounts the
  // manager on every hold, so holding the same card again re-opens its sheet.
  const [managing, setManaging] = useState<{ postId: string; nonce: number } | null>(null);
  const managerRef = useRef<ListingManagerHandle>(null);

  // Press and hold → the Manage sheet, right here over the list (owner's call,
  // 2026-09-24: "just a bottom sheet … not to be brought to the listing
  // page"). It is the REAL sheet (PostOwnerActions), so every row — edits,
  // deactivate & refund, delete, send the reward — is the one tested
  // implementation. The tick answers the hold at once; the sheet rises when the
  // listing's details have loaded.
  //
  // ⚠️ NEVER REPLACE A BUSY MANAGER. A new hold remounts it, and a remount
  // drops the in-flight request's double-tap guard and its follow-up (the
  // post-cancel delete offer). While one is running — the confirm has closed
  // but the refund, delete or payout is still on its way — a hold is refused
  // with a word, not silently. (Code + security review, 2026-09-24.)
  const onHold = useCallback(
    (postId: string) => {
      lightHaptic();
      if (managerRef.current?.isBusy()) {
        toast.show('Just a moment — finishing your last change.');
        return;
      }
      setManaging((current) => ({ postId, nonce: (current?.nonce ?? 0) + 1 }));
    },
    [toast],
  );

  const renderCard = useCallback(
    ({ item }: { item: PostSummary }) => (
      <View style={styles.cardRow}>
        {/* Always the owner's own list → show the green "Live" badge on active posts. */}
        <VehicleCard
          post={item}
          onPress={() => router.push(`/post/${item.id}`)}
          onLongPress={() => onHold(item.id)}
          longPressLabel="Manage listing"
          showLiveBadge
        />
      </View>
    ),
    [onHold, router, styles],
  );

  return (
    // A plain root around Screen so the manager's overlays (the attestation,
    // the section editors) can fill the whole page, as they do on the listing.
    <View style={styles.root}>
      <Screen>
        {/* Pushed page, headers hidden app-wide → an on-screen back control. */}
        <View style={styles.headerRow}>
          <BackButton />
          <Text style={styles.title} accessibilityRole="header">
            My listings
          </Text>
        </View>

        {session.status === 'signedOut' ? (
          <EmptyState
            title="Your listings live here"
            body="Report a stolen car and track its sightings, status, and reward — all in one place."
            actionLabel="Log in"
            onAction={() => requireAuth({ context: 'my_posts' })}
          />
        ) : status === 'loading' ? (
          <View style={styles.skeletons}>
            <SkeletonVehicleCard />
            <SkeletonVehicleCard />
          </View>
        ) : status === 'error' ? (
          <ErrorState body="We couldn't load your listings." onRetry={retry} />
        ) : posts.length === 0 ? (
          <EmptyState
            title="No listings yet"
            body="When you report a stolen car it shows up here with its status and reward."
            actionLabel="Post a car"
            onAction={() => router.push('/post-a-car')}
          />
        ) : (
          <FlatList
            data={posts}
            renderItem={renderCard}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              stillMissingAsks.length > 0 ? (
                <View style={styles.nudge}>
                  <NudgeRow
                    icon={Hourglass}
                    title="Is your car still missing?"
                    // Plural is rare — it needs two live listings AND silence on
                    // both — but "the first of 2" is honest about where the tap
                    // lands, which "2 listings" would not be.
                    body={
                      stillMissingAsks.length === 1
                        ? 'Tap to answer'
                        : `Tap to answer the first of ${stillMissingAsks.length}`
                    }
                    onPress={() => router.push(`/post/${stillMissingAsks[0].postId}`)}
                  />
                </View>
              ) : null
            }
            refreshControl={
              <ThemedRefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
            }
          />
        )}
      </Screen>
      {managing ? (
        <ListingManager
          ref={managerRef}
          key={`${managing.postId}:${managing.nonce}`}
          postId={managing.postId}
          onChanged={() => void refresh()}
          onDeleted={() => {
            // Only if THIS hold is still the current one. A delete that
            // finishes after the owner has moved on to another card must not
            // close that card's sheet (code + security review, 2026-09-24).
            const deleted = managing.nonce;
            setManaging((current) => (current?.nonce === deleted ? null : current));
            void refresh();
          }}
        />
      ) : null}
    </View>
  );
}

interface ListingManagerHandle {
  /** See PostOwnerActionsHandle.isBusy. */
  isBusy: () => boolean;
}

/**
 * Loads one listing's full details and raises its Manage sheet over the list.
 * The summary cards don't carry what the sheet needs (the editors want the
 * whole post; the rows depend on status, reward and sightings), so this is the
 * listing page's own loader.
 *
 * Mounted per long-press and LEFT mounted after the sheet closes, so a confirm,
 * editor or attestation opened from the sheet keeps its host. The cost is
 * accepted on purpose: usePostDetail keeps this one listing fresh (a refetch on
 * focus and its 30s poll) while My listings is open — the same cost as having
 * the listing itself open, and it means the sheet's rows are never stale.
 */
function ListingManager({
  ref,
  postId,
  onChanged,
  onDeleted,
}: {
  ref?: Ref<ListingManagerHandle>;
  postId: string;
  /** Something about the listing changed — the list's card should follow. */
  onChanged: () => void;
  /** The listing was deleted — close this manager and refresh the list. */
  onDeleted: () => void;
}) {
  const toast = useToast();
  const ownerRef = useRef<PostOwnerActionsHandle>(null);
  const { status, result, retry } = usePostDetail(postId);
  const post = status === 'ready' && result?.kind === 'visible' ? result.post : null;
  const owned = post?.isOwner === true;

  useImperativeHandle(ref, () => ({ isBusy: () => ownerRef.current?.isBusy() ?? false }), []);

  useOpenOnArrival(owned, () => ownerRef.current?.openManage());

  // The haptic is the only answer until the sheet rises, so a hold that CAN'T
  // raise it must say so — but only on the way in. Later loads are the
  // refreshes after an edit or a deactivation, with the sheet already used; a
  // blip in one of those is not "we couldn't open that listing".
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) {
      return;
    }
    if (owned) {
      arrived.current = true;
    } else if (status === 'error') {
      arrived.current = true;
      toast.show('We couldn’t open that listing. Please try again.', 'error');
    } else if (status === 'ready') {
      // Loaded, but not a listing this owner can manage any more: deleted on
      // another device, auto-deleted after 30 days, or moderated. The card is
      // stale — say so, and refresh the list so it goes.
      arrived.current = true;
      toast.show('That listing isn’t available any more.', 'error');
      onChanged();
    }
  }, [owned, status, toast, onChanged]);

  return (
    <PostOwnerActions
      ref={ownerRef}
      postId={postId}
      post={post}
      refresh={() => {
        retry();
        onChanged();
      }}
      onDeleted={onDeleted}
    />
  );
}

function BackButton() {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.back()}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={styles.back}
      testID="my-posts-back"
    >
      <ChevronLeft size={sizes.icon} color={palette.textPrimary} />
    </Pressable>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  root: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  back: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -(sizes.touchTarget - sizes.icon) / 2,
  },
  title: {
    ...typography.title,
    color: c.textPrimary,
    flexShrink: 1,
  },
  skeletons: {
    padding: spacing.lg,
    gap: spacing.xl,
  },
  listContent: {
    paddingBottom: spacing.xl,
  },
  cardRow: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
  },
  // No horizontal padding: NudgeRow owns its own 16pt gutter by default, which
  // is the same inset cardRow applies, so the two line up.
  nudge: {
    marginBottom: spacing.xl,
  },
});
