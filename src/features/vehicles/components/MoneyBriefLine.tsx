/**
 * WHAT:  One line under an owner's listing card on My listings: a toned dot
 *        and where that listing's money is — "£500 reward held", "Refund on
 *        hold", "£500 sent to your spotter".
 * WHY:   The card's status badge says what happened to the CAR; it never said
 *        what happened to the MONEY, and "Recovered" read the same whether the
 *        spotter was paid or the owner refunded. The line sits under the card
 *        rather than inside it because VehicleCard is shared UI and must not
 *        learn what an owner's money is (ARCHITECTURE rule 2).
 *
 *        The dot never carries the meaning alone — the words beside it say it.
 * LINKS: src/features/vehicles/lib/postMoney.ts (briefCopy — the words);
 *        src/features/vehicles/screens/MyPostsScreen.tsx (the host).
 */

import { StyleSheet, Text, View } from 'react-native';

import { radii, sizes, spacing, typography, usePalette, useThemedStyles, type Palette } from '@/shared/theme';

import { badgeToneColor } from '@/shared/ui';

import { briefCopy, type PostMoneyBrief } from '../lib/postMoney';

export interface MoneyBriefLineProps {
  money: PostMoneyBrief;
  testID?: string;
}

export function MoneyBriefLine({ money, testID }: MoneyBriefLineProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const copy = briefCopy(money);

  return (
    <View style={styles.row} testID={testID}>
      <View
        style={[styles.dot, { backgroundColor: badgeToneColor(palette, copy.tone) }]}
        importantForAccessibility="no"
      />
      <Text style={styles.label} accessibilityLabel={`Money: ${copy.label}`}>
        {copy.label}
      </Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingTop: spacing.sm,
    },
    dot: {
      width: sizes.progressDot,
      height: sizes.progressDot,
      borderRadius: radii.full,
    },
    label: {
      ...typography.label,
      color: c.textSecondary,
      flexShrink: 1,
    },
  });
