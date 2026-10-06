/**
 * WHAT:  RewardTermBanner — the owner-only card on a live listing when its
 *        reward's term carries a decision or news: "Renew reward" in the last
 *        14 days, an honest "held" while a claim is open, "not back yet" once
 *        the date has passed, and "refunded — Add a reward" once it has gone
 *        back.
 * WHY:   ADR-0020: a reward lasts REWARD_TERM_DAYS (Stripe caps platform-
 *        balance holds at 90), and at the end it is refunded unless renewed.
 *        The pushes (10 and 3 days out, and the reward_ended one) are
 *        reminders that this door exists; THIS is the door — the
 *        StillMissingBanner lesson (review finding #15: a screen reachable
 *        only by notification).
 *
 *        THE STATES are lib/rewardTerm.ts's, because every sentence here is
 *        about money and the stat-band line beside it must agree:
 *          * RENEW: the card, the refund FIGURE if they don't renew
 *            (estimateRefundPence — every refund quote names its deduction),
 *            and the button;
 *          * BLOCKED (a recovery or dispute is open): nothing is refunded and
 *            nothing can change while a claim is open, so it says exactly
 *            that and offers no button;
 *          * ENDING (the date has passed; the refund waits on a 72-hour
 *            sightings hold or a claim): no "ends on" for a date gone by;
 *          * RETURNED (the refund is recorded, within 14 days): what came
 *            back and when, that the listing is still up, and "Add a reward".
 *        QUIET states (more than 14 days left; long after a return) are NOT
 *        here — the listing says them in one line in its stat band
 *        (quietRewardTermLine), so the date is said once.
 *
 *        THE REGISTER: a date and a choice, not an alarm — `surfaceSubtle`, no
 *        warning hue, no countdown. Letting a reward end is a fine answer.
 *        It is handed its status (useMyRewardStatus on the screen, shared with
 *        the stat-band line) and renders nothing it cannot state truthfully.
 * LINKS: ../lib/rewardTerm.ts (the phases); ../hooks/useMyRewardStatus.ts;
 *        src/features/vehicles/screens/PostDetailScreen.tsx (the mount);
 *        src/features/vehicles/components/StillMissingBanner.tsx (the pattern);
 *        src/shared/lib/dateTimeLabel.ts (formatTermDate, Europe/London);
 *        docs/decisions/ADR-0020-a-reward-has-a-term.md.
 */

import { StyleSheet, Text, View } from 'react-native';

import { REWARD_TERM_DAYS } from '@/shared/lib/bountyBounds';
import { formatTermDate } from '@/shared/lib/dateTimeLabel';
import { estimateRefundPence, formatPounds } from '@/shared/lib/money';
import { radii, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { Button } from '@/shared/ui';

import type { RewardStatus } from '../api/rewardChangeApi';
import { rewardTermPhase } from '../lib/rewardTerm';

export interface RewardTermBannerProps {
  /** The owner's reward status (useMyRewardStatus), or null before a read. */
  status: RewardStatus | null;
  /** Epoch ms of that read — the "now" the phase is computed against. */
  readAt: number;
  /** Opens the change screen (renewing is changing to any amount, including
   *  the same one). */
  onRenew: () => void;
  /** Opens the change screen to add a reward again, after one has ended. */
  onAddReward: () => void;
}

/** The owner's reward-term card for one live listing, or nothing. See the
 *  header for the states. */
export function RewardTermBanner({ status, readAt, onRenew, onAddReward }: RewardTermBannerProps) {
  const styles = useThemedStyles(makeStyles);
  const phase = rewardTermPhase(status, readAt);
  if (!status || (phase !== 'renew' && phase !== 'blocked' && phase !== 'ending' && phase !== 'returned')) {
    return null;
  }

  let title: string;
  let body: string;
  let action: { label: string; onPress: () => void; hint: string } | null = null;

  if (phase === 'returned') {
    // Narrowed by the phase: both are set whenever it is 'returned'.
    title = `Your ${formatPounds(status.endedRewardPence as number)} reward has ended`;
    // The refund's DATE, never its amount as "£200": the end-of-term refund
    // keeps the card fee (unless legacy) and the status has no refunded figure.
    body = `The refund went to your card on ${formatTermDate(status.rewardEndedAt as string)}. Your listing is still up, and you can add a reward again at any time.`;
    action = { label: 'Add a reward', onPress: onAddReward, hint: 'Opens the reward screen' };
  } else {
    const amount = formatPounds(status.amountPence as number);
    const termEndsAt = status.termEndsAt as string;
    // In full for a reward from before the term (its end-of-term refund absorbs
    // the fee) or one already marked absorbed; otherwise the estimate.
    const back = status.legacyTerm || status.feeAbsorbed
      ? `the full ${amount} comes back to your card`
      : `about ${formatPounds(estimateRefundPence(status.amountPence as number))} comes back to your card`;

    if (phase === 'ending') {
      title = `Your ${amount} reward ended on ${formatTermDate(termEndsAt)}`;
      body = status.blockedMessage
        ? 'It stays held while the recovery or dispute on your listing is sorted out. Your listing stays up.'
        : `We’re returning it — ${back}. Your listing stays up.`;
    } else if (phase === 'blocked') {
      title = `Your ${amount} reward ends on ${formatTermDate(termEndsAt, true)}`;
      body = 'It stays held while the recovery or dispute on your listing is sorted out, and can’t be renewed until then.';
    } else {
      title = `Your ${amount} reward ends on ${formatTermDate(termEndsAt, true)}`;
      body = `Renew it to keep a reward on your listing for another ${REWARD_TERM_DAYS} days. If you don’t, ${back}, and your listing stays up.`;
      action = { label: 'Renew reward', onPress: onRenew, hint: 'Opens the reward screen' };
    }
  }

  return (
    <View style={styles.card} testID="reward-term-banner">
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.body}>{body}</Text>
      {action ? (
        <View style={styles.actions}>
          <Button
            label={action.label}
            variant="secondary"
            onPress={action.onPress}
            accessibilityHint={action.hint}
          />
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
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
