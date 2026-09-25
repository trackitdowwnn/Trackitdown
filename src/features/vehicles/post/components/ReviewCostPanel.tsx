/**
 * WHAT:  "What you'll pay" — the sum the owner is about to be charged, and one
 *        honest line about what happens to it, at the foot of the posting
 *        wizard's review step.
 * WHY:   The review had NO money summary at all: no total, no fee, no escrow
 *        or refund line, and in reward mode the "Listing" row named no number
 *        whatsoever ("Reward offered"). The only figure on the last screen
 *        before a card charge was inside the button. The pricing step calls
 *        itself "the only pre-payment disclosure surface in the flow (there is
 *        no checkout screen)" — true, but it is several screens back by now,
 *        and a number restated at the moment of commitment is the difference
 *        between disclosed and remembered.
 *
 *        ⚠️ EVERY FIGURE HERE IS BORROWED, NEVER COMPUTED LOCALLY.
 *        `estimateRefundPence` is binding — its own doc: "Every surface that
 *        quotes a refund before the owner commits must use this one function,
 *        or two screens will disagree about the same number." The fee comes
 *        from LISTING_FEE_PENCE for the same reason the pricing card stopped
 *        hard-coding £50: a literal here would quote a price the database had
 *        stopped charging.
 *
 *        ⚠️ DISPLAY ONLY. Like the final CTA's label, nothing here decides
 *        what is charged — create-payment-intent derives the amount from the
 *        post's own price column, and the client sends only an id (and the
 *        payment hook refuses to open the sheet if the server's total differs
 *        from the one shown here).
 *
 *        ITEMISED since ADR-0020 (2026-09-25), reversing the 2026-08-22 "one
 *        line, not a breakdown" call. That call was right when the owner paid
 *        one thing; with the fee on top they pay two — a reward that is theirs
 *        until a spotter earns it, and our fee — and one total would hide which
 *        is which at the moment of commitment. Under it, RewardExplainer says
 *        what happens to the money next, which nothing said before paying.
 * LINKS: src/shared/lib/money.ts (chargeBreakdown, LISTING_FEE_PENCE);
 *        src/features/vehicles/components/RewardExplainer.tsx;
 *        src/shared/ui/MoneySlider.tsx (defaultBountyPanelCopy — the wording
 *          this echoes); src/features/vehicles/post/postACarFlow.tsx;
 *        docs/decisions/ADR-0020-the-reward-is-the-reward.md.
 */

import { StyleSheet, Text, View } from 'react-native';

import {
  chargeBreakdown,
  formatPounds,
  LISTING_FEE_PENCE,
  SERVICE_FEE_PERCENT,
} from '@/shared/lib/money';
import { spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';

import { DEFAULT_BOUNTY_PENCE } from '@/shared/lib/bountyBounds';
import { RewardExplainer } from '../../components/RewardExplainer';
import type { PostACarAnswers } from '../types';

export interface ReviewCostPanelProps {
  answers: Partial<PostACarAnswers>;
}

export function ReviewCostPanel({ answers }: ReviewCostPanelProps) {
  const styles = useThemedStyles(makeStyles);

  // ⚠️ NO FIGURE UNTIL THE MODE IS CHOSEN. The pricing step is deliberately
  // unseeded, and defaulting to reward here would print "Reward £250" — the
  // slider's seed — as though they had picked it. That is the same wrong the
  // fee-mode bounty row was, arriving from the other direction. The review is
  // not reachable without an answer today; this is so it stays true if it ever
  // is.
  if (answers.pricingMode === undefined) {
    return null;
  }

  const feeMode = answers.pricingMode === 'fee';
  // Mirrors finalCtaLabel's fallback so the panel and the button can never
  // name different sums.
  const bountyPence = answers.bountyAmountPence ?? DEFAULT_BOUNTY_PENCE;

  if (feeMode) {
    return (
      <View style={styles.block} testID="review-cost-panel">
        <Text accessibilityRole="header" style={styles.title}>
          What you&rsquo;ll pay
        </Text>
        <View style={styles.row}>
          <Text style={styles.label}>Listing fee</Text>
          <Text style={[styles.amount, styles.amountFee]}>{formatPounds(LISTING_FEE_PENCE)}</Text>
        </View>
        {/* Matches the pricing card's own wording — two screens describing the
            same fee must not describe it differently. */}
        <Text style={styles.note}>A one-off fee to list. Not refundable.</Text>
      </View>
    );
  }

  // ADR-0020: the fee is ON TOP, so this is an itemised bill rather than one
  // line. Three rows because the owner is now paying two different things —
  // the reward (theirs to give, returned if nobody helps) and our fee — and a
  // single total would hide which is which at the exact moment they commit.
  const { rewardPence, serviceFeePence, chargePence } = chargeBreakdown(bountyPence);

  return (
    <View style={styles.block} testID="review-cost-panel">
      <Text accessibilityRole="header" style={styles.title}>
        What you&rsquo;ll pay
      </Text>
      <View style={styles.lines}>
        <View style={styles.row}>
          <Text style={styles.label}>Reward</Text>
          <Text style={[styles.lineAmount, styles.amountValue]}>{formatPounds(rewardPence)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Service fee ({SERVICE_FEE_PERCENT}%)</Text>
          <Text style={styles.lineAmount}>{formatPounds(serviceFeePence)}</Text>
        </View>
        <View style={[styles.row, styles.totalRow]}>
          <Text style={styles.totalLabel}>You pay</Text>
          <Text style={styles.amount} testID="review-cost-total">
            {formatPounds(chargePence)}
          </Text>
        </View>
      </View>
      <RewardExplainer rewardPence={rewardPence} />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // Matches ReviewStep's own group rhythm — a hairline, then 32, then a 16
    // gap — so the money reads as the last section rather than a bolted-on box.
    block: {
      gap: spacing.lg,
      paddingTop: spacing.xxl,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    title: {
      ...typography.heading,
      color: c.textPrimary,
    },
    lines: {
      gap: spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: spacing.lg,
    },
    // The total sits under a hairline, like the foot of a receipt, so "You
    // pay" reads as the sum of the two lines above rather than a third item.
    totalRow: {
      paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    // flexShrink so the LABEL wraps at 200% type rather than pushing the
    // amount — the number the owner is about to pay — off the screen.
    label: {
      ...typography.body,
      color: c.textPrimary,
      flexShrink: 1,
    },
    totalLabel: {
      ...typography.cardTitle,
      color: c.textPrimary,
      flexShrink: 1,
    },
    lineAmount: {
      ...typography.body,
      color: c.textPrimary,
    },
    // `heading`, not `title`: the CTA naming the same sum sits a thumb below
    // this, and PostDetailBody removed exactly this duplication once already
    // ("its old display-size solo section duplicated the sticky bar's '£450
    // reward' a thumb away"). The panel supports the button; it does not
    // compete with it.
    amount: {
      ...typography.heading,
      color: c.textPrimary,
    },
    // ⚠️ Accent is reserved for BOUNTY/VALUE moments. A listing fee is the
    // absence of a reward, and painting it in the value accent is the dilution
    // that rule exists to prevent — PostDetailBody refused it for the
    // no-reward case in as many words.
    amountValue: {
      color: c.accentText,
    },
    amountFee: {
      color: c.textPrimary,
    },
    note: {
      ...typography.caption,
      color: c.textSecondary,
    },
  });
