/**
 * WHAT:  AlertNudgeCard — the one-time inline card offering to set an alert
 *        area, shown atop the Explore feed to a member who has never set one.
 * WHY:   Discovery. Nobody opens Profile settings looking for a feature they
 *        don't know exists, and the feed is where the value is obvious: the
 *        user is already looking at cars near them. Deliberately a card and
 *        not a sheet — this is an invitation, and interrupting someone
 *        browsing to demand a setting would be the opposite of the app's tone.
 *        Visual sibling of LocationPrimerCard so the feed keeps one voice.
 * LINKS: ../hooks/useAlertNudgeCard.ts (the decision + the once-only flag);
 *        src/features/search-map/components/LocationPrimerCard.tsx (the
 *        pattern); src/features/search-map/screens/HomeFeedScreen.tsx.
 */

import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/shared/theme';
import { Button } from '@/shared/ui';

export interface AlertNudgeCardProps {
  /** Opens alert settings. The caller also marks the offer as made. */
  onSetArea: () => void;
  onDismiss: () => void;
}

export const AlertNudgeCard = memo(function AlertNudgeCard({
  onSetArea,
  onDismiss,
}: AlertNudgeCardProps) {
  return (
    <View style={styles.card} testID="alert-nudge-card">
      <Text style={styles.title}>Know when a car goes missing near you</Text>
      <Text style={styles.body}>
        {
          "Pick an area and we'll send you a notification when a car is reported stolen inside it. A few a day at most — and you can save a rough area rather than your exact address."
        }
      </Text>
      <View style={styles.actions}>
        <Button label="Set my alert area" fullWidth={false} onPress={onSetArea} />
        <Button label="Not now" variant="ghost" fullWidth={false} onPress={onDismiss} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    // Feed gutter: 16 per the DESIGN_SYSTEM feed-surface exception.
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.lg,
    gap: spacing.sm,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
    flexWrap: 'wrap',
  },
});
