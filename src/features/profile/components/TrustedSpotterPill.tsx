/**
 * WHAT:  TrustedSpotterPill — the app's headline trust marker: a small quiet
 *        pill ("Trusted spotter") shown beside a user's identity once the
 *        DOMAIN.md criteria are met.
 * WHY:   Trust signals belong next to the name, early in the hierarchy (the
 *        Airbnb Superhost role-line placement) — on the PublicProfileSheet
 *        owners see, because owners are who the explanatory wording exists
 *        for; your OWN profile marks the same status as the avatar-corner
 *        check (AvatarWithBadge). The status derives from the two
 *        server-maintained counters (docs/DOMAIN.md: ≥1 recovery credited
 *        AND ≥5 helpful sightings), so it is as forgery-proof as they are
 *        and adds nothing beyond the existing privacy boundary.
 * LINKS: src/features/profile/lib/reputation.ts (isTrustedSpotter);
 *        docs/DOMAIN.md (Reputation v1); docs/DESIGN_SYSTEM.md.
 */

import { BadgeCheck } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import {
  displayFontScaleCap,
  radii,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';

export function TrustedSpotterPill() {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();

  return (
    <View
      style={styles.pill}
      accessible
      accessibilityLabel="Trusted spotter"
      testID="trusted-spotter"
    >
      <BadgeCheck size={typography.caption.fontSize + spacing.xs} color={palette.primary} />
      {/* textPrimary for the caption ink; the icon carries `primary`. In the
          monochrome scheme both are near-black, so this is now an intent
          distinction (label ink vs brand mark), not a contrast one. */}
      <Text style={styles.text} maxFontSizeMultiplier={displayFontScaleCap}>
        Trusted spotter
      </Text>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: c.surfaceSubtle,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  text: {
    ...typography.caption,
    color: c.textPrimary,
  },
});
