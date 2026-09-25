/**
 * WHAT:  PostDetailScreen — the full listing page for one stolen car. Loads
 *        the post, then renders: a full-bleed photo hero with the content
 *        sheet's rounded top overlapping it (the reference's signature move),
 *        a scroll-linked AppHeader, the detail sections, and a sticky bottom
 *        bar whose action is owner- or spotter-specific ("Manage post" opens the
 *        owner's PostManageSheet for THIS listing). Handles loading (skeleton),
 *        error, a graceful "no longer active / recovered" state, and share;
 *        report lives at the page's end (in the body), not the header.
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
import { useCallback, useEffect, useRef, useState } from 'react';
import { Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Bookmark } from 'lucide-react-native';

import { useRequireAuth } from '@/features/auth';
import { useWatchToggle } from '@/features/watchlist';
import { bountyParam } from '@/shared/lib';
import { createLogger } from '@/shared/lib/logger';
import { radii, sizes, spacing, typography, usePalette, useThemedStyles, type Palette } from '@/shared/theme';
import {
  AppHeader,
  AppHeaderButton,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  HEADER_BAR_HEIGHT,
  ThemedRefreshControl,
  useToast,
  type ConfirmDialogRef,
} from '@/shared/ui';

import { flagPost } from '../api/flagApi';
import { type EditableSection } from '../components/editors';
import { PostBottomBar } from '../components/PostBottomBar';
import { PostDetailBody } from '../components/PostDetailBody';
import { PostHero } from '../components/PostHero';
import { PostOwnerActions, type PostOwnerActionsHandle } from '../components/PostOwnerActions';
import { StillMissingBanner } from '../components/StillMissingBanner';
import { usePostDetail } from '../hooks/usePostDetail';
import { usePostMoney } from '../hooks/usePostMoney';
import { canFinishRefund } from '../lib/postMoney';
import { useSimilarPosts } from '../hooks/useSimilarPosts';
import { useStillMissingAsk } from '../hooks/useStillMissingAsk';
import { closedStateCopy } from '../lib/closedState';
import {
  canDeactivate,
  canEditDraftSection,
  canEditSafeSection,
  canMarkRecovered,
} from '../lib/ownerPermissions';
import { buildSharePayload } from '../lib/postShare';
import { StillMissingError } from '../lib/stillMissingError';
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
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const toast = useToast();
  const requireAuth = useRequireAuth();
  const flagRef = useRef<ConfirmDialogRef>(null);
  // Everything the OWNER can do — the Manage sheet, the deactivate / delete
  // confirms, the attestation, the section editors — lives in PostOwnerActions
  // (shared with the long-press sheet on My listings). This page drives it: the
  // bottom bar's "Manage listing", the pencils, the body's deactivate button.
  const ownerRef = useRef<PostOwnerActionsHandle>(null);

  const { status, result, retry, refreshing, refresh } = usePostDetail(postId);

  // Guards a double-tap on "Yes, still missing" (ADR-0019).
  const [confirmingMissing, setConfirmingMissing] = useState(false);

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

  // The owner's money for this listing — read once here and handed to both
  // the "Your money" card and the owner actions, so one screen makes one read.
  // Re-read on the post's status (every money move changes it or follows one)
  // and on every return to the screen. No request at all for anyone else.
  const { money, failed: moneyReadFailed } = usePostMoney(
    postId,
    visiblePost?.isOwner === true,
    visiblePost?.status,
  );

  // The ADR-0019 liveness ask. Only ever open on the owner's own live listing —
  // the RPC is scoped to auth.uid() and status='active', so a spotter's copy of
  // this screen can never raise it.
  const { open: stillMissingOpen, confirm: confirmStillMissing } = useStillMissingAsk(postId);

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
    // ⚠️ SPREAD, don't pass `url` as undefined. There is no website yet, so
    // buildSharePayload omits the key entirely; handing iOS `{ url: undefined }`
    // is not the same as handing it `{ message }`, and the difference shows up
    // in the share sheet rather than in a type error.
    const payload = buildSharePayload(post);
    // Share sheet cancel / no target rejects — nothing to recover from.
    void Share.share({ ...payload }).catch(() => {});
  }, []);

  // Header watch toggle: AppHeaderButton chrome (matches share, rides the
  // header's scroll fade) with the shared toggle behaviour underneath.
  const watch = useWatchToggle(postId, 'detail');

  const onFlagConfirm = useCallback(async () => {
    // Records a durable, attributable flag (post_flags) for moderator review.
    // Idempotent server-side, so a double-tap is harmless. The caller is already
    // signed in (onReport gates), so this can't produce an anonymous report.
    try {
      await flagPost(postId);
      toast.show('Thanks — we’ll take a look.');
    } catch {
      toast.show('We couldn’t submit your report. Please try again.', 'error');
    }
  }, [postId, toast]);

  const onReport = useCallback(() => {
    // Reporting is auth-gated (accountability): a guest signs in first, then the
    // confirm dialog opens without re-tapping.
    requireAuth({ context: 'report_post', run: () => flagRef.current?.open() });
  }, [requireAuth]);

  const onSeen = useCallback(
    (post: PostDetail) => {
      // Gated: a guest signs in first (sheet), then the continuation fires
      // without re-tapping — landing straight in the report wizard.
      requireAuth({
        context: 'report_sighting',
        run: () => {
          router.push({
            pathname: '/report-sighting',
            // 'none' rather than String(null): a null stringifies to "null" and
          // parses to NaN, which the route cannot tell from an absent param —
          // and the success screen would then promise "the bounty" on a
          // no-reward listing (ADR-0014).
          params: { postId, source: 'detail', bounty: bountyParam(post.bountyPence) },
          });
        },
      });
    },
    [postId, requireAuth, router],
  );

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
          // 'none' rather than String(null): a null stringifies to "null" and
          // parses to NaN, which the route cannot tell from an absent param —
          // and the success screen would then promise "the bounty" on a
          // no-reward listing (ADR-0014).
          params: { postId, source: 'detail', bounty: bountyParam(post.bountyPence) },
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
    // "Manage listing" opens the owner's action sheet for THIS listing (in
    // PostOwnerActions). It used to push /my-posts, which bounced the owner off
    // the very post they were managing onto a list containing it — a dead end.
    ownerRef.current?.openManage();
  }, []);
  const edit = (section: EditableSection) => ownerRef.current?.edit(section);

  // No confirm dialog here, unlike deactivate: the recovery screen IS the
  // confirmation, and it asks something a yes/no cannot — WHICH sighting. A
  // dialog first would be a gate in front of a gate.
  const onRecovered = useCallback(() => {
    // Carry the pricing mode: the recovery screen's option copy promises a
    // refund and a bounty payout, and both are false on a no-reward listing
    // (ADR-0014). Same encoder as the report-sighting entry, so 'none' can
    // never be confused with an absent param.
    // The param is OMITTED rather than defaulted if the post somehow isn't
    // loaded (unreachable — this fires from the rendered detail body). Omitted
    // reads as "unknown", which keeps today's behaviour; defaulting to 'none'
    // would suppress refund copy on a real bounty post, the costlier mistake.
    router.push({
      pathname: '/recover-post',
      params: visiblePost
        ? { postId, bounty: bountyParam(visiblePost.bountyPence) }
        : { postId },
    });
  }, [postId, router, visiblePost]);

  // "Finish your refund" — resume an interrupted "found it another way". The
  // claim already landed, so the recovery screen skips straight to the refund
  // (and its attestation, if recent sightings need one).
  const onFinishRefund = useCallback(() => {
    router.push({
      pathname: '/recover-post',
      params: visiblePost
        ? { postId, bounty: bountyParam(visiblePost.bountyPence), resume: '1' }
        : { postId, resume: '1' },
    });
  }, [postId, router, visiblePost]);

  // "Yes, still missing" (ADR-0019). Resets the liveness clock and nothing
  // else: no status moves, no money moves, and the only visible effect is that
  // the banner goes away. "I've found it" is not handled here — it is
  // onRecovered above, unchanged, because the recovery flow is still the one
  // thing that decides where escrow goes.
  const onStillMissing = useCallback(async () => {
    if (confirmingMissing) {
      return;
    }
    setConfirmingMissing(true);
    try {
      await confirmStillMissing();
      toast.show('Thanks — we’ll keep it listed.');
    } catch (error) {
      toast.show(
        error instanceof StillMissingError ? error.message : 'We couldn’t save that. Please try again.',
        'error',
      );
    } finally {
      setConfirmingMissing(false);
    }
  }, [confirmStillMissing, confirmingMissing, toast]);

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
        // A listing is the one screen people come BACK to — waiting on a
        // sighting, watching the bounty, checking whether anything moved. The
        // 30s poll covers that, but silently and on its own schedule, so
        // someone staring at "0 sightings" had no way to ask. The pull is the
        // ask. It also re-fetches from the error state, which previously
        // needed the Try again button below the fold.
        refreshControl={
          <ThemedRefreshControl
            // Gated on having content: `loading` renders PostDetailSkeleton in
            // THIS scroll view, and a spinner over a skeleton is two loading
            // indicators for one fetch.
            refreshing={refreshing && status !== 'loading'}
            onRefresh={() => void refresh()}
            // This scroll view is full-bleed from y=0 with AppHeader floating
            // over it, so without an offset the spinner draws out of the status
            // bar and through the header’s own back and share buttons.
            progressViewOffset={insets.top + HEADER_BAR_HEIGHT}
          />
        }
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
              {/* Above the body, not buried in it: this is a question we are
                  asking, and it has to be answerable without scrolling past
                  the car. Owner-only by construction — the RPC behind
                  stillMissingOpen is scoped to auth.uid(). */}
              {stillMissingOpen ? (
                <View style={styles.stillMissing}>
                  <StillMissingBanner
                    onStillMissing={onStillMissing}
                    onFound={onRecovered}
                    busy={confirmingMissing}
                  />
                </View>
              ) : null}
              <PostDetailBody
                post={result.post}
                money={money}
                onFinishRefund={canFinishRefund(money) ? onFinishRefund : undefined}
                onOpenMap={() => onOpenMap(result.post)}
                onReport={onReport}
                onMessageOwner={
                  result.post.isOwner ? undefined : () => onMessageOwner(result.post)
                }
                onReportSighting={
                  result.post.isOwner ? undefined : () => onSeen(result.post)
                }
                onShowAbout={onShowAbout}
                similarPosts={similar.posts}
                similarLoading={similar.status === 'loading'}
                onOpenPost={(next) => router.push(`/post/${next.id}`)}
                // The pencils and the deactivate button drive PostOwnerActions
                // below — the same editors and confirms the Manage sheet uses.
                onEditCarDetails={
                  canEditSafeSection(result.post) ? () => edit('car_details') : undefined
                }
                onEditPhotos={canEditDraftSection(result.post) ? () => edit('photos') : undefined}
                onEditLastSeen={
                  canEditDraftSection(result.post) ? () => edit('last_seen') : undefined
                }
                onEditBounty={canEditDraftSection(result.post) ? () => edit('bounty') : undefined}
                onEditDescription={
                  canEditSafeSection(result.post) ? () => edit('description') : undefined
                }
                onEditTheftContext={
                  canEditSafeSection(result.post) ? () => edit('theft_context') : undefined
                }
                onEditDistinctiveFeatures={
                  canEditSafeSection(result.post) ? () => edit('distinctive_features') : undefined
                }
                onDeactivate={
                  canDeactivate(result.post)
                    ? () => ownerRef.current?.requestDeactivate()
                    : undefined
                }
                onRecovered={canMarkRecovered(result.post) ? onRecovered : undefined}
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
                    color={watch.watched ? palette.primary : palette.textPrimary}
                    fill={watch.watched ? palette.primary : 'transparent'}
                  />
                </AppHeaderButton>
              ) : null}
              <AppHeaderButton accessibilityLabel="Share" onPress={() => onShare(visiblePost)}>
                <Feather name="share" size={sizes.iconSm} color={palette.textPrimary} />
              </AppHeaderButton>
            </>
          ) : null
        }
      />

      {visiblePost ? (
        <PostBottomBar
          post={visiblePost}
          onSeen={() => onSeen(visiblePost)}
          onMessageOwner={() => onMessageOwner(visiblePost)}
          onManage={onManage}
        />
      ) : null}

      <ConfirmDialog
        ref={flagRef}
        title="Report this listing?"
        body="Our team will take a look. Use this for listings that look fake, abusive, or wrong."
        confirmLabel="Report"
        destructive
        onConfirm={onFlagConfirm}
      />

      {/* Everything the owner can do — the Manage sheet, the deactivate /
          delete confirms (including the delete offer after a clean cancel),
          the section editors and the attestation. Renders nothing for anyone
          but the owner. At the ROOT on purpose: its overlays fill their parent.
          A delete leaves nothing to show here, so it lands on My listings. */}
      <PostOwnerActions
        ref={ownerRef}
        postId={postId}
        post={visiblePost}
        money={money}
        moneyReadFailed={moneyReadFailed}
        refresh={retry}
        onDeleted={() => router.replace('/my-posts')}
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
  const styles = useThemedStyles(makeStyles);
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

const makeStyles = (c: Palette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  stillMissing: {
    // 24px gutter, matching stateBlock: post detail is a text/detail screen,
    // not a feed surface. Top padding clears the sheet's rounded shoulder.
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  sheet: {
    marginTop: -radii.xl,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    backgroundColor: c.background,
    overflow: 'hidden',
  },
  stateBlock: {
    // 24px gutter: post detail is a text/detail screen, not a feed surface.
    paddingHorizontal: spacing.xl,
  },
  skeletonHero: {
    backgroundColor: c.surfaceSubtle,
  },
  skeletonBody: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    // The real sections run a 16pt internal gap — mirror it.
    gap: spacing.lg,
  },
  skeletonLine: {
    backgroundColor: c.surfaceSubtle,
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
    backgroundColor: c.surfaceSubtle,
  },
  skeletonTileLine: {
    height: typography.heading.lineHeight,
    flex: 1,
    maxWidth: '55%',
  },
});
