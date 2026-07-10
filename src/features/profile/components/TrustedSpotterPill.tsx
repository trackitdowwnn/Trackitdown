/**
 * WHAT:  TrustedSpotterPill — the app's headline trust marker: a small sage
 *        pill ("Trusted spotter") shown beside a user's identity once the
 *        DOMAIN.md criteria are met.
 * WHY:   Trust signals belong next to the name, early in the hierarchy (the
 *        Airbnb Superhost placement) — both on your own profile and on the
 *        PublicProfileSheet owners see, because owners are who trust markers
 *        exist for. The status derives from the two server-maintained
 *        counters (docs/DOMAIN.md: ≥1 recovery credited AND ≥5 helpful
 *        sightings), so it is as forgery-proof as they are and adds nothing
 *        beyond the existing privacy boundary.
 * LINKS: src/features/profile/lib/reputation.ts (isTrustedSpotter);
 *        docs/DOMAIN.md (Reputation v1); docs/DESIGN_SYSTEM.md.
 */

import { BadgeCheck } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/shared/theme';

export function TrustedSpotterPill() {
  return (
    <View
      style={styles.pill}
      accessible
      accessibilityLabel="Trusted spotter"
      testID="trusted-spotter"
    >
      <BadgeCheck size={typography.caption.fontSize + spacing.xs} color={colors.primary} />
      {/* textPrimary, not primary: sage caption text on surfaceSubtle sits
          just under AA — the icon carries the sage identity instead. */}
      <Text style={styles.text} maxFontSizeMultiplier={1.3}>
        Trusted spotter
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  text: {
    ...typography.caption,
    color: colors.textPrimary,
  },
});
