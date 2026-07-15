/**
 * WHAT:  ReportSightingScreen — the report-sighting route's orchestrator:
 *        check the rate-limit quota FIRST (a spent quota shows a kind state,
 *        never the wizard), then run the speed wizard, then swap to the
 *        success screen ("Report sent — thank you") whose Done returns to
 *        where the spotter came from.
 * WHY:   The 3-per-post-per-day limit is friendlier as a gate than as a
 *        submit-time rejection — nobody should photograph a car and THEN
 *        learn their reports are spent (the RPC still enforces it for real).
 *        Submission failure keeps the wizard fully intact for retry (the
 *        posting flow's standard); success owns the payoff moment — warmth
 *        allowed, "Message the owner" opens the sighting-gated chat thread
 *        (chat shipped 2026-07-15), and NO Stripe onboarding (DOMAIN: KYC
 *        at credit, not report).
 * LINKS: src/app/report-sighting.tsx (route);
 *        src/features/sightings/reportSightingFlow.tsx;
 *        src/features/sightings/api/sightingApi.ts; docs/DOMAIN.md.
 */

import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatPounds } from '@/shared/lib';
import { createLogger } from '@/shared/lib/logger';
import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import { Button, EmptyState, FullscreenLoader, useToast } from '@/shared/ui';
import { WizardScreen } from '@/shared/wizard';

import { fetchSightingQuota, submitSighting } from '../api/sightingApi';
import {
  REPORT_SIGHTING_INITIAL_ANSWERS,
  reportSightingFlow,
} from '../reportSightingFlow';
import type { ReportSightingAnswers } from '../types';

const log = createLogger('sightings');

export interface ReportSightingScreenProps {
  postId: string;
  /** Where the spotter entered from — the funnel's `source` dimension. */
  source: 'detail' | 'map';
  /** Bounty in pence, passed by the entry point for the success copy. */
  bountyPence?: number;
}

type Phase =
  | { kind: 'checking' }
  | { kind: 'rate_limited' }
  | { kind: 'wizard' }
  | { kind: 'sent' };

export function ReportSightingScreen({ postId, source, bountyPence }: ReportSightingScreenProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });

  // The quota gate: spent → the kind state instead of the wizard. A failed
  // CHECK never blocks reporting (the RPC is the real enforcement).
  useEffect(() => {
    let cancelled = false;
    log.info('flow_entered', { postId, source });
    fetchSightingQuota(postId)
      .then((quota) => {
        if (cancelled) return;
        if (quota.used >= quota.maxPerDay) {
          log.info('rate_limited', { postId });
          setPhase({ kind: 'rate_limited' });
        } else {
          setPhase({ kind: 'wizard' });
        }
      })
      .catch(() => {
        if (!cancelled) setPhase({ kind: 'wizard' });
      });
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
    setPhase({ kind: 'sent' });
  };

  if (phase.kind === 'checking') {
    return <FullscreenLoader visible />;
  }

  if (phase.kind === 'rate_limited') {
    return (
      <View style={styles.stateWrap}>
        <EmptyState
          illustration={<Feather name="check-circle" size={sizes.icon} color={colors.primary} />}
          title="You’ve sent 3 reports for this car today"
          body="The owner has them. If you spot it again tomorrow, you can report again."
          actionLabel="Done"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  if (phase.kind === 'sent') {
    return (
      <SightingSent
        postId={postId}
        bountyPence={bountyPence}
        onDone={() => router.back()}
      />
    );
  }

  return (
    <WizardScreen
      flow={reportSightingFlow}
      initialAnswers={REPORT_SIGHTING_INITIAL_ANSWERS}
      onExit={() => router.back()}
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
  onDone,
}: {
  postId: string;
  bountyPence?: number;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const [opening, setOpening] = useState(false);

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
        <View style={styles.sentBadge}>
          <Feather name="check" size={sizes.icon} color={colors.textOnPrimary} />
        </View>
        <Text accessibilityRole="header" style={styles.sentTitle}>
          Report sent — thank you
        </Text>
        <Text style={styles.sentLine}>
          The owner can now see your report and where the car was spotted.
        </Text>
        <Text style={styles.sentLine}>
          {bountyPence
            ? `If your sighting leads to the recovery, you’ll receive the ${formatPounds(bountyPence)} bounty.`
            : 'If your sighting leads to the recovery, you’ll receive the bounty.'}
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

const styles = StyleSheet.create({
  stateWrap: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  sent: {
    flex: 1,
    backgroundColor: colors.background,
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
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  sentTitle: {
    ...typography.title,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  sentLine: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  sentActions: {
    gap: spacing.sm,
  },
});
