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
import { exitCheck, useDeactivatePost } from '@/features/payments';
import { useWatchToggle } from '@/features/watchlist';
import { bountyParam, estimateRefundPence, formatPounds } from '@/shared/lib';
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
  type BottomSheetRef,
  type ConfirmDialogRef,
} from '@/shared/ui';

import { flagPost } from '../api/flagApi';
import { RecoveryError, releasePayout } from '../api/recoveryApi';
import { ExitAttestation } from '../components/ExitAttestation';
import { PostSectionEditorHost, type EditableSection } from '../components/editors';
import { PostBottomBar } from '../components/PostBottomBar';
import { PostDetailBody } from '../components/PostDetailBody';
import { PostHero } from '../components/PostHero';
import { PostManageSheet } from '../components/PostManageSheet';
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
/**
 * The owner can DELETE an unpaid draft. The exact complement of canDeactivate:
 * a draft has no escrow to refund, and a paid listing can never be deleted —
 * money that moved must leave a record.
 *
 * Deliberately not `!canDeactivate(post)`: the statuses that are neither
 * (recovered, cancelled, expired…) must offer nothing at all, and writing it as
 * a negation would quietly hand them a delete the server would refuse.
 */
function canDeleteDraft(post: PostDetail): boolean {
  return post.isOwner && post.status === 'draft';
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
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
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
  const deleteDraftRef = useRef<ConfirmDialogRef>(null);
  // Guards a double-tap while the delete is in flight. The Edge Function cancels
  // Stripe intents before deleting, so a second run mid-flight would race the
  // first over rows it is already removing.
  const [deleting, setDeleting] = useState(false);

  const { status, result, retry, refreshing, refresh } = usePostDetail(postId);

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

  const onViewSightings = useCallback(() => {
    router.push({ pathname: '/post-sightings', params: { postId } });
  }, [postId, router]);

  const onViewStats = useCallback(() => {
    router.push({ pathname: '/post-stats', params: { postId } });
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
    // "Manage post" opens the owner's action sheet for THIS listing. It used to
    // push /my-posts, which bounced the owner off the very post they were
    // managing onto a list containing it — a dead end.
    manageRef.current?.open();
  }, []);

  // The owner-denial attestation (DOMAIN.md Disputes): when the server says
  // recent uncredited sightings exist, deactivation detours through a look at
  // exactly those sightings before any refund can be held.
  const [attestation, setAttestation] = useState<{
    sightingIds: string[];
    holdHours: number;
  } | null>(null);

  // What the deactivate toast says. The server returns the EXACT refunded
  // amount, and for a no-reward listing that amount is 0 — its fixed fee is not
  // refundable (ADR-0014). "£0 refunded" would read as a failed refund rather
  // than as a listing that never had one, so the zero case gets its own sentence
  // instead of being formatted like money that moved.
  const deactivatedToast = (refundedPence: number) =>
    refundedPence > 0
      ? `Listing deactivated — ${formatPounds(refundedPence)} refunded`
      : 'Listing deactivated';

  // Deactivate + refund. The confirm already fired (the dialog below); this
  // issues the server refund, toasts the EXACT refunded amount, and refetches so
  // the post now reads "Cancelled" and drops off public surfaces.
  const onDeactivate = useCallback(async () => {
    if (deactivating) {
      return; // guard a double-tap while the refund is in flight
    }
    const result = await deactivate(postId);
    if (result.outcome === 'done') {
      toast.show(deactivatedToast(result.result.refundedPence));
      retry();
    } else if (result.outcome === 'held') {
      // Reachable only if sightings appeared between the pre-flight and now.
      toast.show(heldToast(result.refundAfter));
      retry();
    } else {
      toast.show(result.message, 'error');
    }
  }, [deactivate, deactivating, postId, retry, toast]);

  // Delete an unpaid draft, for good. The confirm has already fired.
  //
  // Routes AWAY on success rather than refetching, unlike every other action
  // here: there is no post left to refetch, and leaving the owner on the detail
  // screen of something that no longer exists would show them an error for
  // having succeeded.
  const onDeleteDraft = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      const { deleteDraft } = await import('../api/draftApi');
      await deleteDraft(postId);
      toast.show('Draft deleted');
      router.replace('/my-posts');
    } catch (error) {
      // The api maps every server code to copy a person can act on — including
      // the two that must NOT say "try again": money that moved, and a payment
      // still settling.
      toast.show(
        error instanceof Error && error.message
          ? error.message
          : 'We couldn’t delete that draft. Please try again.',
        'error',
      );
    } finally {
      setDeleting(false);
    }
  }, [deleting, postId, router, toast]);

  // The attested exit: same call, carrying exactly what the owner was shown.
  const onAttestedDeactivate = useCallback(
    async (attestedSightingIds: string[]) => {
      if (deactivating) {
        return;
      }
      const result = await deactivate(postId, attestedSightingIds);
      if (result.outcome === 'held') {
        setAttestation(null);
        toast.show(heldToast(result.refundAfter));
        retry();
      } else if (result.outcome === 'done') {
        // The trigger set emptied server-side (sightings aged out) — the
        // refund simply went through.
        setAttestation(null);
        toast.show(deactivatedToast(result.result.refundedPence));
        retry();
      } else if (result.code === 'ATTESTATION_STALE') {
        // A sighting landed mid-confirm. Refresh the set and ask again.
        toast.show(result.message, 'error');
        try {
          const check = await exitCheck(postId);
          setAttestation(
            check.requiresAttestation
              ? { sightingIds: check.sightingIds, holdHours: check.holdHours }
              : null,
          );
        } catch {
          setAttestation(null);
        }
      } else {
        toast.show(result.message, 'error');
      }
    },
    [deactivate, deactivating, postId, retry, toast],
  );

  // Both deactivate entry points (the body's button, the manage sheet's row)
  // land here. The pre-flight decides which door: recent sightings → the
  // attestation; none → the plain destructive confirm, exactly as before.
  // A failed pre-flight opens the plain confirm — enforcement is the SERVER's
  // (the gate re-checks), so degrading here costs honesty nothing.
  const requestDeactivate = useCallback(() => {
    void (async () => {
      // SKIPPED on a no-reward listing (ADR-0014): `exit_check` is purely
      // sighting-based and knows nothing about pricing, so it would open
      // ExitAttestation — "one thing before your refund", "your refund is sent
      // after N hours" — for a listing that has no refund and gets no hold.
      // deactivate-post already returns before the owner-denial gate for these,
      // so the sheet only ever asked a victim to attest under a false premise.
      if (visiblePost?.bountyPence !== null) {
        try {
          const check = await exitCheck(postId);
          if (check.requiresAttestation) {
            setAttestation({ sightingIds: check.sightingIds, holdHours: check.holdHours });
            return;
          }
        } catch (err) {
          log.warn('exit_check pre-flight failed', {
            code: err instanceof Error ? err.message : 'UNKNOWN',
          });
        }
      }
      deactivateRef.current?.open();
    })();
  }, [postId, visiblePost]);

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
          onViewStats={onViewStats}
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
          onDeleteDraft={
            canDeleteDraft(visiblePost) ? () => deleteDraftRef.current?.open() : undefined
          }
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
          body={
            visiblePost.bountyPence === null
              ? // No bounty means no refund, and the listing fee is not
                // refundable (ADR-0014). The destructive confirm must not
                // promise money back that is not coming.
                'We’ll take it down. Your listing fee isn’t refunded. This can’t be undone.'
              : `We’ll take it down and refund about ${formatPounds(
                  estimateRefundPence(visiblePost.bountyPence),
                )} to your card — the bounty minus the non-recoverable card fee. This can’t be undone.`
          }
          confirmLabel="Yes, deactivate"
          destructive
          onConfirm={onDeactivate}
        />
      ) : null}

      {/* The delete confirm. Says "permanently" and "can't be undone" in the
          body rather than softening it: there is no tombstone, no undo and no
          support route back — the row is gone. The only reason it can be this
          blunt is that a draft has been seen by nobody but its owner.

          It does NOT mention payment. A draft may carry an abandoned
          PaymentIntent, but that is the Edge Function's problem to cancel, and
          raising it here would make an owner deleting a form think they were
          about to lose money. If money HAS moved, the server refuses and the
          error explains it — which is the right moment for that sentence. */}
      {visiblePost && canDeleteDraft(visiblePost) ? (
        <ConfirmDialog
          ref={deleteDraftRef}
          title="Delete this draft?"
          body="This removes it permanently. Nobody has seen it and nothing has been charged. This can’t be undone."
          confirmLabel="Yes, delete"
          destructive
          onConfirm={onDeleteDraft}
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

      {/* The owner-denial attestation — full-screen and OPAQUE (the transparent
          Modal bleed-through lesson), mounted over everything when the exit
          pre-flight found recent sightings. */}
      {attestation ? (
        <View style={[styles.attestationOverlay, { paddingTop: insets.top + spacing.lg }]}>
          <ExitAttestation
            postId={postId}
            sightingIds={attestation.sightingIds}
            holdHours={attestation.holdHours}
            busy={deactivating}
            onConfirm={(ids) => void onAttestedDeactivate(ids)}
            onCredit={() => {
              setAttestation(null);
              // Crediting IS the recovery flow — it already knows how to ask
              // which sighting and to move the money the right way. Carries the
              // pricing mode for the same reason as onRecovered above.
              router.push({
                pathname: '/recover-post',
                params: visiblePost
                  ? { postId, bounty: bountyParam(visiblePost.bountyPence) }
                  : { postId },
              });
            }}
            onCancel={() => setAttestation(null)}
          />
        </View>
      ) : null}
    </View>
  );
}

/** The one sentence for a held refund, with the real date in it. */
function heldToast(refundAfter: string): string {
  const date = new Date(refundAfter);
  const when = Number.isNaN(date.getTime())
    ? 'the 72-hour window'
    : date.toLocaleString('en-GB', { weekday: 'long', hour: 'numeric', minute: '2-digit' });
  return `Listing deactivated. Your refund is sent after ${when}, unless a sighting is contested.`;
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
  attestationOverlay: {
    // Explicit insets, not absoluteFillObject (typecheck) — and an OPAQUE
    // background: money copy must never render over half-visible content.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: c.background,
    padding: spacing.xl,
  },
});
