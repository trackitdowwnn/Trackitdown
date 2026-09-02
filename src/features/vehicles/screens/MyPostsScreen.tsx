/**
 * WHAT:  MyPostsScreen — the pushed "My Posts" page (reached from Profile): the
 *        owner's own listings as standard VehicleCards (newest first, every
 *        status incl. drafts/pending, each showing its StatusBadge), tap to open
 *        the post — where editing now lives (a pencil beside each section).
 *        Guests get a friendly invitation through the auth gate; loading/empty/
 *        error states keep the page's identity.
 * WHY:   Your own posts are their own destination (product call — split from the
 *        "My cars" garage concept). Editing moved onto the opened post (per
 *        section), so this list carries no edit affordance — tapping a card opens
 *        the post and its owner controls. Mirrors WatchlistScreen (the house
 *        pattern for an owner/user-scoped card list).
 * LINKS: src/app/my-posts.tsx (route); src/features/profile/screens/
 *        ProfileScreen.tsx (the push); src/features/vehicles/hooks/useMyPosts.ts;
 *        src/features/vehicles/screens/PostDetailScreen.tsx (per-section edit).
 */

import { useRouter } from 'expo-router';
import { ChevronLeft, Hourglass } from 'lucide-react-native';
import { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useRequireAuth, useSession } from '@/features/auth';
import { sizes, spacing, typography, usePalette, useThemedStyles, type Palette } from '@/shared/theme';
import type { PostSummary } from '@/shared/types';
import {
  EmptyState,
  ErrorState,
  NudgeRow,
  Screen,
  SkeletonVehicleCard,
  ThemedRefreshControl,
  VehicleCard,
} from '@/shared/ui';

import { useMyPosts } from '../hooks/useMyPosts';
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

  const renderCard = useCallback(
    ({ item }: { item: PostSummary }) => (
      <View style={styles.cardRow}>
        {/* Always the owner's own list → show the green "Live" badge on active posts. */}
        <VehicleCard
          post={item}
          onPress={() => router.push(`/post/${item.id}`)}
          showLiveBadge
        />
      </View>
    ),
    [router, styles],
  );

  return (
    <Screen>
      {/* Pushed page, headers hidden app-wide → an on-screen back control. */}
      <View style={styles.headerRow}>
        <BackButton />
        <Text style={styles.title} accessibilityRole="header">
          My Posts
        </Text>
      </View>

      {session.status === 'signedOut' ? (
        <EmptyState
          title="Your posts live here"
          body="Report a stolen car and track its sightings, status, and bounty — all in one place."
          actionLabel="Log in"
          onAction={() => requireAuth({ context: 'my_posts' })}
        />
      ) : status === 'loading' ? (
        <View style={styles.skeletons}>
          <SkeletonVehicleCard />
          <SkeletonVehicleCard />
        </View>
      ) : status === 'error' ? (
        <ErrorState body="We couldn't load your posts." onRetry={retry} />
      ) : posts.length === 0 ? (
        <EmptyState
          title="No posts yet"
          body="When you report a stolen car it shows up here with its status and bounty."
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
