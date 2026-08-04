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
import { useDeactivatePost } from '@/features/payments';
import { useWatchToggle } from '@/features/watchlist';
import { formatPounds } from '@/shared/lib';
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
  type BottomSheetRef,
  type ConfirmDialogRef,
} from '@/shared/ui';

import { flagPost } from '../api/flagApi';
import { RecoveryError, releasePayout } from '../api/recoveryApi';
import { PostSectionEditorHost, type EditableSection } from '../components/editors';
import { PostBottomBar } from '../components/PostBottomBar';
import { PostDetailBody } from '../components/PostDetailBody';
import { PostHero } from '../components/PostHero';
import { PostManageSheet } from '../components/PostManageSheet';
import { usePostDetail } from '../hooks/usePostDetail';
import { useSimilarPosts } from '../hooks/useSimilarPosts';
import { closedStateCopy } from '../lib/closedState';
import { buildSharePayload } from '../lib/postShare';
import { estimateRefundPence } from '../lib/refundEstimate';
import type { PostDetail, PostDetailResult } from '../types';

const log = createLogger('vehicles');

/** Hero occupies a calm fraction of the screen width, full-bleed. */
const HERO_RATIO = 0.85;
/** Scroll distance over which the header fades transparent → solid. */
const FADE_TRAVEL = 48;

export interface PostDetailScreenProps {
  postId: string;
}

/** Photos, last-seen and the bounty are editable ONLY while the post is a draft:
 *  imagery and where the car was taken from must not move once the crowd is
 *  matching against them, and the bounty is frozen by escrow. The server enforces
 *  this too. */
function canEditDraftSection(post: PostDetail): boolean {
  return post.isOwner && post.status === 'draft';
}
/** The money-neutral sections — car details, theft context, distinctive features,
 *  description — stay editable once the post is LIVE. A wrong colour or model
 *  actively harms the search, and the details worth adding ("cracked nearside
 *  mirror", "keys were taken") are exactly what an owner remembers after people
 *  start looking; the alternative was deactivate + refund + repost, which costs
 *  the hours that matter most. Mirrors the four RPCs' status array
 *  (20260731100000_edit_safe_sections_when_live.sql,
 *  20260731110000_edit_car_details_when_live.sql); `pending_verification` is kept
 *  for posts predating live-on-payment. The PLATE is not editable by any of them.
 *  Server-enforced — this only decides whether the pencil shows. */
function canEditSafeSection(post: PostDetail): boolean {
  return (
    post.isOwner &&
    (post.status === 'draft' ||
      post.status === 'pending_verification' ||
      post.status === 'active')
  );
}
/** The owner can deactivate + refund any PAID post — one whose bounty is held in
 *  escrow (active or pending_verification). A draft has nothing to refund. The
 *  server re-enforces this; the button is only convenience. */
function canDeactivate(post: PostDetail): boolean {
  return post.isOwner && (post.status === 'active' || post.status === 'pending_verification');
}
/** The owner can mark an ACTIVE post recovered. Narrower than canDeactivate on
 *  purpose: `claim_recovery` accepts `active` and nothing else, so offering
 *  this on a pending_verification post would show a button that always fails. */
function canMarkRecovered(post: PostDetail): boolean {
  return post.isOwner && post.status === 'active';
}
/** A credited spotter is waiting to be paid. `recovery_claimed` means the winner
 *  is chosen and the bounty is still in escrow — usually because they have not
 *  given Stripe their details yet, which is the expected first answer, not a
 *  fault. Before this row existed the owner had NO action on such a listing:
 *  every other one requires `active`, so crediting someone made the app go
 *  silent on the post it cared most about. */
function canReleasePayout(post: PostDetail): boolean {
  return post.isOwner && post.status === 'recovery_claimed';
}

export function PostDetailScreen({ postId }: PostDetailScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const toast = useToast();
  const requireAuth = useRequireAuth();
  const flagRef = useRef<ConfirmDialogRef>(null);
  // The owner's "Manage post" sheet and the ONE deactivate confirm — both the
  // sheet's row and the body's button open the latter, so the destructive copy
  // and the refund estimate exist in a single place.
  const manageRef = useRef<BottomSheetRef>(null);
  const deactivateRef = useRef<ConfirmDialogRef>(null);

  const { status, result, retry } = usePostDetail(postId);

  // Which section the owner is editing (a full-screen overlay), or null. Cleared
  // on cancel; on save it also refetches the detail so the change shows.
  const [editing, setEditing] = useState<EditableSection | null>(null);
  // Guards a double-tap on "Send the bounty". The transfer itself is idempotent
  // server-side, so this is about not firing two requests, not about safety.
  const [releasing, setReleasing] = useState(false);

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

  // Deactivate + refund (owner, paid posts). The hook wraps the Edge Function
  // call; the confirm step lives in PostDetailBody.
  const { deactivate, pending: deactivating } = useDeactivatePost();

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
    // "Manage post" opens the owner's action sheet for THIS listing. It used to
    // push /my-posts, which bounced the owner off the very post they were
    // managing onto a list containing it — a dead end.
    manageRef.current?.open();
  }, []);

  // Deactivate + refund. The confirm already fired (the dialog below); this
  // issues the server refund, toasts the EXACT refunded amount, and refetches so
  // the post now reads "Cancelled" and drops off public surfaces.
  const onDeactivate = useCallback(async () => {
    if (deactivating) {
      return; // guard a double-tap while the refund is in flight
    }
    const result = await deactivate(postId);
    if (result.outcome === 'done') {
      toast.show(`Listing deactivated — ${formatPounds(result.result.refundedPence)} refunded`);
      retry();
    } else {
      toast.show(result.message, 'error');
    }
  }, [deactivate, deactivating, postId, retry, toast]);

  // Both deactivate entry points (the body's button, the manage sheet's row)
  // open the same confirm — never the refund itself.
  const requestDeactivate = useCallback(() => {
    deactivateRef.current?.open();
  }, []);

  // No confirm dialog here, unlike deactivate: the recovery screen IS the
  // confirmation, and it asks something a yes/no cannot — WHICH sighting. A
  // dialog first would be a gate in front of a gate.
  const onRecovered = useCallback(() => {
    router.push({ pathname: '/recover-post', params: { postId } });
  }, [postId, router]);

  // Retrying a payout. Idempotent server-side (one transfer per post, forever),
  // so this needs no confirm — and `awaiting_payee` is reported as news rather
  // than as a failure, because it is: the spotter simply has not onboarded yet.
  const onReleasePayout = useCallback(async () => {
    if (releasing) {
      return;
    }
    setReleasing(true);
    try {
      const payout = await releasePayout(postId);
      if (payout.status === 'paid' && payout.transferPence !== null) {
        toast.show(`Sent. ${formatPounds(payout.transferPence)} is on its way to them.`);
        retry(); // the post is `recovered` now — reload so the screen agrees
      } else if (payout.status === 'held_for_review') {
        // Ours, not theirs: never the bank-details line here, or the owner
        // chases the spotter about a delay we caused on purpose.
        toast.show('We’re just double-checking this payout — no need to do anything.');
      } else {
        toast.show(
          'Not yet — they still need to add their bank details. It’ll send automatically when they do.',
        );
      }
    } catch (error) {
      toast.show(
        error instanceof RecoveryError ? error.message : 'We couldn’t send it. Please try again.',
        'error',
      );
    } finally {
      setReleasing(false);
    }
  }, [postId, releasing, retry, toast]);

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
                onMessageOwner={
                  result.post.isOwner ? undefined : () => onMessageOwner(result.post)
                }
                onShowAbout={onShowAbout}
                similarPosts={similar.posts}
                similarLoading={similar.status === 'loading'}
                onOpenPost={(next) => router.push(`/post/${next.id}`)}
                onEditCarDetails={
                  canEditSafeSection(result.post) ? () => setEditing('car_details') : undefined
                }
                onEditPhotos={
                  canEditDraftSection(result.post) ? () => setEditing('photos') : undefined
                }
                onEditLastSeen={
                  canEditDraftSection(result.post) ? () => setEditing('last_seen') : undefined
                }
                onEditBounty={
                  canEditDraftSection(result.post) ? () => setEditing('bounty') : undefined
                }
                onEditDescription={
                  canEditSafeSection(result.post) ? () => setEditing('description') : undefined
                }
                onEditTheftContext={
                  canEditSafeSection(result.post) ? () => setEditing('theft_context') : undefined
                }
                onEditDistinctiveFeatures={
                  canEditSafeSection(result.post)
                    ? () => setEditing('distinctive_features')
                    : undefined
                }
                onDeactivate={canDeactivate(result.post) ? requestDeactivate : undefined}
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

      {/* The owner's "Manage post" sheet — every action for THIS listing in one
          place. Each edit row is passed only when its section is editable, so
          the sheet can never offer something the server would reject. */}
      {visiblePost?.isOwner ? (
        <PostManageSheet
          ref={manageRef}
          sightingCount={visiblePost.sightingCount}
          onViewSightings={onViewSightings}
          onShare={() => onShare(visiblePost)}
          onEditCarDetails={
            canEditSafeSection(visiblePost) ? () => setEditing('car_details') : undefined
          }
          onEditPhotos={canEditDraftSection(visiblePost) ? () => setEditing('photos') : undefined}
          onEditLastSeen={
            canEditDraftSection(visiblePost) ? () => setEditing('last_seen') : undefined
          }
          onEditBounty={canEditDraftSection(visiblePost) ? () => setEditing('bounty') : undefined}
          onEditDescription={
            canEditSafeSection(visiblePost) ? () => setEditing('description') : undefined
          }
          onEditTheftContext={
            canEditSafeSection(visiblePost) ? () => setEditing('theft_context') : undefined
          }
          onEditDistinctiveFeatures={
            canEditSafeSection(visiblePost) ? () => setEditing('distinctive_features') : undefined
          }
          onDeactivate={canDeactivate(visiblePost) ? requestDeactivate : undefined}
          onReleasePayout={
            canReleasePayout(visiblePost) ? () => void onReleasePayout() : undefined
          }
        />
      ) : null}

      {/* The ONE deactivate confirm — destructive, opened by the body's button
          and the manage sheet's row alike. The refund figure is an estimate; the
          exact amount is confirmed in the toast after the server refunds. */}
      {visiblePost && canDeactivate(visiblePost) ? (
        <ConfirmDialog
          ref={deactivateRef}
          title="Deactivate this listing?"
          body={`We’ll take it down and refund about ${formatPounds(
            estimateRefundPence(visiblePost.bountyPence),
          )} to your card — the bounty minus the non-recoverable card fee. This can’t be undone.`}
          confirmLabel="Yes, deactivate"
          destructive
          onConfirm={onDeactivate}
        />
      ) : null}

      {/* Per-section edit overlay — mounts full-screen over the detail when the
          owner taps a pencil; on save it refetches so the change shows. */}
      {editing && visiblePost ? (
        <PostSectionEditorHost
          section={editing}
          post={visiblePost}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            retry();
          }}
        />
      ) : null}
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
