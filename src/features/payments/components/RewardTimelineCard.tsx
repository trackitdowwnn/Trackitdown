/**
 * WHAT:  RewardTimelineCard — "Your reward" on an owner's own listing once its
 *        money is moving or has moved: taken → paid out, or taken → refunded,
 *        with the dates (and a refund hold's date while one runs).
 * WHY:   PR4 of the payments UX plan (2026-10-13). After a recovery or a
 *        cancellation an owner had one toast and then nothing, on a listing
 *        that still showed the old £ figure. "Your refund is sent after
 *        16 October" lived in that toast alone. This is the record.
 *
 *        Owner-only by construction: the read behind it refuses anyone else.
 *        Presentational — the steps come from rewardTimeline().
 * LINKS: ../lib/rewardTimeline.ts; ../hooks/useMyRewardTimeline.ts;
 *        src/features/vehicles/screens/PostDetailScreen.tsx (where it sits);
 *        src/shared/ui/ProgressSteps.tsx.
 */

import { StyleSheet, Text, View } from 'react-native';

import { cardSurface, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { ProgressSteps, type ProgressStep } from '@/shared/ui';

export interface RewardTimelineCardProps {
  steps: ProgressStep[];
}

export function RewardTimelineCard({ steps }: RewardTimelineCardProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.card} testID="reward-timeline">
      <Text style={styles.title} accessibilityRole="header">
        Your reward
      </Text>
      <ProgressSteps steps={steps} testID="reward-steps" />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      ...cardSurface(c),
      padding: spacing.lg,
      gap: spacing.lg,
    },
    title: {
      ...typography.heading,
      color: c.textPrimary,
    },
  });
