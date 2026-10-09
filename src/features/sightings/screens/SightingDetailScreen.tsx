/**
 * WHAT:  SightingDetailScreen — one sighting of the OWNER's car, examined in
 *        full, laid out like the post page:
 *        - the spotter's photos full-bleed and swipeable, the back button
 *          floating over them;
 *        - a content sheet with: where and when it was seen, and the owner's
 *          decision so far; "Where" (the map, how exact it is, the safety
 *          notice, Open in Maps); "What they saw" (their answers as labelled
 *          rows, their note, the owner's marks they could see); "Spotted by"
 *          (their record);
 *        - pinned to the bottom, the decision: "Is this your car?".
 * WHY:   Redesigned 2026-10-08 — the owner found the old page "hard to read
 *        and understand": no way back, the photos stacked one under another,
 *        an unlabelled line of answers and an unlabelled note, and the actual
 *        decision two quiet buttons at the bottom of it all. It also labelled
 *        a sighting the owner had REJECTED "Marked helpful", and took the
 *        irreversible "helpful" on a single tap.
 *
 *        Served from the SAME owner RPC as the list (usePostSightings), so
 *        there is exactly one payload — and one privacy review surface — for
 *        everything an owner can see. PRIVACY (§1): the spotter is first name
 *        + reputation only; "Message" opens chat by SIGHTING id (the server
 *        resolves the spotter); no uid ever reaches this client.
 *
 *        THE VERDICT GOES BOTH WAYS, and only one direction is reversible.
 *        "Not my car" (not_mine) bumps NOTHING, so it can be taken back for
 *        free, and the bar offers exactly that. "Yes" (helpful) CANNOT be
 *        undone — the counter has moved and the RPC refuses with
 *        ALREADY_COUNTED rather than strip a badge off someone's profile — so
 *        it is asked once more before it is sent. Both are about the CAR;
 *        neither is a judgement of the spotter, who answered a description in
 *        good faith.
 *
 *        A push can open this page directly (pushRoute), so the ids are
 *        checked before anything is fetched or logged, and "back" with nothing
 *        behind it goes to the post.
 * LINKS: src/app/sighting/[sightingId].tsx (route);
 *        src/features/sightings/hooks/usePostSightings.ts;
 *        src/features/sightings/api/sightingApi.ts (markSightingHelpful,
 *          markSightingNotMine); ../api/openSpotterThread.ts;
 *        ../components/SightingDetailHero.tsx, SightingWhereSection.tsx,
 *          SightingSeenSection.tsx, SightingSpotterCard.tsx,
 *          SightingDecisionBar.tsx; ../lib/sightingVerdict.ts;
 *        src/features/vehicles/screens/PostDetailScreen.tsx (the same frame);
 *        docs/DOMAIN.md (Reputation v1); docs/SECURITY_AND_TRUST.md §1.
 */

import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Linking, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import type { PublicProfileSheetProps } from '@/features/profile';
import { useNow, useTimeAgo } from '@/shared/hooks';
import { formatDateTimeLabel, mapPinUrl, spokenAgo } from '@/shared/lib';
import { createLogger } from '@/shared/lib/logger';
import { radii, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import {
  AppHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  HEADER_BAR_HEIGHT,
  SAFETY_NOTICE_BODY,
  StatusPill,
  useToast,
  type BottomSheetRef,
  type ConfirmDialogRef,
} from '@/shared/ui';

import { openSpotterThread } from '../api/openSpotterThread';
import { markSightingHelpful, markSightingNotMine, SightingVerdictError } from '../api/sightingApi';
import { SightingDecisionBar } from '../components/SightingDecisionBar';
import { SightingDetailHero } from '../components/SightingDetailHero';
import { hasSeenDetails, SightingSeenSection } from '../components/SightingSeenSection';
import { SightingSpotterCard } from '../components/SightingSpotterCard';
import { SightingWhereSection } from '../components/SightingWhereSection';
import { usePostSightings } from '../hooks/usePostSightings';
import { isConfirmedVerdict, isGoneSighting, sightingVerdictLabel } from '../lib/sightingVerdict';
import type { OwnerSighting } from '../types';

const log = createLogger('sightings');

/** The hero's height as a share of the width — the post page's. */
const HERO_RATIO = 0.85;
/** Scroll distance over which the header fades transparent → solid. */
const FADE_TRAVEL = 48;
/** How often "Today, 14:30" re-checks what today is. */
const CLOCK_TICK_MS = 60_000;

const isGuid = (value: string) => z.guid().safeParse(value).success;

export interface SightingDetailScreenProps {
  postId: string;
  sightingId: string;
}

/** The answer the owner just gave, until the server's own copy catches up. */
interface LocalVerdict {
  status: OwnerSighting['status'];
  reviewedAt: string | null;
  /** The server status it was given over. The override holds only while the
   *  server still says this, so a later change (credited after a recovery,
   *  an answer from another device) is never masked by a stale local one. */
  from: OwnerSighting['status'];
}

export function SightingDetailScreen({ postId, sightingId }: SightingDetailScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // A crafted link (trackitdown://sighting/…) must not reach the RPC or the
  // logs: an id that isn't one is simply "not available".
  const idsValid = isGuid(postId) && isGuid(sightingId);
  const { status, sightings, photoUrls, retry } = usePostSightings(postId, idsValid);
  const found = idsValid ? (sightings.find((s) => s.id === sightingId) ?? null) : null;
  // A withdrawn sighting is the spotter's to take back; it reads as gone.
  const sighting = found && !isGoneSighting(found.status) ? found : null;
  const loading = idsValid && status === 'loading';
  const failed = idsValid && status === 'error';

  // The header fades in as the hero scrolls away — the post page's frame.
  const heroHeight = Math.round(width * HERO_RATIO);
  const fadeEnd = Math.max(FADE_TRAVEL, heroHeight - radii.xl - insets.top - HEADER_BAR_HEIGHT);
  const fadeStart = fadeEnd - FADE_TRAVEL;
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  // The status can advance locally without a refetch; the server is the
  // source of truth and this mirrors its reply only. So does the time of the
  // decision, so "You decided just now" shows at once.
  const [local, setLocal] = useState<LocalVerdict | null>(null);
  const localApplies = local !== null && sighting !== null && sighting.status === local.from;
  const effectiveStatus = localApplies ? local.status : (sighting?.status ?? 'unverified');
  const reviewedAt = localApplies ? local.reviewedAt : (sighting?.reviewedAt ?? null);

  // Which answer is on its way — so the spinner sits on THAT button.
  const [pending, setPending] = useState<'yes' | 'not_mine' | null>(null);
  const [opening, setOpening] = useState(false);

  // Peer profile sheet — component deferred-loaded (profile ↔ sightings graphs
  // stay apart in tests; same pattern as ChatThreadScreen). The DATA is
  // already here: the sighting's narrow spotter passport.
  const [PeerSheet, setPeerSheet] = useState<ComponentType<PublicProfileSheetProps> | null>(null);
  const [peerProfile, setPeerProfile] = useState<PublicProfileSheetProps['profile']>(null);
  const peerSheetRef = useRef<BottomSheetRef>(null);
  const mapsConfirmRef = useRef<ConfirmDialogRef>(null);
  const yesConfirmRef = useRef<ConfirmDialogRef>(null);

  // A notification can open this page with nothing behind it.
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else if (isGuid(postId)) router.replace(`/post/${postId}`);
    else router.replace('/');
  };

  const openSpotterProfile = async () => {
    if (!sighting) return;
    try {
      const profileFeature = await import('@/features/profile');
      setPeerSheet(() => profileFeature.PublicProfileSheet);
      // The narrow passport, shaped to PublicProfile — nothing beyond what
      // the sighting payload already carries (first name + counters + since).
      setPeerProfile({
        firstName: sighting.spotter.firstName,
        avatarUrl: null,
        createdAt: sighting.spotter.memberSince,
        counters: {
          sightingsReported: sighting.spotter.sightingsReported,
          sightingsHelpful: sighting.spotter.sightingsHelpful,
          recoveriesCredited: sighting.spotter.recoveriesCredited,
        },
      });
    } catch {
      toast.show('We couldn’t open their profile just now.', 'error');
    }
  };
  useEffect(() => {
    if (PeerSheet && peerProfile) peerSheetRef.current?.open();
  }, [PeerSheet, peerProfile]);

  const messageSpotter = async () => {
    if (!sighting || opening) return;
    setOpening(true);
    try {
      // By SIGHTING id — never a spotter id (§1); chat loads on demand.
      const { threadId } = await openSpotterThread(sighting.id);
      router.push(`/chat/${threadId}`);
    } catch (err) {
      toast.show(
        err instanceof Error && err.message ? err.message : 'We couldn’t open the conversation.',
        'error',
      );
    } finally {
      setOpening(false);
    }
  };

  /** Mirror the server's reply; a no-op reply keeps the server's own time. */
  const recordVerdict = (
    from: OwnerSighting,
    result: { status: OwnerSighting['status']; changed: boolean },
  ) => {
    setLocal({
      status: result.status,
      reviewedAt: result.changed ? new Date().toISOString() : from.reviewedAt,
      from: from.status,
    });
  };

  // "Yes, it's my car" — only ever reached through yesConfirmRef: it credits
  // the spotter's reputation and cannot be undone.
  const confirmYes = async () => {
    if (!sighting || pending) return;
    setPending('yes');
    try {
      const result = await markSightingHelpful(sighting.id);
      recordVerdict(sighting, result);
      if (result.changed) {
        // ⚠️ ONE MESSAGE, WHATEVER `counted` SAYS. `counted: false` has two
        // causes — an honest rule (a spotter earns one point per LISTING) and
        // a collusion flag — and the RPC returns the identical shape for both
        // ON PURPOSE: copy that told them apart would tell someone which
        // signal caught them (_shared/collusion.ts). "Already has credit for
        // this listing" was true of one cause only, and an owner confirming
        // their first sighting would know it false (security review of #145).
        // So this says what is true of every outcome, and nothing more.
        //
        // Never write "this didn't count because…" here.
        toast.show(`Confirmed — we’ve let ${sighting.spotter.firstName} know.`, 'success');
      }
    } catch {
      toast.show('We couldn’t confirm that just now.', 'error');
    } finally {
      setPending(null);
    }
  };

  const markNotMine = async () => {
    if (!sighting || pending) return;
    setPending('not_mine');
    try {
      const result = await markSightingNotMine(sighting.id);
      recordVerdict(sighting, result);
      if (result.changed) {
        // About the CAR, and reversible. Never "rejected", never anything that
        // reads as a verdict on the person: they answered a description in good
        // faith on a car that looked like the one they were shown, and this
        // costs them nothing — no counter moves either way.
        toast.show('Marked as not your car. You can change this.', 'success');
      }
    } catch (error) {
      toast.show(
        error instanceof SightingVerdictError
          ? error.message
          : 'We couldn’t update that sighting just now.',
        'error',
      );
    } finally {
      setPending(null);
    }
  };

  useEffect(() => {
    if (idsValid) log.info('sighting_detail_viewed', { postId, sightingId });
  }, [idsValid, postId, sightingId]);

  const locatedPhoto =
    sighting?.photos.find((photo) => photo.lat !== null && photo.lng !== null) ?? null;

  // Hand the captured point to whatever maps app the device has. A device can
  // genuinely have none (stripped Android builds), and openURL then rejects —
  // so this is a toast, never an unhandled rejection.
  const openInMaps = async () => {
    if (!locatedPhoto) return;
    const url = mapPinUrl(
      locatedPhoto.lat as number,
      locatedPhoto.lng as number,
      'Car sighted here',
    );
    try {
      await Linking.openURL(url);
      log.info('sighting_map_opened', { postId, sightingId });
    } catch {
      toast.show('We couldn’t open your maps app.', 'error');
    }
  };

  // Clear of the floating header. No side gutter: ErrorState and EmptyState
  // pad themselves, and a second 24 put their text 48 in from each edge.
  const stateTop = { paddingTop: insets.top + HEADER_BAR_HEIGHT };

  return (
    <View style={styles.container}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
      >
        {loading ? (
          <SightingDetailSkeleton heroHeight={heroHeight} />
        ) : failed ? (
          <View style={stateTop}>
            <ErrorState body="We couldn’t load this sighting." onRetry={retry} />
          </View>
        ) : !sighting ? (
          // Ready but absent — a stale link (the list changed, the spotter
          // withdrew it, or an id that was never one). Not an error: an honest
          // dead-end with a way back, and no oracle about why.
          <View style={stateTop}>
            <EmptyState
              title="This sighting isn’t available any more"
              body="The link may be out of date."
              actionLabel="Go back"
              onAction={goBack}
            />
          </View>
        ) : (
          <>
            <SightingDetailHero
              photos={sighting.photos}
              photoUrls={photoUrls}
              width={width}
              height={heroHeight}
            />
            {/* The content sheet: rounded top riding up over the hero's foot,
                as on the post page. */}
            <View style={styles.sheet}>
              <SightingTitle sighting={sighting} status={effectiveStatus} reviewedAt={reviewedAt} />

              {/* The safety notice lives here, beside the exact point and
                  above Open in Maps (SightingWhereSection). */}
              <Section title="Where">
                <SightingWhereSection
                  point={
                    locatedPhoto
                      ? {
                          lat: locatedPhoto.lat as number,
                          lng: locatedPhoto.lng as number,
                          accuracyM: locatedPhoto.accuracyM,
                        }
                      : null
                  }
                  areaLabel={sighting.locationUnavailable ? null : sighting.areaLabel}
                  onOpenMaps={() => mapsConfirmRef.current?.open()}
                />
              </Section>

              {hasSeenDetails(sighting) ? (
                <Section title="What they saw">
                  <SightingSeenSection sighting={sighting} />
                </Section>
              ) : null}

              <Section title="Spotted by">
                <SightingSpotterCard
                  spotter={sighting.spotter}
                  onViewProfile={() => void openSpotterProfile()}
                  // Before the decision, to ask a question first; after it,
                  // Message is the pinned bar's.
                  onMessage={
                    effectiveStatus === 'unverified' ? () => void messageSpotter() : undefined
                  }
                  messaging={opening}
                />
              </Section>
            </View>
          </>
        )}
      </Animated.ScrollView>

      {sighting && !loading && !failed ? (
        <SightingDecisionBar
          status={effectiveStatus}
          spotterName={sighting.spotter.firstName}
          onYes={() => yesConfirmRef.current?.open()}
          onNotMine={() => void markNotMine()}
          onMessage={() => void messageSpotter()}
          pending={pending}
          messaging={opening}
        />
      ) : null}

      <AppHeader
        title="Sighting"
        scrollY={scrollY}
        fadeStart={fadeStart}
        fadeEnd={fadeEnd}
        onBack={goBack}
      />

      {/* The irreversible answer, asked once more — in other words than the
          bar's question, so the second tap reads as a step forward. It
          promises only what is true: they hear it helped (reputation), which
          is not the reward — that is the recovery's. */}
      <ConfirmDialog
        ref={yesConfirmRef}
        title="Confirm it’s your car?"
        body={`Confirming tells ${sighting?.spotter.firstName ?? 'the spotter'} their sighting helped. You can’t undo this.`}
        confirmLabel="Yes, it’s my car"
        onConfirm={() => void confirmYes()}
      />

      {/* The §1 notice, restated at the one moment it is most likely to be
          ignored. The BODY is IMPORTED, never retyped: a hand-typed second copy
          drifts, and this one already had. The title is this moment's, the
          warning is the app's one canonical sentence — including 999. */}
      <ConfirmDialog
        ref={mapsConfirmRef}
        title="Opening the map — please don’t approach"
        body={SAFETY_NOTICE_BODY}
        confirmLabel="Open in Maps"
        onConfirm={() => void openInMaps()}
      />

      {PeerSheet ? (
        <PeerSheet
          ref={peerSheetRef}
          profile={peerProfile}
          onDismiss={() => setPeerProfile(null)}
        />
      ) : null}
    </View>
  );
}

/** A divider, then a titled section — the post page's rhythm. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <>
      <View style={styles.divider} />
      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
        {children}
      </View>
    </>
  );
}

/** "Seen near Deansgate", when, and the owner's decision so far. */
function SightingTitle({
  sighting,
  status,
  reviewedAt,
}: {
  sighting: OwnerSighting;
  status: OwnerSighting['status'];
  reviewedAt: string | null;
}) {
  const styles = useThemedStyles(makeStyles);
  // When it was SEEN: an in-app photo's capture moment. A library photo's
  // time says nothing about when the car was there (ADR-0003), so without a
  // live photo this falls back to when the sighting was sent.
  const seenAt =
    sighting.photos.find((photo) => photo.source === 'live')?.capturedAt ?? sighting.createdAt;
  const ago = useTimeAgo(seenAt);
  // A held clock, not `new Date()` in render: the React Compiler would freeze
  // that, and "Today" would stay today past midnight.
  const now = useNow(CLOCK_TICK_MS);
  let date: string | null = null;
  try {
    date = formatDateTimeLabel(seenAt, now);
  } catch {
    // An unparseable timestamp costs the date, never the page.
  }

  return (
    <View style={styles.titleBlock}>
      <Text style={styles.title} accessibilityRole="header">
        {sighting.locationUnavailable || !sighting.areaLabel
          ? 'Sighting'
          : `Seen near ${sighting.areaLabel}`}
      </Text>
      <Text
        style={styles.meta}
        accessibilityLabel={`Seen ${spokenAgo(ago)}${date ? `, ${date}` : ''}`}
      >
        {date ? `${ago} · ${date}` : ago}
      </Text>
      <DecisionLine status={status} reviewedAt={reviewedAt} />
    </View>
  );
}

/** The owner's decision, and when they made it — read as one line.
 *
 *  ⚠️ MAPPED (sightingVerdict), not a two-way branch: the old header read
 *  `credited ? 'Credited' : 'Marked helpful'`, so a sighting the owner had
 *  said was NOT their car was labelled "Marked helpful" — the exact opposite
 *  of their answer (SightingTimeline fixed the same bug). */
function DecisionLine({
  status,
  reviewedAt,
}: {
  status: OwnerSighting['status'];
  reviewedAt: string | null;
}) {
  const label = sightingVerdictLabel(status);
  if (!label) return null;
  return reviewedAt ? (
    <DecidedLine label={label} status={status} reviewedAt={reviewedAt} />
  ) : (
    <DecisionRow label={label} status={status} accessibilityLabel={`Your answer: ${label}`} />
  );
}

/** The decision with its time — its own component, so the clock only ticks
 *  once there is a decision to time. */
function DecidedLine({
  label,
  status,
  reviewedAt,
}: {
  label: string;
  status: OwnerSighting['status'];
  reviewedAt: string;
}) {
  const ago = useTimeAgo(reviewedAt);
  return (
    <DecisionRow
      label={label}
      status={status}
      accessibilityLabel={`Your answer: ${label}, decided ${spokenAgo(ago)}`}
      ago={ago}
    />
  );
}

function DecisionRow({
  label,
  status,
  accessibilityLabel,
  ago,
}: {
  label: string;
  status: OwnerSighting['status'];
  accessibilityLabel: string;
  ago?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View
      style={styles.decisionRow}
      accessible
      accessibilityLabel={accessibilityLabel}
      testID="sighting-decision"
    >
      {/* Primary ink for a confirmation, not success green — sage stays
          reserved for payout moments; "Not your car" is the quiet one. */}
      <StatusPill label={label} tone={isConfirmedVerdict(status) ? 'primary' : 'neutral'} />
      {ago ? <Text style={styles.meta}>You decided {ago}</Text> : null}
    </View>
  );
}

/** The page's own shape while it loads: the hero, then the sheet's first
 *  lines at the heights the real ones will have, so nothing jumps. */
function SightingDetailSkeleton({ heroHeight }: { heroHeight: number }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View accessible accessibilityLabel="Loading sighting" testID="sighting-detail-skeleton">
      <View style={[styles.skeletonHero, { height: heroHeight }]} />
      <View style={[styles.sheet, styles.skeletonSheet]}>
        <View style={styles.skeletonTitle} />
        <View style={styles.skeletonMeta} />
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
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
      paddingHorizontal: spacing.xl,
    },
    // The first block carries its own clearance from the sheet's curved top.
    titleBlock: {
      paddingTop: spacing.xl,
      paddingBottom: spacing.xxl,
      gap: spacing.xs,
    },
    // The page's title outranks its section titles (24 against 20).
    title: {
      ...typography.title,
      color: c.textPrimary,
    },
    meta: {
      ...typography.caption,
      color: c.textSecondary,
    },
    decisionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.border,
    },
    // The post page's rhythm: 32 each side of a divider, 16 title → content.
    section: {
      paddingVertical: spacing.xxl,
      gap: spacing.lg,
    },
    sectionTitle: {
      ...typography.sectionTitle,
      color: c.textPrimary,
      includeFontPadding: false,
    },
    skeletonHero: {
      backgroundColor: c.surfaceSubtle,
    },
    skeletonSheet: {
      paddingTop: spacing.xl,
      gap: spacing.xs,
    },
    skeletonTitle: {
      height: typography.title.lineHeight,
      width: '60%',
      borderRadius: radii.sm,
      backgroundColor: c.surfaceSubtle,
    },
    skeletonMeta: {
      height: typography.caption.lineHeight,
      width: '40%',
      borderRadius: radii.sm,
      backgroundColor: c.surfaceSubtle,
    },
  });
