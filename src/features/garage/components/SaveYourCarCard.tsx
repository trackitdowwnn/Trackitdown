/**
 * WHAT:  SaveYourCarCard — the peacetime nudge in the Explore feed. Explains why
 *        saving a car is worth 60 seconds now, offers "Add your car", and can be
 *        dismissed for good.
 * WHY:   The garage only pays off if it is filled in BEFORE anything goes wrong,
 *        and nothing else tells people it exists unless they happen to open
 *        Profile. This is the one reaching surface — inline and ignorable, never
 *        an interruption, because the user came to the feed to look at cars.
 *        Geometry copied from LocationPrimerCard (the same slot, the same feed
 *        gutter) so the header doesn't grow a second visual language.
 *
 *        Unlike that card this one is DISMISSIBLE, because it is a suggestion
 *        rather than a setup step. Kept feature-local per ARCHITECTURE.md
 *        (premature sharing is worse than duplication) — promote to shared/ui
 *        only if a second dismissible card appears.
 * LINKS: src/features/garage/hooks/useGarageNudgeCard.ts (decides when it shows);
 *        src/features/search-map/components/LocationPrimerCard.tsx (the shape);
 *        src/features/search-map/screens/HomeFeedScreen.tsx (the slot).
 */

import { X } from 'lucide-react-native';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, opacity, radii, sizes, spacing, typography } from '@/shared/theme';
import { Button } from '@/shared/ui';

export interface SaveYourCarCardProps {
  /** Open the add-a-car flow. */
  onAdd: () => void;
  /** Dismiss for good — the offer is not made again. */
  onDismiss: () => void;
}

export const SaveYourCarCard = memo(function SaveYourCarCard({
  onAdd,
  onDismiss,
}: SaveYourCarCardProps) {
  return (
    <View style={styles.card} testID="garage-nudge-card">
      <View style={styles.headerRow}>
        <Text style={styles.title}>Is your car in here?</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={spacing.sm}
          onPress={onDismiss}
          style={({ pressed }) => [styles.dismiss, pressed && styles.dismissPressed]}
          testID="garage-nudge-dismiss"
        >
          <X size={sizes.iconSm} color={colors.textSecondary} />
        </Pressable>
      </View>
      {/* The value, in the terms that matter: what it costs now vs what it saves
          on the worst day. No urgency, no scare tactics — they came here to
          browse. */}
      <Text style={styles.body}>
        Save your car in about a minute, and if it&apos;s ever stolen, reporting it takes
        seconds — we&apos;ll already have the details.
      </Text>
      <View style={styles.actions}>
        <Button label="Add your car" fullWidth={false} onPress={onAdd} />
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  dismiss: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    // Pull the target back into the card's padding so the icon still sits on
    // the corner while keeping a full 44pt tap area.
    margin: -(sizes.touchTarget - sizes.iconSm) / 2,
  },
  dismissPressed: {
    opacity: opacity.pressed,
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
