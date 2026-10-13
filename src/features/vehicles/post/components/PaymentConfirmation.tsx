/**
 * WHAT:  PaymentConfirmation — what an owner sees the moment their card is
 *        taken: Payment taken → Reward held securely → Listing live (a £5
 *        listing: Payment taken → Listing live), watched until the listing
 *        really is live.
 * WHY:   PR3 of the payments UX plan (2026-10-13, owner: "not much if any
 *        progress indicators"). It replaces a toast and an instant jump to the
 *        listing — which, landing before the webhook had made it live, could
 *        show a car that wasn't live yet with nothing to say why. Someone whose
 *        car has just been stolen has just paid; this says what happened to
 *        their money and when spotters can see the car.
 *
 *        WATCHED, NOT ASSUMED. The payment sheet's "paid" only means it is
 *        safe to move on; the listing goes live when the server's webhook says
 *        so (ADR-0007, live-on-payment). So this reads the post's status —
 *        every 1.5s, eight times, as ChangeRewardScreen confirms a new reward —
 *        and says "live" only once it is. Slower than that, it says so plainly
 *        rather than claiming success it can't see.
 *
 *        NEVER A TRAP: "View your listing" is there from the first frame. The
 *        wait is ours, not theirs.
 *
 *        No payment provider is named (owner, 2026-10-13).
 * LINKS: ../screens/PostACarScreen.tsx (shows it after payment);
 *        ../api/postApi.ts (fetchMyPostStatus);
 *        src/shared/ui/ProgressSteps.tsx;
 *        src/features/payments/screens/ChangeRewardScreen.tsx (the same wait).
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';

import { formatPounds } from '@/shared/lib/money';
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

import { fetchMyPostStatus } from '../api/postApi';

/** As ChangeRewardScreen: eight looks, 1.5s apart — about twelve seconds. */
export const CONFIRM_ATTEMPTS = 8;
export const CONFIRM_INTERVAL_MS = 1500;

type Phase = 'confirming' | 'live' | 'slow';

export interface PaymentConfirmationProps {
  postId: string;
  /** A reward held in escrow, or the flat listing fee. */
  mode: 'reward' | 'fee';
  /** What was paid, as the review screen quoted it. */
  amountPence: number;
  /** Go to the listing — the one way on, available from the first frame. */
  onViewListing: () => void;
}

export function PaymentConfirmation({
  postId,
  mode,
  amountPence,
  onViewListing,
}: PaymentConfirmationProps) {
  const styles = useThemedStyles(makeStyles);
  const [phase, setPhase] = useState<Phase>('confirming');

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.announceForAccessibility('Payment received. Putting your car live.');
    (async () => {
      for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, CONFIRM_INTERVAL_MS));
        if (cancelled) return;
        // A failed read is a blip, not a failed payment: keep looking.
        const status = await fetchMyPostStatus(postId);
        if (cancelled) return;
        if (status === 'active') {
          setPhase('live');
          AccessibilityInfo.announceForAccessibility('Your car is live.');
          return;
        }
      }
      if (!cancelled) setPhase('slow');
    })();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  const live = phase === 'live';
  const steps: ProgressStep[] = [
    {
      id: 'paid',
      label: `${formatPounds(amountPence)} payment taken`,
      state: 'done',
    },
    ...(mode === 'reward'
      ? [
          {
            id: 'held',
            label: 'Reward held securely',
            state: live ? ('done' as const) : ('current' as const),
            detail: live
              ? 'It’s only paid out when a sighting leads to your car.'
              : 'Confirming now — usually a moment.',
          },
        ]
      : []),
    {
      id: 'live',
      label: 'Listing live',
      state: live ? 'done' : mode === 'fee' ? 'current' : 'upcoming',
      detail: live
        ? 'Spotters nearby can see your car now.'
        : mode === 'fee'
          ? 'Confirming now — usually a moment.'
          : undefined,
    },
  ];

  return (
    <Screen
      scroll
      edges={['top', 'bottom']}
      contentContainerStyle={styles.content}
      footer={
        <StickyActionBar>
          <Button
            label="View your listing"
            onPress={onViewListing}
            // Ink once it's live — the next thing to do. Quieter while we
            // confirm: it's a way out, not the moment.
            variant={live ? 'primary' : 'secondary'}
          />
        </StickyActionBar>
      }
    >
      <View testID={`payment-confirmation-${phase}`} style={styles.body}>
        <Text style={styles.title} accessibilityRole="header">
          {live ? 'Your car is live' : 'Payment received'}
        </Text>
        <Text style={styles.lede}>
          {phase === 'slow'
            ? 'We’re still confirming it. Your listing will show as live in a moment — you don’t need to wait here.'
            : live
              ? 'Thank you. We’ll tell you the moment there’s a sighting.'
              : 'Thank you. We’re putting your car live now.'}
        </Text>
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
    },
    body: {
      gap: spacing.lg,
    },
    title: {
      ...typography.title,
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
