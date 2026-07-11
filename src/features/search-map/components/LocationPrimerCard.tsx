/**
 * WHAT:  LocationPrimerCard — the inline card shown atop a national-mode
 *        feed when the user has never picked an area: explains why location
 *        helps, offers "Use my location" (the ONE path that may fire the OS
 *        permission prompt) and "Set my area" (no permission needed).
 * WHY:   The feed must never cold-fire the OS location dialog — this card is
 *        the primer that asks first (SECURITY_AND_TRUST: location is
 *        personal data, opt-in). Kept feature-local until another feature
 *        needs a primer, per ARCHITECTURE.md.
 * LINKS: src/features/search-map/hooks/useFeedLocation.ts (useMyLocation);
 *        docs/DESIGN_SYSTEM.md (tone: helpful, never demanding).
 */

import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/shared/theme';
import { Button } from '@/shared/ui';

export interface LocationPrimerCardProps {
  /** May trigger the OS permission prompt. */
  onUseMyLocation: () => void;
  /** Opens the Set-my-area picker instead — no permission involved. */
  onSetArea: () => void;
}

export const LocationPrimerCard = memo(function LocationPrimerCard({
  onUseMyLocation,
  onSetArea,
}: LocationPrimerCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{"See what's happening near you"}</Text>
      <Text style={styles.body}>
        {"Show cars reported around your area. Your location stays on your device — it's only used to sort what you see."}
      </Text>
      <View style={styles.actions}>
        <Button label="Use my location" fullWidth={false} onPress={onUseMyLocation} />
        <Button label="Set my area" variant="ghost" fullWidth={false} onPress={onSetArea} />
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
