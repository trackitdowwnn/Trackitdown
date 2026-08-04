/**
 * WHAT:  SightingDisputeScreen — where a spotter says "my sighting led to this
 *        recovery" after a post they sighted closed without crediting anyone,
 *        and where they later read the answer.
 * WHY:   The owner-denial control's spotter half. The `closed_uncredited` push
 *        lands here with 72 hours on the clock; filing holds the owner's
 *        refund until a person has read the sighting trail. The same screen
 *        renders every later state — we're looking at it, you were right
 *        (route to /payouts), and it didn't stand — because the push for each
 *        outcome routes back here and the screen reads its own truth from
 *        `my_dispute_context` on every visit.
 *
 *        HONESTY RULES the copy: filing is "tell us", not "appeal" (there was
 *        no verdict yet); rejection is final and unexplained ON PURPOSE — the
 *        evidence was weighed by a person, and a reasons string would become
 *        an argument surface. The bounty share shown is server-derived via
 *        payout_split; this screen never does money arithmetic.
 * LINKS: ../api/disputeApi.ts (the only calls);
 *        supabase/migrations/20260805100000_refund_holds_and_disputes.sql;
 *        src/app/sighting-dispute.tsx (the route);
 *        docs/DOMAIN.md (Disputes).
 */

import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatPounds } from '@/shared/lib/money';
import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import { Button, EmptyState, ErrorState, Screen, TextField, useToast } from '@/shared/ui';

import { DisputeError, fetchDisputeContext, openDispute, type DisputeContext } from '../api/disputeApi';

export interface SightingDisputeScreenProps {
  sightingId: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  /** The server said there is nothing here for this caller — window closed,
   *  money moved, or simply not their sighting. One calm answer for all. */
  | { status: 'unavailable' }
  | { status: 'ready'; context: DisputeContext };

export function SightingDisputeScreen({ sightingId }: SightingDisputeScreenProps) {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [statement, setStatement] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // `load` performs only the async read (no synchronous setState — the lint
  // rule about cascading renders in effects is right here); `reload` is the
  // event-handler variant that also shows the skeleton again.
  const load = useCallback(() => {
    fetchDisputeContext(sightingId)
      .then((context) => {
        setState(context ? { status: 'ready', context } : { status: 'unavailable' });
      })
      .catch(() => setState({ status: 'error' }));
  }, [sightingId]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    load();
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = useCallback(async () => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await openDispute(sightingId, statement);
      // Re-read rather than assume: the screen's states all come from the
      // server, and the filed state must reflect what was actually recorded.
      load();
    } catch (error) {
      toast.show(
        error instanceof DisputeError ? error.message : 'We couldn’t send this. Please try again.',
        'error',
      );
      if (error instanceof DisputeError && error.code === 'DISPUTE_NOT_AVAILABLE') {
        setState({ status: 'unavailable' });
      }
    } finally {
      setSubmitting(false);
    }
  }, [load, sightingId, statement, submitting, toast]);

  return (
    <Screen scroll contentContainerStyle={styles.scroll} keyboardAware>
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.back}
          testID="dispute-back"
        >
          <ChevronLeft size={sizes.icon} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Your sighting
        </Text>
      </View>
      {renderBody()}
    </Screen>
  );

  function renderBody() {
    if (state.status === 'loading') {
      return (
        <View style={styles.card} testID="dispute-skeleton">
          <View style={[styles.skeletonLine, styles.skeletonTitle]} />
          <View style={styles.skeletonLine} />
        </View>
      );
    }
    if (state.status === 'error') {
      return (
        <ErrorState
          title="Couldn’t load this"
          body="Check your connection and try again."
          onRetry={reload}
        />
      );
    }
    if (state.status === 'unavailable') {
      return (
        <EmptyState
          title="Nothing to do here"
          body="This one can’t be contested any more — the window may have closed, or it’s already settled."
        />
      );
    }

    const { context } = state;
    const car = [context.car.colour, context.car.make].filter(Boolean).join(' ') || 'car';
    const deadline = new Date(context.windowEndsAt).toLocaleString('en-GB', {
      weekday: 'long',
      hour: 'numeric',
      minute: '2-digit',
    });

    if (context.dispute?.status === 'open') {
      return (
        <View style={styles.card} testID="dispute-open">
          <Text style={styles.cardTitle} accessibilityRole="header">
            We’re looking into it
          </Text>
          <Text style={styles.cardBody}>
            Thanks — the bounty stays put while a person reviews the sighting trail. We’ll
            let you know either way.
          </Text>
        </View>
      );
    }
    if (context.dispute?.status === 'upheld') {
      return (
        <View style={styles.card} testID="dispute-upheld">
          <Text style={styles.cardTitle} accessibilityRole="header">
            You were right
          </Text>
          <Text style={styles.cardBody}>
            Your sighting led to the recovery
            {context.bountySharePence !== null
              ? ` — ${formatPounds(context.bountySharePence)} is yours`
              : ''}
            . Tell us where to send it.
          </Text>
          <Button label="Set up the payout" onPress={() => router.push('/payouts')} />
        </View>
      );
    }
    if (context.dispute?.status === 'rejected') {
      return (
        <View style={styles.card} testID="dispute-rejected">
          <Text style={styles.cardTitle} accessibilityRole="header">
            This one isn’t coming to you
          </Text>
          <Text style={styles.cardBody}>
            We looked into it carefully, and this bounty won’t be paid out for your
            sighting. Thank you for reporting it — it still counts.
          </Text>
        </View>
      );
    }

    // Not yet filed: the window is open and this is the ask.
    return (
      <View style={styles.card} testID="dispute-form">
        <Text style={styles.cardTitle} accessibilityRole="header">
          Did your sighting help find the {car}?
        </Text>
        <Text style={styles.cardBody}>
          The listing closed without crediting anyone. If your sighting led to the
          recovery
          {context.bountySharePence !== null
            ? `, ${formatPounds(context.bountySharePence)} is set aside for you`
            : ''}
          . Tell us by {deadline} and a person will review it — your photos, times and
          messages are all kept.
        </Text>
        <TextField
          label="What happened? (optional)"
          value={statement}
          onChangeText={setStatement}
          maxLength={500}
          multiline
          testID="dispute-statement"
        />
        <Button
          label="My sighting led to this recovery"
          onPress={() => void submit()}
          loading={submitting}
        />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.xl,
    gap: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  back: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -(sizes.touchTarget - sizes.icon) / 2,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  cardTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  cardBody: {
    ...typography.body,
    color: colors.textSecondary,
  },
  skeletonLine: {
    height: sizes.skeletonLine,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  skeletonTitle: {
    width: '55%',
  },
});
