/**
 * WHAT:  SightingDetailScreen — one sighting of the OWNER's car, examined in
 *        full, laid out like the post page:
 *        - the spotter's photos full-bleed and swipeable, the back button
 *          floating over them;
 *        - a content sheet, EVIDENCE FIRST (owner's pick, 2026-10-19):
 *          where and when it was seen, and the owner's answer so far (with
 *          "Change" for "Not my car", and "Got your car back?" under a
 *          confirmation); "What they saw" (the owner's marks, the ones the
 *          spotter could see ticked — the wizard's list read back);
 *          "Details" (their answers as a label | answers table, then their
 *          note); "Where" (the
 *          street address, the map, the safety notice, then [Google Maps]
 *          [Waze] — each behind
 *          the same don't-approach confirm, each a pin); "Spotted by" (their
 *          record, and Message — always there);
 *        - pinned to the bottom, ONLY while undecided: "Is this your car?".
 * WHY:   Redesigned 2026-10-19 (owner: evidence first, a calm page once
 *        answered). The 2026-10-08 page said the answer twice (a pill under
 *        the title AND the bar's "You said this isn't your car."), moved
 *        Message from the spotter card to the bar once answered, and after
 *        "Yes" offered nothing — though "Yes" pays no one; the reward moves
 *        only through the recovery. `sightingVerdictView` is now the page's
 *        one reading of the status.
 *
 *        Redesigned before that, 2026-10-08 — the owner found the old page "hard to read
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
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { useNow, useTimeAgo } from '@/shared/hooks';
import { formatDateTimeLabel, googleMapsPinUrl, spokenAgo, wazePinUrl } from '@/shared/lib';
import { createLogger } from '@/shared/lib/logger';
import {
  opacity,
  radii,
  sizes,
  spacing,
  typography,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import {
  AppHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  HEADER_BAR_HEIGHT,
  SAFETY_NOTICE_BODY,
  StatusPill,
  useToast,
  type ConfirmDialogRef,
} from '@/shared/ui';

import { openSpotterThread } from '../api/openSpotterThread';
import { markSightingHelpful, markSightingNotMine, SightingVerdictError } from '../api/sightingApi';
import { SightingDecisionBar } from '../components/SightingDecisionBar';
import { SightingDetailHero } from '../components/SightingDetailHero';
import {
  hasSightingDetails,
  SightingDetails,
  SightingMarks,
} from '../components/SightingSeenSection';
import { SightingSpotterCard } from '../components/SightingSpotterCard';
import { SightingWhereSection, type MapsApp } from '../components/SightingWhereSection';
import { usePostSightings } from '../hooks/usePostSightings';
import { useSightingAddress } from '../hooks/useSightingAddress';
import { useSightingPost, type RecoveryDoor } from '../hooks/useSightingPost';
import { markChecklist } from '../lib/markChecklist';
import {
  isGoneSighting,
  sightingSeenAt,
  sightingVerdictView,
  type SightingVerdictTone,
  type SightingVerdictView,
} from '../lib/sightingVerdict';
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
  // The page's one reading of the status — the answer under the title, the
  // pinned bar and the "Got your car back?" door all read it here.
  const verdict = sightingVerdictView(effectiveStatus);
  // What the page needs from the LISTING: all the owner's marks (so the
  // unseen ones list too) and whether it can still be recovered.
  const listing = useSightingPost(postId, idsValid);
  // "Got your car back?" under a confirmation only.
  const recoveryDoor = verdict.offerRecovery ? (listing?.recovery ?? null) : null;
  // The marks the spotter was asked about, theirs ticked; until both the
  // listing and the "asked about" record are known, the ticked ones alone.
  const marks = sighting
    ? markChecklist(listing?.marks ?? null, sighting.confirmedFeatures, sighting.offeredFeatureIds)
    : { checks: [], complete: false };

  // Which answer is on its way — so the spinner sits on THAT button.
  const [pending, setPending] = useState<'yes' | 'not_mine' | null>(null);
  // ⚠️ THE LOCK IS A REF, NOT `pending` (review, 2026-10-19). Two taps landing
  // before the next render both read the same `pending === null` closure and
  // would both send — and "Yes" cannot be undone. A ref is seen at once.
  const inFlight = useRef(false);
  const [opening, setOpening] = useState(false);

  const mapsConfirmRef = useRef<ConfirmDialogRef>(null);
  const yesConfirmRef = useRef<ConfirmDialogRef>(null);

  // A notification can open this page with nothing behind it.
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else if (isGuid(postId)) router.replace(`/post/${postId}`);
    else router.replace('/');
  };

  // "Got your car back?" — the post page's own route and params
  // (PostDetailScreen.onRecovered). No dialog first: the recovery screen IS
  // the confirmation, and it asks which sighting led to it. Nothing moves
  // money here.
  const openRecovery = (door: RecoveryDoor) => {
    log.info('sighting_recovery_opened', { postId, sightingId });
    router.push({ pathname: '/recover-post', params: { postId, bounty: door.bounty } });
  };

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
    if (!sighting || inFlight.current) return;
    inFlight.current = true;
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
      inFlight.current = false;
      setPending(null);
    }
  };

  const markNotMine = async () => {
    if (!sighting || inFlight.current) return;
    inFlight.current = true;
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
      inFlight.current = false;
      setPending(null);
    }
  };

  useEffect(() => {
    if (idsValid) log.info('sighting_detail_viewed', { postId, sightingId });
  }, [idsValid, postId, sightingId]);

  const locatedPhoto =
    sighting?.photos.find((photo) => photo.lat !== null && photo.lng !== null) ?? null;
  const point = locatedPhoto
    ? { lat: locatedPhoto.lat as number, lng: locatedPhoto.lng as number }
    : null;
  const areaShown = sighting && !sighting.locationUnavailable ? sighting.areaLabel : null;
  // The street address under "Where" (owner, 2026-10-20) — the stored area
  // until the device lookup answers, or if it can't.
  const address = useSightingAddress(point, areaShown);

  // Which app the owner picked — read by the confirm's label and its action.
  const [mapsApp, setMapsApp] = useState<MapsApp>('google');
  const mapsAppName = mapsApp === 'google' ? 'Google Maps' : 'Waze';

  // Open the captured point as a PIN in the app the owner picked (§1: never
  // directions — mapsLink.ts). Google Maps: an https link the app claims, or
  // the browser shows. Waze: its app scheme, which has no web fallback (the
  // web one lands on a directions page). openURL can reject, so this is a
  // toast, never an unhandled rejection.
  const openInMaps = async () => {
    if (!point) return;
    const url =
      mapsApp === 'google'
        ? googleMapsPinUrl(point.lat, point.lng)
        : wazePinUrl(point.lat, point.lng);
    try {
      await Linking.openURL(url);
      log.info('sighting_map_opened', { postId, sightingId, app: mapsApp });
    } catch {
      // Google Maps' https link always has the browser to fall back on; Waze's
      // app link has none (mapsLink.ts), so this is mostly "not installed".
      toast.show(`We couldn’t open ${mapsAppName}. Is it installed?`, 'error');
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
              <SightingTitle
                sighting={sighting}
                verdict={verdict}
                reviewedAt={reviewedAt}
                // "Change" is "Actually, it is": the same confirm as the bar's
                // "Yes" — the answer it changes TO cannot be undone.
                onChange={() => yesConfirmRef.current?.open()}
                changing={pending !== null}
                recoveryDoor={recoveryDoor}
                onRecovery={openRecovery}
              />

              {/* EVIDENCE FIRST (owner, 2026-10-19): what tells the owner
                  whether it IS their car — their own marks above all — before
                  where it was, which matters once it is. */}
              {marks.checks.length > 0 ? (
                <Section title="What they saw">
                  <SightingMarks marks={marks} />
                </Section>
              ) : null}

              {/* Their answers as a table, then their note — under a title of
                  its own (owner, 2026-10-20). */}
              {hasSightingDetails(sighting) ? (
                <Section title="Details">
                  <SightingDetails sighting={sighting} />
                </Section>
              ) : null}

              {/* The safety notice lives here, beside the exact point and
                  above the maps buttons (SightingWhereSection). */}
              <Section title="Where">
                <SightingWhereSection
                  point={point}
                  address={address}
                  areaLabel={areaShown}
                  // Either app asks first — the same confirm, the same notice.
                  onOpenMaps={(app) => {
                    setMapsApp(app);
                    mapsConfirmRef.current?.open();
                  }}
                />
              </Section>

              {/* Message lives here in EVERY state — never moved to the bar. */}
              <Section title="Spotted by">
                <SightingSpotterCard
                  spotter={sighting.spotter}
                  onMessage={() => void messageSpotter()}
                  messaging={opening}
                />
              </Section>
            </View>
          </>
        )}
      </Animated.ScrollView>

      {/* Only while the sighting is the owner's to answer — once answered,
          the page is calm (owner, 2026-10-19). A flex child, so the scroll
          view shrinks to fit it and grows back when it goes. */}
      {sighting && !loading && !failed && verdict.decide ? (
        <SightingDecisionBar
          onYes={() => yesConfirmRef.current?.open()}
          onNotMine={() => void markNotMine()}
          pending={pending}
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
          drifts, and this one already had. The title is this moment's —
          "Warning" (owner, 2026-10-20: short, and unmistakably a warning);
          the warning itself is the app's one canonical sentence, 999 too. */}
      <ConfirmDialog
        ref={mapsConfirmRef}
        title="Warning"
        body={SAFETY_NOTICE_BODY}
        confirmLabel={`Open in ${mapsAppName}`}
        onConfirm={() => void openInMaps()}
      />
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

/** "Seen near Deansgate", when, and the owner's answer so far — with what
 *  they can do about it next. */
function SightingTitle({
  sighting,
  verdict,
  reviewedAt,
  onChange,
  changing,
  recoveryDoor,
  onRecovery,
}: {
  sighting: OwnerSighting;
  verdict: SightingVerdictView;
  reviewedAt: string | null;
  onChange: () => void;
  changing: boolean;
  recoveryDoor: RecoveryDoor | null;
  onRecovery: (door: RecoveryDoor) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  // When it was SEEN — the same rule as the timeline card (ADR-0003).
  const seenAt = sightingSeenAt(sighting);
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

  // With no area, the title says WHEN instead — "Sighting" only repeated the
  // header above it — and the line under it keeps just the date.
  const area = sighting.locationUnavailable ? null : sighting.areaLabel;
  return (
    <View style={styles.titleBlock}>
      {area ? (
        <>
          <Text style={styles.title} accessibilityRole="header">
            Seen near {area}
          </Text>
          <Text
            style={styles.meta}
            accessibilityLabel={`Seen ${spokenAgo(ago)}${date ? `, ${date}` : ''}`}
          >
            {date ? `${ago} · ${date}` : ago}
          </Text>
        </>
      ) : (
        <>
          {/* The date is its own line below — spoken there, not twice. */}
          <Text
            style={styles.title}
            accessibilityRole="header"
            accessibilityLabel={`Seen ${spokenAgo(ago)}`}
          >
            Seen {ago}
          </Text>
          {date ? <Text style={styles.meta}>{date}</Text> : null}
        </>
      )}
      <DecisionLine
        verdict={verdict}
        reviewedAt={reviewedAt}
        onChange={onChange}
        changing={changing}
      />
      {recoveryDoor ? (
        <RecoveryRow door={recoveryDoor} onPress={() => onRecovery(recoveryDoor)} />
      ) : null}
    </View>
  );
}

/** A text action with a real 44pt box — the page's one link style (Open in
 *  Maps uses the same). */
function TextLink({
  label,
  accessibilityLabel,
  accessibilityHint,
  busy = false,
  onPress,
  testID,
}: {
  label: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Its action is on the way: inert and dimmed, and says so. */
  busy?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy, disabled: busy }}
      style={({ pressed }) => [styles.link, (pressed || busy) && styles.pressed]}
      testID={testID}
    >
      <Text style={styles.linkLabel}>{label}</Text>
    </Pressable>
  );
}

/** "Got your car back?" under a confirmation — the way to the reward, which
 *  "Yes, it's my car" does not move. Words from the post page's own section
 *  (PostDetailBody): send the reward, or on a no-reward listing, credit. */
function RecoveryRow({ door, onPress }: { door: RecoveryDoor; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const action = door.noReward ? 'Credit the spotter' : 'Send the reward';
  return (
    <View style={styles.recoveryRow} testID="sighting-recovery">
      {/* Silent to a screen reader: the link's own label carries the question,
          so it is one stop, not the question read twice. */}
      <Text style={styles.recoveryTitle} accessibilityElementsHidden importantForAccessibility="no">
        Got your car back?
      </Text>
      <TextLink
        label={action}
        accessibilityLabel={`Got your car back? ${action}`}
        onPress={onPress}
        testID="sighting-recovery-link"
      />
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
  verdict,
  reviewedAt,
  onChange,
  changing,
}: {
  verdict: SightingVerdictView;
  reviewedAt: string | null;
  onChange: () => void;
  /** The changed answer is on its way. The bar that used to show a spinner
   *  for it is gone once answered, so "Change" itself says so. */
  changing: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  if (verdict.label === null) return null;
  const { label, tone } = verdict;
  return (
    // The answer is one accessible element; "Change" stays a separate,
    // focusable button beside it (an accessible parent would swallow it).
    <View style={styles.answerLine}>
      {reviewedAt ? (
        <DecidedLine label={label} tone={tone} reviewedAt={reviewedAt} />
      ) : (
        <DecisionRow label={label} tone={tone} accessibilityLabel={`Your answer: ${label}`} />
      )}
      {verdict.canChange ? (
        <TextLink
          label={changing ? 'Saving…' : 'Change'}
          accessibilityLabel={changing ? 'Saving your answer' : 'Change your answer'}
          accessibilityHint="Asks you to confirm it’s your car"
          busy={changing}
          onPress={onChange}
          testID="sighting-change-answer"
        />
      ) : null}
    </View>
  );
}

/** The decision with its time — its own component, so the clock only ticks
 *  once there is a decision to time. */
function DecidedLine({
  label,
  tone,
  reviewedAt,
}: {
  label: string;
  tone: SightingVerdictTone;
  reviewedAt: string;
}) {
  const ago = useTimeAgo(reviewedAt);
  return (
    <DecisionRow
      label={label}
      tone={tone}
      accessibilityLabel={`Your answer: ${label}, decided ${spokenAgo(ago)}`}
      ago={ago}
    />
  );
}

function DecisionRow({
  label,
  tone,
  accessibilityLabel,
  ago,
}: {
  label: string;
  tone: SightingVerdictTone;
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
      <StatusPill label={label} tone={tone} />
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
    // The answer, then "Change" on the same line when there is one; wraps
    // under at large text rather than squeezing the pill.
    answerLine: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      columnGap: spacing.lg,
      marginTop: spacing.sm,
    },
    // Shrinks inside the wrapping line, so "You decided 3 days ago" wraps at
    // large text instead of running off the edge.
    decisionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      flexShrink: 1,
      gap: spacing.sm,
    },
    // "Got your car back?" — a quiet question with its link on ONE line (the
    // answer line's form), under the answer it follows from: stacked, the
    // link's 44pt box left an uneven gap above the divider. Not a button: the
    // page's primary moment was the answer; this is the next step, offered.
    recoveryRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      columnGap: spacing.sm,
    },
    recoveryTitle: {
      ...typography.label,
      color: c.textPrimary,
    },
    // A text link with a real 44pt box (SightingWhereSection's form).
    link: {
      alignSelf: 'flex-start',
      justifyContent: 'center',
      minHeight: sizes.touchTarget,
      minWidth: sizes.touchTarget,
    },
    pressed: {
      opacity: opacity.pressed,
    },
    linkLabel: {
      ...typography.label,
      color: c.textPrimary,
      textDecorationLine: 'underline',
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
