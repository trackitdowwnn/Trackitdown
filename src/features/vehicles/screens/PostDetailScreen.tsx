/**
 * WHAT:  PostDetailScreen — the full listing page for one stolen car. Loads
 *        the post, then renders: a full-bleed photo hero under a scroll-linked
 *        AppHeader, the detail sections, and a sticky bottom bar whose action
 *        is owner- or spotter-specific. Handles loading (skeleton), error, a
 *        graceful "no longer active / recovered" state, and share / flag.
 * WHY:   Route `/post/[id]`, reached from VehicleCard everywhere. Owner-vs-
 *        spotter mode comes from the server (is_owner); one decision drives the
 *        bottom bar. Read-only — no status or money writes. The header fade and
 *        scroll run on the UI thread (Reanimated) so the hero parallax-feel and
 *        the scroll never jank each other.
 * LINKS: src/app/post/[id].tsx (route); src/features/vehicles/hooks/
 *        usePostDetail.ts; src/features/vehicles/components/*;
 *        docs/SECURITY_AND_TRUST.md (§1 safety, §6 aggregate sightings).
 */

import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRequireAuth } from '@/features/auth';
import { createLogger } from '@/shared/lib/logger';
import { colors, sizes, spacing, typography } from '@/shared/theme';
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
  const fadeEnd = Math.max(FADE_TRAVEL, heroHeight - insets.top - HEADER_BAR_HEIGHT);
  const fadeStart = fadeEnd - FADE_TRAVEL;

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const visiblePost = status === 'ready' && result?.kind === 'visible' ? result.post : null;

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

  const onFlagConfirm = useCallback(() => {
    // Phase-4 stub: no flags table yet — acknowledge and log only.
    log.info('post_flag_stub', { postId });
    toast.show('Thanks — we’ll review this.');
  }, [postId, toast]);

  const onSeen = useCallback(() => {
    // Gated: a guest signs in first (sheet), then the continuation fires
    // without re-tapping. The sighting flow itself isn't built yet — the
    // continuation acknowledges warmly and will become the real flow later.
    requireAuth({
      context: 'report_sighting',
      run: () => {
        toast.show('Reporting a sighting is coming soon.');
        log.debug('post_seen_stub', { postId });
      },
    });
  }, [postId, toast, requireAuth]);

  const onManage = useCallback(() => {
    // my-cars is a tab stub today; the management screen lands there later.
    router.push('/(tabs)/my-cars');
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
            <PostDetailBody post={result.post} onOpenMap={() => onOpenMap(result.post)} />
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
              <AppHeaderButton accessibilityLabel="Share" onPress={() => onShare(visiblePost)}>
                <Feather name="share" size={sizes.iconSm} color={colors.textPrimary} />
              </AppHeaderButton>
              <AppHeaderButton accessibilityLabel="Report" onPress={() => flagRef.current?.open()}>
                <Feather name="flag" size={sizes.iconSm} color={colors.textPrimary} />
              </AppHeaderButton>
            </>
          ) : null
        }
      />

      {visiblePost ? (
        <PostBottomBar post={visiblePost} onSeen={onSeen} onManage={onManage} />
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
      <View style={styles.skeletonBody}>
        <View style={[styles.skeletonLine, styles.skeletonTitle]} />
        <View style={[styles.skeletonLine, styles.skeletonMeta]} />
        <View style={[styles.skeletonLine, styles.skeletonMeta]} />
        <View style={[styles.skeletonLine, styles.skeletonBounty]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
    paddingTop: spacing.xl,
    gap: spacing.md,
  },
  skeletonLine: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: spacing.xs,
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
});
