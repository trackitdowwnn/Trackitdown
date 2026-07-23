/**
 * WHAT:  PostDetailScreen — the full listing page for one stolen car. Loads
 *        the post, then renders: a full-bleed photo hero with the content
 *        sheet's rounded top overlapping it (the reference's signature move),
 *        a scroll-linked AppHeader, the detail sections, and a sticky bottom
 *        bar whose action is owner- or spotter-specific. Handles loading
 *        (skeleton), error, a graceful "no longer active / recovered" state,
 *        and share; report lives at the page's end (in the body), not the
 *        header.
 * WHY:   Route `/post/[id]`, reached from VehicleCard everywhere. Owner-vs-
 *        spotter mode comes from the server (is_owner); one decision drives the
 *        bottom bar. Read-only — no status or money writes. The header fade and
 *        scroll run on the UI thread (Reanimated) so the hero parallax-feel and
 *        the scroll never jank each other.
 * LINKS: src/app/post/[id].tsx (route); src/features/vehicles/hooks/
 *        usePostDetail.ts; src/features/vehicles/components/*;
 *        docs/design-refs/post-detail/ (the redesign's reference + gaps);
 *        docs/SECURITY_AND_TRUST.md (§1 safety, §6 aggregate sightings).
 */

import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Bookmark } from 'lucide-react-native';

import { useRequireAuth } from '@/features/auth';
import { useWatchToggle } from '@/features/watchlist';
import { createLogger } from '@/shared/lib/logger';
import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import {
  AppHeader,
  AppHeaderButton,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  HEADER_BAR_HEIGHT,
  useToast,
  type ConfirmDialogRef,
} from '@/shared/ui';

import { PostBottomBar } from '../components/PostBottomBar';
import { PostDetailBody } from '../components/PostDetailBody';
import { PostHero } from '../components/PostHero';
import { usePostDetail } from '../hooks/usePostDetail';
import { useSimilarPosts } from '../hooks/useSimilarPosts';
import { closedStateCopy } from '../lib/closedState';
import { buildSharePayload } from '../lib/postShare';
import type { PostDetail, PostDetailResult } from '../types';

const log = createLogger('vehicles');

/** Hero occupies a calm fraction of the screen width, full-bleed. */
const HERO_RATIO = 0.85;
/** Scroll distance over which the header fades transparent → solid. */
const FADE_TRAVEL = 48;

export interface PostDetailScreenProps {
  postId: string;
}

export function PostDetailScreen({ postId }: PostDetailScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const toast = useToast();
  const requireAuth = useRequireAuth();
  const flagRef = useRef<ConfirmDialogRef>(null);

  const { status, result, retry } = usePostDetail(postId);

  const heroHeight = Math.round(width * HERO_RATIO);
  // The sheet's rounded top overlaps the hero, so the VISUAL hero bottom —
  // where the header should finish solidifying — sits `radii.xl` higher.
  const fadeEnd = Math.max(
    FADE_TRAVEL,
    heroHeight - radii.xl - insets.top - HEADER_BAR_HEIGHT,
  );
  const fadeStart = fadeEnd - FADE_TRAVEL;

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const visiblePost = status === 'ready' && result?.kind === 'visible' ? result.post : null;

  // The "More stolen cars nearby" rail — waits for the post (its coords
  // centre the query), quietly empty on failure.
  const similar = useSimilarPosts(
    postId,
    visiblePost?.lat,
    visiblePost?.lng,
    visiblePost != null,
  );

  // Log the view once per resolved visible post, with the viewer's mode.
  useEffect(() => {
    if (visiblePost) {
      log.info('post_view', { postId, mode: visiblePost.isOwner ? 'owner' : 'spotter' });
    }
  }, [visiblePost, postId]);

  const onShare = useCallback((post: PostDetail) => {
    const { message, url } = buildSharePayload(post);
    // Share sheet cancel / no target rejects — nothing to recover from.
    void Share.share({ message, url }).catch(() => {});
  }, []);

  // Header watch toggle: AppHeaderButton chrome (matches share, rides the
  // header's scroll fade) with the shared toggle behaviour underneath.
  const watch = useWatchToggle(postId, 'detail');

  const onFlagConfirm = useCallback(() => {
    // Phase-4 stub: no flags table yet — acknowledge and log only.
    log.info('post_flag_stub', { postId });
    toast.show('Thanks — we’ll review this.');
  }, [postId, toast]);

  const onReport = useCallback(() => {
    flagRef.current?.open();
  }, []);

  const onSeen = useCallback(
    (post: PostDetail) => {
      // Gated: a guest signs in first (sheet), then the continuation fires
      // without re-tapping — landing straight in the report wizard.
      requireAuth({
        context: 'report_sighting',
        run: () => {
          router.push({
            pathname: '/report-sighting',
            params: { postId, source: 'detail', bounty: String(post.bountyPence) },
          });
        },
      });
    },
    [postId, requireAuth, router],
  );

  const onViewSightings = useCallback(() => {
    router.push({ pathname: '/post-sightings', params: { postId } });
  }, [postId, router]);

  const onShowAbout = useCallback(() => {
    router.push({ pathname: '/post-about', params: { postId } });
  }, [postId, router]);

  // Message the owner — sighting-gated (DOMAIN Chat). A viewer who has already
  // reported opens the thread directly; everyone else is routed into the
  // report flow, after which messaging opens (the report-success screen and
  // the sightings list both continue to the thread). Guests sign in first.
  const onMessageOwner = useCallback(
    (post: PostDetail) => {
      const goReport = () =>
        router.push({
          pathname: '/report-sighting',
          params: { postId, source: 'detail', bounty: String(post.bountyPence) },
        });
      requireAuth({
        context: post.viewerHasSighting ? 'message_owner' : 'report_sighting',
        run: async () => {
          if (!post.viewerHasSighting) {
            goReport();
            return;
          }
          try {
            const { openThread } = await import('@/features/chat');
            const { threadId } = await openThread(postId);
            router.push(`/chat/${threadId}`);
          } catch (err) {
            // Stale "has sighting" (or a race) → fall back to reporting; any
            // other failure surfaces its user-facing copy.
            const code = err instanceof Error && 'code' in err ? (err as { code: string }).code : '';
            if (code === 'NO_SIGHTING') {
              goReport();
            } else {
              toast.show(
                err instanceof Error && err.message
                  ? err.message
                  : 'We couldn’t open the conversation.',
                'error',
              );
            }
          }
        },
      });
    },
    [postId, requireAuth, router, toast],
  );

  const onManage = useCallback(() => {
    // My cars is a stub today; the management screen lands there later.
    router.push('/my-cars');
  }, [router]);

  const onOpenMap = useCallback(
    (post: PostDetail) => {
      if (post.lat == null || post.lng == null) {
        return;
      }
      router.push({
        pathname: '/search-map',
        params: { lat: String(post.lat), lng: String(post.lng) },
      });
    },
    [router],
  );

  return (
    <View style={styles.container}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: insets.bottom + sizes.control + spacing.xl,
        }}
      >
        {status === 'loading' ? (
          <PostDetailSkeleton heroHeight={heroHeight} />
        ) : status === 'error' ? (
          <View style={[styles.stateBlock, { paddingTop: insets.top + HEADER_BAR_HEIGHT }]}>
            <ErrorState body="We couldn't load this post." onRetry={retry} />
          </View>
        ) : result?.kind === 'visible' ? (
          <>
            <PostHero
              photos={result.post.photos}
              width={width}
              height={heroHeight}
              alt={`${result.post.colour} ${result.post.make} ${result.post.model}`}
            />
            {/* The content sheet: rounded top corners riding up over the
                hero's bottom edge (REFERENCE_SPEC §1). */}
            <View style={styles.sheet}>
              <PostDetailBody
                post={result.post}
                onOpenMap={() => onOpenMap(result.post)}
                onReport={onReport}
                onViewSightings={result.post.isOwner ? onViewSightings : undefined}
                onMessageOwner={
                  result.post.isOwner ? undefined : () => onMessageOwner(result.post)
                }
                onShowAbout={onShowAbout}
                similarPosts={similar.posts}
                similarLoading={similar.status === 'loading'}
                onOpenPost={(next) => router.push(`/post/${next.id}`)}
              />
            </View>
          </>
        ) : (
          <View style={[styles.stateBlock, { paddingTop: insets.top + HEADER_BAR_HEIGHT }]}>
            <ClosedState result={result} />
          </View>
        )}
      </Animated.ScrollView>

      <AppHeader
        title={visiblePost ? `${visiblePost.make} ${visiblePost.model}` : ''}
        scrollY={scrollY}
        fadeStart={fadeStart}
        fadeEnd={fadeEnd}
        onBack={() => router.back()}
        rightActions={
          visiblePost ? (
            <>
              {/* Watching your own car is pointless — owners get share only. */}
              {!visiblePost.isOwner ? (
                <AppHeaderButton
                  accessibilityLabel={
                    watch.watched ? 'Remove from your watchlist' : 'Add to your watchlist'
                  }
                  accessibilityState={{ selected: watch.watched }}
                  onPress={watch.toggle}
                >
                  <Bookmark
                    size={sizes.iconSm}
                    color={watch.watched ? colors.primary : colors.textPrimary}
                    fill={watch.watched ? colors.primary : 'transparent'}
                  />
                </AppHeaderButton>
              ) : null}
              <AppHeaderButton accessibilityLabel="Share" onPress={() => onShare(visiblePost)}>
                <Feather name="share" size={sizes.iconSm} color={colors.textPrimary} />
              </AppHeaderButton>
            </>
          ) : null
        }
      />

      {visiblePost ? (
        <PostBottomBar post={visiblePost} onSeen={() => onSeen(visiblePost)} onManage={onManage} />
      ) : null}

      <ConfirmDialog
        ref={flagRef}
        title="Report this post?"
        body="Our team will take a look. Use this for posts that look fake, abusive, or wrong."
        confirmLabel="Report"
        destructive
        onConfirm={onFlagConfirm}
      />
    </View>
  );
}

/** Graceful copy for a post a viewer can't (or no longer can) see. */
function ClosedState({ result }: { result: PostDetailResult | null }) {
  const copy = closedStateCopy(result);
  return <EmptyState title={copy.title} body={copy.body} />;
}

function PostDetailSkeleton({ heroHeight }: { heroHeight: number }) {
  return (
    <View>
      <View style={[styles.skeletonHero, { height: heroHeight }]} />
      {/* Mirrors the real sheet so load → ready doesn't jump. */}
      <View style={[styles.sheet, styles.skeletonBody]}>
        <View style={[styles.skeletonLine, styles.skeletonTitle]} />
        <View style={[styles.skeletonLine, styles.skeletonMeta]} />
        <View style={[styles.skeletonLine, styles.skeletonMeta]} />
        <View style={[styles.skeletonLine, styles.skeletonBounty]} />
        <View style={[styles.skeletonLine, styles.skeletonMap]} />
        {/* Two trust-highlight placeholders (tile + line). */}
        <View style={styles.skeletonTileRow}>
          <View style={styles.skeletonTile} />
          <View style={[styles.skeletonLine, styles.skeletonTileLine]} />
        </View>
        <View style={styles.skeletonTileRow}>
          <View style={styles.skeletonTile} />
          <View style={[styles.skeletonLine, styles.skeletonTileLine]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  sheet: {
    marginTop: -radii.xl,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  stateBlock: {
    // 24px gutter: post detail is a text/detail screen, not a feed surface.
    paddingHorizontal: spacing.xl,
  },
  skeletonHero: {
    backgroundColor: colors.surfaceSubtle,
  },
  skeletonBody: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    // The real sections run a 16pt internal gap — mirror it.
    gap: spacing.lg,
  },
  skeletonLine: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.sm,
  },
  skeletonTitle: {
    height: typography.title.lineHeight,
    width: '60%',
  },
  skeletonMeta: {
    height: typography.caption.lineHeight,
    width: '80%',
  },
  skeletonBounty: {
    height: typography.display.lineHeight,
    width: '40%',
    marginTop: spacing.md,
  },
  skeletonMap: {
    height: sizes.mapPreview,
    borderRadius: radii.xl,
    marginTop: spacing.md,
  },
  skeletonTileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  skeletonTile: {
    width: sizes.avatarMd,
    height: sizes.avatarMd,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceSubtle,
  },
  skeletonTileLine: {
    height: typography.heading.lineHeight,
    flex: 1,
    maxWidth: '55%',
  },
});
