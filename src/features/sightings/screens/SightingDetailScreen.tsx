/**
 * WHAT:  SightingDetailScreen — one sighting of the OWNER's car, examined in
 *        full, laid out like the post page:
 *        - the spotter's photos full-bleed and swipeable, the back button
 *          floating over them;
 *        - a content sheet with: where and when it was seen, and the owner's
 *          decision so far; "Where" (the map, how exact it is, Open in Maps);
 *          "What they saw" (their answers as labelled rows, their note, the
 *          owner's marks they could see); "Spotted by" (their record);
 *          the safety notice;
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
 * LINKS: src/app/sighting/[sightingId].tsx (route);
 *        src/features/sightings/hooks/usePostSightings.ts;
 *        src/features/sightings/api/sightingApi.ts (markSightingHelpful,
 *          markSightingNotMine);
 *        ../components/SightingDetailHero.tsx, SightingWhereSection.tsx,
 *          SightingSeenSection.tsx, SightingSpotterCard.tsx,
 *          SightingDecisionBar.tsx;
 *        src/features/vehicles/screens/PostDetailScreen.tsx (the same frame);
 *        docs/DOMAIN.md (Reputation v1); docs/SECURITY_AND_TRUST.md §1.
 */

import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Linking, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { PublicProfileSheetProps } from '@/features/profile';
import { useNow, useTimeAgo } from '@/shared/hooks';
import { formatDateTimeLabel, mapPinUrl } from '@/shared/lib';
import { createLogger } from '@/shared/lib/logger';
import { radii, sizes, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import {
  AppHeader,
  ConfirmDialog,
  ErrorState,
  HEADER_BAR_HEIGHT,
  SAFETY_NOTICE_BODY,
  SafetyNotice,
  useToast,
  type BottomSheetRef,
  type ConfirmDialogRef,
} from '@/shared/ui';

import { markSightingHelpful, markSightingNotMine, SightingVerdictError } from '../api/sightingApi';
import { SightingDecisionBar } from '../components/SightingDecisionBar';
import { SightingDetailHero } from '../components/SightingDetailHero';
import { hasSeenDetails, SightingSeenSection } from '../components/SightingSeenSection';
import { SightingSpotterCard } from '../components/SightingSpotterCard';
import { SightingWhereSection } from '../components/SightingWhereSection';
import { usePostSightings } from '../hooks/usePostSightings';
import { openSpotterThread } from '../lib/openSpotterThread';
import type { OwnerSighting } from '../types';

const log = createLogger('sightings');

/** The hero's height as a share of the width — the post page's. */
const HERO_RATIO = 0.85;
/** Scroll distance over which the header fades transparent → solid. */
const FADE_TRAVEL = 48;
/** How often "Today, 14:30" re-checks what today is. */
const CLOCK_TICK_MS = 60_000;

export interface SightingDetailScreenProps {
  postId: string;
  sightingId: string;
}

export function SightingDetailScreen({ postId, sightingId }: SightingDetailScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { status, sightings, photoUrls, retry } = usePostSightings(postId);
  const sighting = sightings.find((s) => s.id === sightingId) ?? null;

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
  const [localStatus, setLocalStatus] = useState<OwnerSighting['status'] | null>(null);
  const [localReviewedAt, setLocalReviewedAt] = useState<string | null>(null);
  const effectiveStatus = localStatus ?? sighting?.status ?? 'unverified';
  const reviewedAt = localReviewedAt ?? sighting?.reviewedAt ?? null;

  const [marking, setMarking] = useState(false);
  const [opening, setOpening] = useState(false);

  // Peer profile sheet — component deferred-loaded (profile ↔ sightings graphs
  // stay apart in tests; same pattern as ChatThreadScreen). The DATA is
  // already here: the sighting's narrow spotter passport.
  const [PeerSheet, setPeerSheet] = useState<ComponentType<PublicProfileSheetProps> | null>(null);
  const [peerProfile, setPeerProfile] = useState<PublicProfileSheetProps['profile']>(null);
  const peerSheetRef = useRef<BottomSheetRef>(null);
  const mapsConfirmRef = useRef<ConfirmDialogRef>(null);
  const yesConfirmRef = useRef<ConfirmDialogRef>(null);

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

  // "Yes, it's my car" — only ever reached through yesConfirmRef: it credits
  // the spotter and cannot be undone.
  const confirmYes = async () => {
    if (!sighting || marking) return;
    setMarking(true);
    try {
      const result = await markSightingHelpful(sighting.id);
      setLocalStatus(result.status);
      if (result.changed) {
        setLocalReviewedAt(new Date().toISOString());
        // ⚠️ `counted: false` HAS TWO CAUSES AND THEY MUST READ THE SAME.
        // One is an honest rule — a spotter earns one point per LISTING, so a
        // second confirmation on the same car records the verdict and bumps
        // nothing. The other is a collusion flag. The RPC returns the identical
        // shape for both ON PURPOSE, because copy that distinguished them would
        // tell someone which signal caught them, and that is a tutorial in
        // evading it (_shared/collusion.ts). So this says what is TRUE of both
        // and no more: it counted as a confirmation, not as a new point.
        //
        // Never write "this didn't count because…" here.
        toast.show(
          result.counted
            ? `Confirmed — ${sighting.spotter.firstName} gets the credit.`
            : `Confirmed — ${sighting.spotter.firstName} already has credit for this listing.`,
          'success',
        );
      }
    } catch {
      toast.show('We couldn’t confirm that just now.', 'error');
    } finally {
      setMarking(false);
    }
  };

  const markNotMine = async () => {
    if (!sighting || marking) return;
    setMarking(true);
    try {
      const result = await markSightingNotMine(sighting.id);
      setLocalStatus(result.status);
      if (result.changed) {
        setLocalReviewedAt(new Date().toISOString());
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
      setMarking(false);
    }
  };

  useEffect(() => {
    log.info('sighting_detail_viewed', { postId, sightingId });
  }, [postId, sightingId]);

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

  const stateTop = { paddingTop: insets.top + HEADER_BAR_HEIGHT };

  return (
    <View style={styles.container}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
      >
        {status === 'loading' ? (
          <SightingDetailSkeleton heroHeight={heroHeight} />
        ) : status === 'error' ? (
          <View style={[styles.stateBlock, stateTop]}>
            <ErrorState body="We couldn’t load this sighting." onRetry={retry} />
          </View>
        ) : !sighting ? (
          // Ready but absent — a stale link (the list changed, or a sighting
          // was withdrawn). An honest dead-end, no oracle about why.
          <View style={[styles.stateBlock, stateTop]}>
            <ErrorState
              body="This sighting isn’t available any more."
              onRetry={() => router.back()}
              retryLabel="Go back"
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

              {/* Every sighting screen (DOMAIN §1): this is the exact captured
                  point; the owner may be tempted to act. */}
              <View style={styles.notice}>
                <SafetyNotice />
              </View>
            </View>
          </>
        )}
      </Animated.ScrollView>

      {sighting && status !== 'loading' && status !== 'error' ? (
        <SightingDecisionBar
          status={effectiveStatus}
          spotterName={sighting.spotter.firstName}
          onYes={() => yesConfirmRef.current?.open()}
          onNotMine={() => void markNotMine()}
          onMessage={() => void messageSpotter()}
          deciding={marking}
          messaging={opening}
        />
      ) : null}

      <AppHeader
        title="Sighting"
        scrollY={scrollY}
        fadeStart={fadeStart}
        fadeEnd={fadeEnd}
        onBack={() => router.back()}
      />

      {/* The irreversible answer, asked once more. Names who gets the credit,
          because that is what "yes" actually does. */}
      <ConfirmDialog
        ref={yesConfirmRef}
        title="Is this your car?"
        body={`Confirming tells ${sighting?.spotter.firstName ?? 'the spotter'} their sighting helped, and they get the credit for spotting it. You can’t undo this.`}
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
  // When it was SEEN — the first photo's capture time — not when it was sent.
  const seenAt = sighting.photos[0]?.capturedAt ?? sighting.createdAt;
  const ago = useTimeAgo(seenAt);
  // A held clock, not `new Date()` in render: the React Compiler would freeze
  // that, and "Today" would stay today past midnight.
  const now = useNow(CLOCK_TICK_MS);
  let when = ago;
  try {
    when = `${ago} · ${formatDateTimeLabel(seenAt, now)}`;
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
      <Text style={styles.meta}>{when}</Text>
      {status !== 'unverified' ? <DecisionLine status={status} reviewedAt={reviewedAt} /> : null}
    </View>
  );
}

/** The owner's decision, and when they made it.
 *
 *  ⚠️ MAPPED, not a two-way branch: the old header read `credited ?
 *  'Credited' : 'Marked helpful'`, so a sighting the owner had said was NOT
 *  their car was labelled "Marked helpful" — the exact opposite of their
 *  answer (SightingTimeline fixed the same bug). */
function DecisionLine({
  status,
  reviewedAt,
}: {
  status: OwnerSighting['status'];
  reviewedAt: string | null;
}) {
  const styles = useThemedStyles(makeStyles);
  const label =
    status === 'credited' ? 'Credited' : status === 'not_mine' ? 'Not your car' : 'Your car';
  return (
    <View style={styles.decisionRow} testID="sighting-decision">
      <View style={[styles.pill, status === 'not_mine' && styles.pillMuted]}>
        <Text style={[styles.pillText, status === 'not_mine' && styles.pillTextMuted]}>
          {label}
        </Text>
      </View>
      {reviewedAt ? <DecidedAgo reviewedAt={reviewedAt} /> : null}
    </View>
  );
}

function DecidedAgo({ reviewedAt }: { reviewedAt: string }) {
  const styles = useThemedStyles(makeStyles);
  const ago = useTimeAgo(reviewedAt);
  return <Text style={styles.meta}>You decided {ago}</Text>;
}

/** The page's own shape while it loads: the hero, then the sheet's first lines. */
function SightingDetailSkeleton({ heroHeight }: { heroHeight: number }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View accessibilityLabel="Loading sighting" testID="sighting-detail-skeleton">
      <View style={[styles.skeletonHero, { height: heroHeight }]} />
      <View style={[styles.sheet, styles.skeletonSheet]}>
        <View style={styles.skeletonLineWide} />
        <View style={styles.skeletonLine} />
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
    stateBlock: {
      paddingHorizontal: spacing.xl,
    },
    // The first block carries its own clearance from the sheet's curved top.
    titleBlock: {
      paddingTop: spacing.xl,
      paddingBottom: spacing.xxl,
      gap: spacing.xs,
    },
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
    // Primary ink, not success green — sage stays reserved for payout moments.
    pill: {
      borderRadius: radii.full,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.primary,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    // The quietest outcome of the three, and not a mark against the spotter.
    pillMuted: {
      borderColor: c.border,
    },
    pillText: {
      ...typography.label,
      color: c.primary,
    },
    pillTextMuted: {
      color: c.textSecondary,
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
      ...typography.title,
      color: c.textPrimary,
      includeFontPadding: false,
    },
    notice: {
      paddingBottom: spacing.lg,
    },
    skeletonHero: {
      backgroundColor: c.surfaceSubtle,
    },
    skeletonSheet: {
      paddingTop: spacing.xl,
      gap: spacing.md,
    },
    skeletonLineWide: {
      height: sizes.skeletonLine,
      width: '60%',
      borderRadius: radii.sm,
      backgroundColor: c.surfaceSubtle,
    },
    skeletonLine: {
      height: sizes.skeletonLine,
      width: '40%',
      borderRadius: radii.sm,
      backgroundColor: c.surfaceSubtle,
    },
  });
