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
 *        what is charged — create-payment-intent reads the amount from the
 *        post's own price column, and the client sends only an id.
 *
 *        One line, not a breakdown (owner call 2026-08-22). The reader is a
 *        theft victim on a bad day; the whole 95/5 split panel lives on the
 *        bounty step where they chose the figure, and repeating it here would
 *        trade clarity for completeness at exactly the wrong moment.
 * LINKS: src/shared/lib/money.ts (estimateRefundPence, LISTING_FEE_PENCE);
 *        src/shared/ui/MoneySlider.tsx (defaultBountyPanelCopy — the wording
 *          this echoes); src/features/vehicles/post/postACarFlow.tsx.
 */

import { StyleSheet, Text, View } from 'react-native';

import { estimateRefundPence, formatPounds, LISTING_FEE_PENCE } from '@/shared/lib/money';
import { spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';

import { DEFAULT_BOUNTY_PENCE } from '../lib/bountyBounds';
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

  const label = feeMode ? 'Listing fee' : 'Reward';
  const amountPence = feeMode ? LISTING_FEE_PENCE : bountyPence;
  const note = feeMode
    ? // Matches the pricing card's own wording — two screens describing the
      // same fee must not describe it differently.
      'A one-off fee to list. Not refundable.'
    : // The gap between the two figures is NAMED. "of it" alone was truthful —
      // estimateRefundPence already nets the card costs off — but it left the
      // difference unexplained on the commitment surface, and the natural
      // misreading is that we keep it. Same clause as defaultBountyPanelCopy,
      // where they first saw it.
      `Held when your listing goes live. You only pay it if a spotter finds your car; otherwise ${formatPounds(
        estimateRefundPence(bountyPence),
      )} of it comes back to you — card processing costs are not refundable.`;

  return (
    <View style={styles.block} testID="review-cost-panel">
      <Text accessibilityRole="header" style={styles.title}>
        What you&rsquo;ll pay
      </Text>
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.amount, feeMode ? styles.amountFee : styles.amountValue]}>
          {formatPounds(amountPence)}
        </Text>
      </View>
      <Text style={styles.note}>{note}</Text>
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
    row: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: spacing.lg,
    },
    label: {
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
