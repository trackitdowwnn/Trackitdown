/**
 * WHAT:  "Your money" — the owner's money for this listing, on the listing:
 *        where it is now (a toned dot and a short label), what that means in
 *        one sentence, and a receipt line of what they paid.
 * WHY:   Once an owner paid, the app used to go silent about their money. A
 *        toast said "refund sent after Thursday" once and was gone; "Recovered"
 *        looked the same whether the spotter was paid or the owner refunded;
 *        "waiting for the spotter's bank details" lived only in a toast. This
 *        is the persistent answer to "where's my money?", read fresh on every
 *        return to the screen (usePostMoney), because money usually moves
 *        while the owner is somewhere else.
 *
 *        The dot's colour never carries the meaning alone: the label beside it
 *        says the same thing in words (DESIGN_SYSTEM — no colour-only status).
 *        One accessibility stop reads the whole card, in order.
 * LINKS: src/features/vehicles/lib/postMoney.ts (the words, per state);
 *        src/features/vehicles/hooks/usePostMoney.ts (the read);
 *        src/features/vehicles/components/PostDetailBody.tsx (the host).
 */

import { StyleSheet, Text, View } from 'react-native';

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
import { badgeToneColor } from '@/shared/ui';

import { detailCopy, receiptLine, refundFeeLine, type PostMoney } from '../lib/postMoney';

export interface PostMoneyCardProps {
  money: PostMoney;
  /** Injectable for tests — dates render relative to it. */
  now?: Date;
}

/** Sentences for a screen reader, each ending once: the lines already carry
 *  their own full stops, so a plain join would read "car.. You paid". */
function spokenFrom(parts: (string | null)[]): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .map((part) => part.replace(/\.+$/, ''))
    .join('. ')
    .concat('.');
}

export function PostMoneyCard({ money, now }: PostMoneyCardProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const copy = detailCopy(money, now);
  const receipt = receiptLine(money);
  const feeLine = refundFeeLine(money);

  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={spokenFrom([copy.label, copy.line, receipt, feeLine])}
      testID="post-money-card"
    >
      <View style={styles.statusRow}>
        <View
          style={[styles.dot, { backgroundColor: badgeToneColor(palette, copy.tone) }]}
          importantForAccessibility="no"
        />
        <Text style={styles.label} testID="post-money-label">
          {copy.label}
        </Text>
      </View>
      {copy.line ? <Text style={styles.line}>{copy.line}</Text> : null}
      <View style={styles.receipt}>
        <Text style={styles.receiptText}>{receipt}</Text>
        {feeLine ? <Text style={styles.receiptText}>{feeLine}</Text> : null}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // The standard card (DESIGN_SYSTEM → Card): surface fill + hairline. On it
    // the receipt's border-coloured divider below is actually visible — on the
    // subtle fill this used first, it was not.
    card: {
      ...cardSurface(c),
      padding: spacing.lg,
      gap: spacing.sm,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    // The same dot StatusBadge draws, so a money state and a listing status
    // read as one family.
    dot: {
      width: sizes.progressDot,
      height: sizes.progressDot,
      borderRadius: radii.full,
    },
    label: {
      ...typography.cardTitle,
      color: c.textPrimary,
      flexShrink: 1,
    },
    line: {
      ...typography.body,
      color: c.textPrimary,
    },
    // Separated from the status by a hairline: the status is NOW, the receipt
    // is what happened at posting, and the two must not read as one sentence.
    receipt: {
      gap: spacing.xs,
      paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    receiptText: {
      ...typography.caption,
      color: c.textSecondary,
    },
  });
