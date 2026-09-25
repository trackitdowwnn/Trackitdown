/**
 * WHAT:  "How your reward works" — three numbered steps that tell an owner what
 *        happens to the money they are about to pay: it is held, they confirm
 *        who found the car, and it goes to that spotter in full or comes back
 *        to them. Shown on the posting wizard's review step, under the charge.
 * WHY:   Before this, the owner learned the rules of their own money one piece
 *        at a time and mostly AFTER paying: the 72-hour hold appeared for the
 *        first time on the exit sheet, refund timing appeared nowhere, and
 *        nothing said that THEY are the one who decides who is paid. The review
 *        step is the last screen before a card charge (there is no checkout
 *        screen — payment is Stripe's own sheet), so it is the one place all
 *        of it can be said in time.
 *
 *        Three steps, not a paragraph: each is one question an owner actually
 *        has ("is it safe?", "who decides?", "what if nobody helps?").
 *
 *        ⚠️ Every rule stated here is a server rule, restated — never a new
 *        one. The 72-hour hold and its 14-day trigger are ADR-0011
 *        (`create_refund_hold`); "in full" is ADR-0020; the refund estimate is
 *        `estimateRefundPence`, the one function every pre-payment surface
 *        quotes. If one of those changes, this copy must change with it.
 * LINKS: src/features/vehicles/post/components/ReviewCostPanel.tsx (host);
 *        src/shared/lib/money.ts (chargeBreakdown, estimateRefundPence);
 *        docs/decisions/ADR-0011-refund-holds-and-disputes.md;
 *        docs/decisions/ADR-0020-the-reward-is-the-reward.md.
 */

import { StyleSheet, Text, View } from 'react-native';

import { chargeBreakdown, estimateRefundPence, formatPounds } from '@/shared/lib/money';
import { radii, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';

export interface RewardExplainerProps {
  /** The reward the owner chose, in pence. The charge is derived from it. */
  rewardPence: number;
}

interface Step {
  title: string;
  body: string;
}

/** The three steps, as data — so the test can read them and the copy lives in one place. */
export function rewardExplainerSteps(rewardPence: number): Step[] {
  const { chargePence } = chargeBreakdown(rewardPence);
  const reward = formatPounds(rewardPence);
  return [
    {
      title: 'We hold it safely',
      body: `Your ${formatPounds(chargePence)} is held from when your listing goes live. Nobody is paid until you say so.`,
    },
    {
      title: 'You say who found it',
      body: 'When your car’s back, pick the sighting that led you to it — or tell us you found it another way.',
    },
    {
      title: 'Paid in full, or back to you',
      // Names the deduction: our Terms promise it is shown before paying, and
      // "about £X" without the reason reads as though we keep the difference.
      body: `That spotter gets the full ${reward}. If no one’s sighting helped, about ${formatPounds(
        estimateRefundPence(chargePence),
      )} comes back to your card within 5–10 working days — card processing fees aren’t refundable. If anyone reported a sighting in the last two weeks, we wait 72 hours first so they can tell us if theirs led to it.`,
    },
  ];
}

/**
 * "How your reward works" — the three steps, each read by a screen reader as
 * one stop ("Step 1 of 3. …"). Pure presentation of `rewardExplainerSteps`.
 */
export function RewardExplainer({ rewardPence }: RewardExplainerProps) {
  const styles = useThemedStyles(makeStyles);
  const steps = rewardExplainerSteps(rewardPence);

  return (
    <View style={styles.block} testID="reward-explainer">
      <Text accessibilityRole="header" style={styles.title}>
        How your reward works
      </Text>
      {steps.map((step, index) => (
        <View
          key={step.title}
          style={styles.step}
          // One stop per step for a screen reader: "Step 1 of 3. We hold it
          // safely. Your £525 is held…" — the drawn number is decoration.
          accessible
          accessibilityLabel={`Step ${index + 1} of ${steps.length}. ${step.title}. ${step.body}`}
        >
          <View style={styles.marker} importantForAccessibility="no-hide-descendants">
            <Text style={styles.markerText}>{index + 1}</Text>
          </View>
          <View style={styles.stepText}>
            <Text style={styles.stepTitle}>{step.title}</Text>
            <Text style={styles.stepBody}>{step.body}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** Marker diameter: the 24pt step of the spacing scale, so it sits on the grid. */
const MARKER = spacing.xl;

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    block: {
      gap: spacing.lg,
    },
    title: {
      ...typography.cardTitle,
      color: c.textPrimary,
    },
    step: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    // min-, not fixed, sizes: at 200% type the numeral outgrows 24pt, and a
    // fixed circle would clip it. The pill it becomes is still a marker.
    marker: {
      minWidth: MARKER,
      minHeight: MARKER,
      paddingHorizontal: spacing.xs,
      borderRadius: radii.full,
      backgroundColor: c.surfaceSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    markerText: {
      ...typography.label,
      color: c.textPrimary,
    },
    stepText: {
      flex: 1,
      gap: spacing.xs,
    },
    stepTitle: {
      ...typography.label,
      color: c.textPrimary,
    },
    stepBody: {
      ...typography.caption,
      color: c.textSecondary,
    },
  });
