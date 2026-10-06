/**
 * WHAT:  ReportSightingScreen — the report-sighting route's orchestrator:
 *        check the rate-limit quota FIRST (a spent quota shows a kind state,
 *        never the wizard), then the safety sheet unless it was just confirmed
 *        for this post (lib/safetyAck.ts; a deep link gets it here), then run
 *        the speed wizard, then swap to the
 *        success screen ("Report sent — thank you") whose Done returns to
 *        where the spotter came from.
 * WHY:   The 3-per-post-per-day limit is friendlier as a gate than as a
 *        submit-time rejection — nobody should photograph a car and THEN
 *        learn their reports are spent (the RPC still enforces it for real).
 *        Submission failure keeps the wizard fully intact for retry (the
 *        posting flow's standard); success owns the payoff moment — warmth
 *        allowed, "Message the owner" opens the sighting-gated chat thread
 *        (chat shipped 2026-07-15), and NO Stripe onboarding (DOMAIN: KYC
 *        at credit, not report). Its reward line reads the LIVE reward from
 *        the post-detail seed (a reward can change or end after the spotter
 *        tapped), falling back to the route's `bounty` only if that read fails.
 * LINKS: src/app/report-sighting.tsx (route);
 *        src/features/sightings/reportSightingFlow.tsx;
 *        src/features/sightings/api/sightingApi.ts; docs/DOMAIN.md.
 */

import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatPounds } from '@/shared/lib';
import { successHaptic } from '@/shared/lib/haptics';
import { createLogger } from '@/shared/lib/logger';
import {
  motion,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { Button, EmptyState, FullscreenLoader, SafetyNotice, useToast } from '@/shared/ui';
import { WizardScreen } from '@/shared/wizard';

import { fetchSightingQuota, submitSighting } from '../api/sightingApi';
import { ReportSafetySheet, type ReportSafetySheetRef } from '../components/ReportSafetySheet';
import { EMPTY_REPORT_SEED, reportSeedFromDetail, type ReportSeed } from '../lib/reportSeed';
import { hasFreshSafetyAck } from '../lib/safetyAck';
import {
  REPORT_SIGHTING_INITIAL_ANSWERS,
  reportSightingFlow,
} from '../reportSightingFlow';
import type { ReportSightingAnswers } from '../types';

/** The wizard's read-only seed from the post detail: the registered marks
 *  (the context step's "Could you see…?") and the car (the check-and-send
 *  step's "You're reporting" card). Best-effort: any failure (hidden post,
 *  network) yields the empty seed, and the wizard simply offers no marks and
 *  no car card. Deferred import keeps sightings' module graph off the
 *  vehicles feature. */
async function fetchReportSeed(postId: string): Promise<ReportSeed> {
  try {
    const { fetchPostDetail } = await import('@/features/vehicles');
    return reportSeedFromDetail(await fetchPostDetail(postId));
  } catch {
    return EMPTY_REPORT_SEED;
  }
}

const log = createLogger('sightings');

export interface ReportSightingScreenProps {
  postId: string;
  /** Where the spotter entered from — the funnel's `source` dimension. */
  source: 'detail' | 'map';
  /**
   * Bounty in pence, passed by the entry point for the success copy.
   * NULL means this listing offers NO cash reward (ADR-0014) — distinct from
   * `undefined`, which means the caller did not say. The success copy must not
   * collapse the two: one is "you'll receive the bounty", the other is a
   * promise of money that will never arrive.
   */
  bountyPence?: number | null;
}

type Phase =
  | { kind: 'checking' }
  | { kind: 'rate_limited' }
  | { kind: 'wizard'; seed: ReportSeed }
  // The live reward rides from the seed into the success screen (absent when
  // the seed read failed — the route's param is the fallback).
  | { kind: 'sent'; reward?: ReportSeed['reward'] };

export function ReportSightingScreen({ postId, source, bountyPence }: ReportSightingScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });

  // No way into the camera without the safety sheet (SECURITY_AND_TRUST §1).
  // The entry points show it over the listing, and its confirm leaves an
  // in-memory proof for this post (never a URL param: those can be forged).
  // Anything that lands here without one (a deep link) gets the sheet now,
  // after the quota check (a spent quota needs no safety moment) and before
  // the wizard mounts.
  // SAFETY: the wizard (and its camera) mounts only once this is true.
  const [safetyOk, setSafetyOk] = useState(() => hasFreshSafetyAck(postId));
  const safetyRef = useRef<ReportSafetySheetRef>(null);
  const needsSafety = phase.kind === 'wizard' && !safetyOk;
  const openSafety = () => safetyRef.current?.open({ postId, onContinue: () => setSafetyOk(true) });
  useEffect(() => {
    if (needsSafety) safetyRef.current?.open({ postId, onContinue: () => setSafetyOk(true) });
  }, [needsSafety, postId]);

  // Every way out: a cold-start deep link has nowhere to go back to.
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

  // The quota gate: spent → the kind state instead of the wizard. A failed
  // CHECK never blocks reporting (the RPC is the real enforcement). The
  // post's seed (marks + car) rides the same await — one loading moment, and
  // a seed failure costs nothing but the checkmarks and the car card.
  useEffect(() => {
    let cancelled = false;
    log.info('flow_entered', { postId, source });
    // allSettled: a quota-check blip must not cost the seed (nor vice
    // versa) — each degrades independently, and neither ever blocks.
    Promise.allSettled([fetchSightingQuota(postId), fetchReportSeed(postId)]).then(
      ([quota, seeded]) => {
        if (cancelled) return;
        const seed = seeded.status === 'fulfilled' ? seeded.value : EMPTY_REPORT_SEED;
        if (quota.status === 'fulfilled' && quota.value.used >= quota.value.maxPerDay) {
          log.info('rate_limited', { postId });
          setPhase({ kind: 'rate_limited' });
        } else {
          setPhase({ kind: 'wizard', seed });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [postId, source]);

  const handleComplete = async (answers: Partial<ReportSightingAnswers>) => {
    // Failures throw SightingSubmissionError with user-facing copy; NOT
    // caught here, so the wizard stays intact and shows it for retry.
    try {
      await submitSighting(postId, answers);
    } catch (err) {
      log.warn('submit_failed', {
        code: err instanceof Error && 'code' in err ? (err as { code: string }).code : 'UNKNOWN',
      });
      throw err;
    }
    setPhase({ kind: 'sent', reward: phase.kind === 'wizard' ? phase.seed.reward : undefined });
  };

  if (phase.kind === 'checking') {
    return <FullscreenLoader visible />;
  }

  if (phase.kind === 'rate_limited') {
    return (
      <View style={styles.stateWrap}>
        <EmptyState
          illustration={<Feather name="check-circle" size={sizes.icon} color={palette.primary} />}
          title="You’ve sent 3 reports for this car today"
          body="The owner has them. If you spot it again tomorrow, you can report again."
          actionLabel="Done"
          onAction={leave}
        />
      </View>
    );
  }

  if (phase.kind === 'sent') {
    return (
      <SightingSent
        postId={postId}
        // The live reward wins over the route's snapshot (see ReportSeed.reward).
        // Without it, the snapshot's AMOUNT is never named — it may be a reward
        // that has since ended or changed — so a number falls back to the
        // unnamed line; only "no cash reward" (an under-promise) survives.
        bountyPence={phase.reward ? phase.reward.bountyPence : bountyPence === null ? null : undefined}
        rewardEnded={phase.reward?.rewardEnded ?? false}
        onDone={leave}
      />
    );
  }

  if (needsSafety) {
    // Closing the sheet without confirming leaves the report. The page behind
    // it isn't blank: if the sheet ever failed to present, this still gives a
    // way on (which re-opens the SHEET, never skips it) and a way out.
    return (
      <View style={[styles.stateWrap, styles.safetyWrap]}>
        <SafetyNotice />
        <Button label="Show the safety check" onPress={openSafety} />
        <Button label="Not now" variant="ghost" onPress={leave} />
        <ReportSafetySheet ref={safetyRef} source="direct" onCancel={leave} />
      </View>
    );
  }

  return (
    <WizardScreen
      flow={reportSightingFlow}
      initialAnswers={{
        ...REPORT_SIGHTING_INITIAL_ANSWERS,
        // A copy: the seed may be the shared, frozen EMPTY_REPORT_SEED.
        confirmableFeatures: [...phase.seed.confirmableFeatures],
        reportedCar: phase.seed.reportedCar,
      }}
      onExit={leave}
      onComplete={handleComplete}
    />
  );
}

/** The payoff moment — warmth allowed here. Honest about what happens next:
 *  the owner can now see the report (push arrives with the notifications
 *  feature); the bounty line states the deal plainly. NO Stripe prompt —
 *  that belongs to the moment a sighting is CREDITED (DOMAIN). "Message the
 *  owner" opens the sighting-gated thread (DOMAIN Chat: the spotter's own
 *  sighting IS the gate; open_thread re-validates server-side). */
function SightingSent({
  postId,
  bountyPence,
  rewardEnded,
  onDone,
}: {
  postId: string;
  bountyPence?: number | null;
  /** The listing's reward ran its term and went back (ADR-0020). */
  rewardEnded: boolean;
  onDone: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const [opening, setOpening] = useState(false);

  // Success warmth (the one place a soft overshoot is allowed): the check badge
  // springs in on the payoff screen. Reduced motion → it's simply already here.
  const reduceMotion = useReducedMotion();
  const badge = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    badge.value = withSpring(1, motion.springBouncy);
  }, [badge, reduceMotion]);

  // The confirming buzz, matching the two other completed-submission moments
  // (AddVehicleScreen, PostACarScreen). It was missing from the ONE flow a user
  // finishes standing in the street, probably one-handed, quite possibly not
  // looking at the screen — the report is sent and nothing said so in the hand.
  // Separate from the badge effect on purpose: it must still fire under reduced
  // motion, which suppresses the spring but says nothing about haptics.
  useEffect(() => {
    successHaptic();
  }, []);
  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badge.value }] }));

  const messageOwner = async () => {
    if (opening) return;
    setOpening(true);
    try {
      // Deferred import keeps sightings' module graph off the chat feature
      // for tests that stub navigation only.
      const { openThread } = await import('@/features/chat');
      const { threadId } = await openThread(postId);
      router.push(`/chat/${threadId}`);
    } catch (err) {
      // ChatActionError (extends Error) carries user-facing copy; surface it.
      toast.show(
        err instanceof Error && err.message ? err.message : 'We couldn’t open the conversation.',
        'error',
      );
    } finally {
      setOpening(false);
    }
  };

  return (
    <View style={[styles.sent, { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.xl }]}>
      <View style={styles.sentBody}>
        <Animated.View style={[styles.sentBadge, badgeStyle]}>
          <Feather name="check" size={sizes.icon} color={palette.textOnPrimary} />
        </Animated.View>
        <Text accessibilityRole="header" style={styles.sentTitle}>
          Report sent — thank you
        </Text>
        <Text style={styles.sentLine}>
          The owner can now see your report and where the car was spotted.
        </Text>
        <Text style={styles.sentLine}>
          {/* Three states, and conflating the last two would promise money that
              is never coming. null = this listing has no cash reward (ADR-0014);
              undefined = unknown (no live read), so name nothing. */}
          {bountyPence === null
            ? rewardEnded
              ? // ADR-0020: the reward ran its term and went back — not a fee
                // listing, and not one to promise money on.
                'The reward on this listing has ended, but if your report leads to the car being found the owner can credit you — and it’s added to your spotter record.'
              : 'There’s no cash reward on this listing, but if your report leads to the car being found the owner can credit you — and it’s added to your spotter record.'
            : bountyPence
              ? `If your sighting leads to the recovery, you’ll receive the ${formatPounds(bountyPence)} reward.`
              : // Unknown right now (the live read failed): nothing is named
                // that might no longer be true.
                'If your sighting leads to the car being found, the owner can credit you, and any reward on the listing goes to you.'}
        </Text>
        <Text style={styles.sentLine}>
          You and the owner can now message each other about this report — if they get in
          touch, it lands in your inbox.
        </Text>
      </View>
      <View style={styles.sentActions}>
        <Button
          label="Message the owner"
          variant="secondary"
          loading={opening}
          onPress={() => void messageOwner()}
        />
        <Button label="Done" onPress={onDone} />
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  stateWrap: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: c.background,
  },
  // The deep-link fallback behind the safety sheet: the screen's gutter, and
  // the confirm-sheet button rhythm.
  safetyWrap: {
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  sent: {
    flex: 1,
    backgroundColor: c.background,
    paddingHorizontal: spacing.xl,
    justifyContent: 'space-between',
  },
  sentBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  sentBadge: {
    width: sizes.avatarLg,
    height: sizes.avatarLg,
    borderRadius: radii.full,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  sentTitle: {
    ...typography.title,
    color: c.textPrimary,
    textAlign: 'center',
  },
  sentLine: {
    ...typography.body,
    color: c.textSecondary,
    textAlign: 'center',
  },
  sentActions: {
    gap: spacing.sm,
  },
});
