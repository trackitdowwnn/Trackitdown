/**
 * WHAT:  PaymentConfirmation — what an owner sees the moment their card is
 *        taken: their reward (or listing fee) done, and their listing going
 *        live — watched until it really is live.
 * WHY:   PR3 of the payments UX plan (2026-10-13, owner: "not much if any
 *        progress indicators"). It replaces a toast and an instant jump to the
 *        listing — which, landing before the webhook had made it live, could
 *        show a car that wasn't live yet with nothing to say why. Someone whose
 *        car has just been stolen has just paid; this says what happened to
 *        their money and when spotters can see the car.
 *
 *        TWO STEPS, NOT THREE (UI review). The charge is captured at once, so
 *        the reward is held the moment the sheet says paid — a separate "held"
 *        step only flipped with "live" and was one stage drawn as two. Labels
 *        are nouns ("Your £500 reward", "Your listing"), as ProgressSteps asks.
 *
 *        WATCHED, NOT ASSUMED. The sheet's "paid" only means it is safe to move
 *        on; the listing goes live when the server's webhook says so (ADR-0007,
 *        live-on-payment). So this reads the post's status — at once (the
 *        webhook has often landed already), then every 1.5s, eight looks in
 *        all, as ChangeRewardScreen confirms a new reward — and says "live"
 *        only once it is. Slower than that, it says so plainly, and that it
 *        goes live by itself, rather than claiming success it can't see.
 *
 *        NEVER A TRAP: "View your listing" from the first frame, and the
 *        wizard's ✕ stays where it was (WizardHeader, the same control), as a
 *        task flow's exit should through every stage. Android Back does what
 *        the ✕ does: leaves the flow. The car is listed; nothing is abandoned.
 *
 *        No payment provider is named (owner, 2026-10-13).
 * LINKS: ../screens/PostACarScreen.tsx (shows it after payment);
 *        ../api/postApi.ts (fetchMyPostStatus); ./ReviewCostPanel.tsx (the
 *        refund wording this repeats); src/shared/ui/ProgressSteps.tsx;
 *        src/features/payments/screens/ChangeRewardScreen.tsx (the same wait).
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';

import { REWARD_TERM_DAYS } from '@/shared/lib/bountyBounds';
import { lightHaptic } from '@/shared/lib/haptics';
import { formatPounds, refundPence } from '@/shared/lib/money';
import {
  cardSurface,
  spacing,
  typography,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import {
  Button,
  ProgressSteps,
  Screen,
  StickyActionBar,
  type ProgressStep,
} from '@/shared/ui';
import { WizardHeader } from '@/shared/wizard';

import { fetchMyPostStatus } from '../api/postApi';

/** As ChangeRewardScreen: eight looks, 1.5s apart — about twelve seconds. */
export const CONFIRM_ATTEMPTS = 8;
export const CONFIRM_INTERVAL_MS = 1500;

type Phase = 'confirming' | 'live' | 'slow';

const SLOW_LEDE =
  'This is taking longer than usual. Your listing goes live by itself once it’s confirmed — you don’t need to wait here.';

/** Queued, so it never cuts across a screen reader landing on the header. */
const announce = (message: string) =>
  AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });

export interface PaymentConfirmationProps {
  postId: string;
  /** A reward held in escrow, or the flat listing fee. */
  mode: 'reward' | 'fee';
  /** What was paid, as the review screen quoted it. */
  amountPence: number;
  /** Go to the listing — the one way on, available from the first frame. */
  onViewListing: () => void;
  /** Leave the flow (the ✕, where the wizard's was). */
  onClose: () => void;
}

export function PaymentConfirmation({
  postId,
  mode,
  amountPence,
  onViewListing,
  onClose,
}: PaymentConfirmationProps) {
  const styles = useThemedStyles(makeStyles);
  const [phase, setPhase] = useState<Phase>('confirming');

  useEffect(() => {
    let cancelled = false;
    announce('Payment received. Your car is going live.');
    (async () => {
      for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt += 1) {
        // Look first: the webhook has often landed by the time the sheet
        // closes, and a fixed pause would hold back the moment it has.
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, CONFIRM_INTERVAL_MS));
          if (cancelled) return;
        }
        // A failed read is a blip, not a failed payment: keep looking.
        const status = await fetchMyPostStatus(postId);
        if (cancelled) return;
        if (status === 'active') {
          setPhase('live');
          lightHaptic();
          announce('Your car is live.');
          return;
        }
      }
      if (!cancelled) {
        setPhase('slow');
        announce(SLOW_LEDE);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  const live = phase === 'live';
  const steps: ProgressStep[] = [
    mode === 'reward'
      ? {
          id: 'reward',
          label: `Your ${formatPounds(amountPence)} reward`,
          state: 'done',
          // The same facts the review screen gave a minute ago: held, the
          // term, and the refund less the card fee (ReviewCostPanel).
          detail: `Held until a spotter finds your car. If none does in ${REWARD_TERM_DAYS} days, ${formatPounds(
            refundPence(amountPence),
          )} goes back to your card.`,
        }
      : {
          id: 'fee',
          label: `Your ${formatPounds(amountPence)} listing fee`,
          state: 'done',
        },
    {
      id: 'listing',
      label: 'Your listing',
      state: live ? 'done' : 'current',
      detail: live
        ? 'Spotters can see your car now.'
        : phase === 'slow'
          ? 'Taking longer than usual — it goes live by itself.'
          : 'Going live — usually a few seconds.',
    },
  ];

  return (
    <Screen
      scroll
      // Top only: the sticky bar pays the bottom inset itself, and both
      // paying it put a dead band under the button (UI review).
      edges={['top']}
      contentContainerStyle={styles.content}
      footer={
        <StickyActionBar>
          <Button
            label="View your listing"
            onPress={onViewListing}
            // Quiet only while we're confirming — a way out, not the moment.
            // Live, or slow ("you don't need to wait here"), it's the thing
            // to do next.
            variant={phase === 'confirming' ? 'secondary' : 'primary'}
          />
        </StickyActionBar>
      }
    >
      <WizardHeader onExit={onClose} testID="payment-confirmation-close" />
      <View testID={`payment-confirmation-${phase}`} style={styles.body}>
        <View style={styles.heading}>
          <Text style={styles.title} accessibilityRole="header">
            {live ? 'Your car is live' : 'Payment received'}
          </Text>
          {/* Only what the steps don't say (UI review: the state said three
              times over). */}
          <Text style={styles.lede}>
            {phase === 'slow'
              ? SLOW_LEDE
              : live
                ? 'We’ll let you know when someone reports a sighting.'
                : 'You don’t need to wait here — it goes live by itself.'}
          </Text>
        </View>
        <View style={styles.card}>
          <ProgressSteps steps={steps} testID="payment-steps" />
        </View>
      </View>
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    content: {
      padding: spacing.xl,
      paddingTop: spacing.sm,
    },
    body: {
      gap: spacing.xl,
      marginTop: spacing.lg,
    },
    // Title to lede at the wizard helper's distance; the pair reads as one
    // header above the card.
    heading: {
      gap: spacing.md,
    },
    // `display`: the big moment, and no quieter than the wizard questions it
    // replaces.
    title: {
      ...typography.display,
      color: c.textPrimary,
    },
    lede: {
      ...typography.body,
      color: c.textSecondary,
    },
    card: {
      ...cardSurface(c),
      padding: spacing.lg,
    },
  });
