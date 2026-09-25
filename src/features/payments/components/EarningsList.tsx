/**
 * WHAT:  "Your rewards" — every reward a spotter has earned, newest first: the
 *        car it was for, where the money is (a toned dot and a few words), and
 *        the amount; totals above.
 * WHY:   A spotter used to see ONE pending credit (`my_pending_credit` is
 *        `limit 1`), nothing once it was paid, and nothing at all while a
 *        payout was being checked. So a second reward was invisible, a paid
 *        one left no trace, and "being checked" looked exactly like "sent".
 *        This is the whole history, with each reward's own state.
 *
 *        ⚠️ `being_checked` gives no reason and no outcome — the server makes a
 *        pending and a rejected review identical, and the words must too.
 *        The dot never carries meaning alone; the words beside it say it.
 * LINKS: ../api/payoutsApi.ts (fetchMyEarnings, EarningState);
 *        supabase/migrations/20260925110000_money_you_can_see.sql
 *          (credit_money_state — the states and their rules);
 *        ../screens/PayoutsScreen.tsx (the host).
 */

import { StyleSheet, Text, View } from 'react-native';

import { formatDateLabelCompact } from '@/shared/lib/dateTimeLabel';
import { formatPounds } from '@/shared/lib/money';
import {
  cardSurface,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { badgeToneColor, type BadgeTone } from '@/shared/ui';

import type { Earning, EarningState, Earnings } from '../api/payoutsApi';

/** The words for where one reward is. */
export function earningCopy(
  earning: Pick<Earning, 'state' | 'paidAt'>,
  now: Date = new Date(),
): { label: string; tone: BadgeTone } {
  const byState: Record<EarningState, { label: string; tone: BadgeTone }> = {
    add_details: { label: 'Add your bank details to get it', tone: 'warning' },
    verifying: { label: 'Stripe is checking your details', tone: 'warning' },
    being_checked: { label: 'Being checked — nothing you need to do', tone: 'warning' },
    on_its_way: { label: 'On its way to your bank', tone: 'neutral' },
    paid: {
      label: earning.paidAt ? `Paid on ${formatDateLabelCompact(earning.paidAt, now)}` : 'Paid',
      tone: 'success',
    },
  };
  return byState[earning.state];
}

/** "Blue Ford" — the car as the spotter reported it, or a neutral stand-in. */
function carLabel(car: Earning['car']): string {
  const words = [car.colour, car.make].filter((w) => w.trim().length > 0).join(' ');
  return words.length > 0 ? words : 'A car you reported';
}

/**
 * "£500 paid · £300 not paid yet" — only the parts that are not zero. NOT
 * "on the way": pending includes rewards waiting on bank details or a check,
 * which are not moving yet (ui-review 2026-09-25).
 */
export function totalsLine(totals: Earnings['totals']): string | null {
  const parts = [
    totals.paidPence > 0 ? `${formatPounds(totals.paidPence)} paid` : null,
    totals.pendingPence > 0 ? `${formatPounds(totals.pendingPence)} not paid yet` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export interface EarningsListProps {
  earnings: Earnings;
  /** Injectable for tests — dates render relative to it. */
  now?: Date;
}

export function EarningsList({ earnings, now }: EarningsListProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const totals = totalsLine(earnings.totals);

  return (
    <View style={styles.block} testID="earnings-list">
      <Text style={styles.heading} accessibilityRole="header">
        Your rewards
      </Text>
      {totals ? <Text style={styles.totals}>{totals}</Text> : null}
      <View style={styles.card}>
        {earnings.items.map((earning, index) => {
          const copy = earningCopy(earning, now);
          const amount = formatPounds(
            earning.state === 'paid' && earning.paidPence !== null
              ? earning.paidPence
              : earning.rewardPence,
          );
          const car = carLabel(earning.car);
          return (
            <View
              key={earning.sightingId}
              style={[styles.row, index > 0 && styles.rowDivider]}
              accessible
              accessibilityLabel={`${car}, ${amount}. ${copy.label}.`}
              testID={`earning-${earning.sightingId}`}
            >
              <View style={styles.rowText}>
                <Text style={styles.car}>{car}</Text>
                <View style={styles.stateRow}>
                  <View
                    style={[styles.dot, { backgroundColor: badgeToneColor(palette, copy.tone) }]}
                    importantForAccessibility="no"
                  />
                  <Text style={styles.state}>{copy.label}</Text>
                </View>
              </View>
              <Text style={styles.amount}>{amount}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    block: {
      gap: spacing.sm,
    },
    heading: {
      ...typography.sectionTitle,
      color: c.textPrimary,
    },
    totals: {
      ...typography.body,
      color: c.textSecondary,
    },
    card: {
      ...cardSurface(c),
      paddingHorizontal: spacing.lg,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
      minHeight: sizes.touchTarget,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    // flexShrink so a long state wraps at 200% type rather than pushing the
    // amount off the row.
    rowText: {
      flex: 1,
      flexShrink: 1,
      gap: spacing.xs,
    },
    car: {
      ...typography.cardTitle,
      color: c.textPrimary,
    },
    stateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    dot: {
      width: sizes.progressDot,
      height: sizes.progressDot,
      borderRadius: radii.full,
    },
    state: {
      ...typography.label,
      color: c.textSecondary,
      flexShrink: 1,
    },
    amount: {
      ...typography.heading,
      color: c.textPrimary,
    },
  });
