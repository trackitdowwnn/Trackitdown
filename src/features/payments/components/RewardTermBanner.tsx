/**
 * WHAT:  RewardTermBanner — the owner-only line on a live listing that says
 *        when its reward's term ends, and, in the last 14 days, becomes a card
 *        with "Renew reward" (the change screen, same amount or any other).
 * WHY:   ADR-0020: a reward lasts REWARD_TERM_DAYS (Stripe caps platform-
 *        balance holds at 90), and at the end it is refunded unless renewed.
 *        The pushes (10 and 3 days out) are reminders that this door exists;
 *        THIS is the door — the StillMissingBanner lesson (review finding
 *        #15: a screen reachable only by notification).
 *
 *        FOUR HONEST STATES, because every sentence here is about money:
 *          * QUIET (more than 14 days left): one caption line with the date —
 *            the term is never a surprise, but a card above the car for six
 *            weeks would be clutter;
 *          * RENEW WINDOW: the card, the refund FIGURE if they don't renew
 *            (estimateRefundPence — every refund quote names its deduction),
 *            and the button;
 *          * BLOCKED (a recovery or dispute is open): nothing is refunded and
 *            nothing can change while a claim is open, so it says exactly
 *            that and offers no button;
 *          * ENDED (the date has passed; the refund waits on a 72-hour
 *            sightings hold or a claim): no "ends on" for a date gone by.
 *
 *        THE REGISTER: a date and a choice, not an alarm — `surfaceSubtle`, no
 *        warning hue, no countdown. Letting a reward end is a fine answer.
 *        It loads its own status (owner-scoped) and reloads on focus, so
 *        returning from a renewal shows the new date; anything it cannot show
 *        honestly (no reward, no term, a failed read) renders nothing.
 * LINKS: ../api/rewardChangeApi.ts (fetchMyRewardStatus);
 *        src/features/vehicles/screens/PostDetailScreen.tsx (the mount);
 *        src/features/vehicles/components/StillMissingBanner.tsx (the pattern);
 *        src/shared/lib/dateTimeLabel.ts (formatTermDate, Europe/London);
 *        docs/decisions/ADR-0020-a-reward-has-a-term.md.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { REWARD_TERM_DAYS } from '@/shared/lib/bountyBounds';
import { formatTermDate } from '@/shared/lib/dateTimeLabel';
import { estimateRefundPence, formatPounds } from '@/shared/lib/money';
import { radii, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { Button } from '@/shared/ui';

import { fetchMyRewardStatus, type RewardStatus } from '../api/rewardChangeApi';

/** The last stretch in which the banner offers Renew — wider than the first
 *  reminder push (10 days), so a push never points at a banner without one. */
const RENEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export interface RewardTermBannerProps {
  postId: string;
  /** Opens the change screen (renewing is changing to any amount, including
   *  the same one). */
  onRenew: () => void;
}

/**
 * The owner's reward-term line / card for one live listing. Loads its own
 * status on focus; renders nothing it cannot state truthfully. See the header
 * for the four states.
 */
export function RewardTermBanner({ postId, onRenew }: RewardTermBannerProps) {
  const styles = useThemedStyles(makeStyles);
  const [status, setStatus] = useState<RewardStatus | null>(null);
  // "Now" is captured with the read, never computed in render: the React
  // Compiler memoises render-time clock reads on device, which would freeze
  // whether the renew window has opened.
  const [readAt, setReadAt] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      fetchMyRewardStatus(postId)
        .then((next) => {
          if (!active) return;
          setStatus(next);
          setReadAt(Date.now());
        })
        // Not the owner's problem to see a failed read here: the listing and
        // its Manage sheet still work, and the next focus retries.
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }, [postId]),
  );

  if (!status || status.amountPence === null || !status.termEndsAt) {
    return null;
  }
  const endsAt = new Date(status.termEndsAt).getTime();
  if (Number.isNaN(endsAt)) {
    return null;
  }
  const amount = formatPounds(status.amountPence);
  const ended = endsAt <= readAt;
  const renewWindow = !ended && endsAt - readAt <= RENEW_WINDOW_MS;

  if (!ended && !renewWindow) {
    // QUIET: the date, once, under the photos — no card, no button.
    return (
      <Text style={styles.quiet} testID="reward-term-quiet">
        {`Your ${amount} reward runs until ${formatTermDate(status.termEndsAt)}.`}
      </Text>
    );
  }

  // In full for a reward from before the term (its end-of-term refund absorbs
  // the fee) or one already marked absorbed; otherwise the estimate.
  const back = status.legacyTerm || status.feeAbsorbed
    ? `the full ${amount} comes back to your card`
    : `about ${formatPounds(estimateRefundPence(status.amountPence))} comes back to your card`;

  let title: string;
  let body: string;
  let canRenew = false;
  if (ended) {
    title = `Your ${amount} reward ended on ${formatTermDate(status.termEndsAt)}`;
    body = status.blockedMessage
      ? 'It stays held while the recovery or dispute on your listing is sorted out. Your listing stays up.'
      : `We’re returning it — ${back}. Your listing stays up.`;
  } else if (status.blockedMessage) {
    title = `Your ${amount} reward ends on ${formatTermDate(status.termEndsAt, true)}`;
    body = 'It stays held while the recovery or dispute on your listing is sorted out, and can’t be renewed until then.';
  } else {
    title = `Your ${amount} reward ends on ${formatTermDate(status.termEndsAt, true)}`;
    body = `Renew it to keep a reward on your listing for another ${REWARD_TERM_DAYS} days. If you don’t, ${back}, and your listing stays up.`;
    canRenew = true;
  }

  return (
    <View style={styles.card} testID="reward-term-banner">
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.body}>{body}</Text>
      {canRenew ? (
        <View style={styles.actions}>
          <Button
            label="Renew reward"
            variant="secondary"
            onPress={onRenew}
            accessibilityHint="Opens the reward screen"
          />
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    quiet: {
      ...typography.caption,
      color: c.textSecondary,
    },
    card: {
      padding: spacing.md,
      gap: spacing.xs,
      backgroundColor: c.surfaceSubtle,
      borderRadius: radii.lg,
    },
    title: {
      ...typography.cardTitle,
      color: c.textPrimary,
    },
    // The decision line: body size, primary ink — it carries the money.
    body: {
      ...typography.body,
      color: c.textPrimary,
    },
    actions: {
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
  });
