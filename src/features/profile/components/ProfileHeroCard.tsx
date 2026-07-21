/**
 * WHAT:  ProfileHeroCard — the Profile tab's identity hero: an elevated
 *        passport-style card (radii.xl, soft shadow) with the avatar (96pt,
 *        trusted-spotter check riding its corner), first name, and
 *        member-since centred. The whole card is one tap target → edit
 *        profile (no chevron, like the reference).
 * WHY:   The 2025 reference promotes identity from a settings-style row to
 *        the page's one deliberately-elevated object (docs/design-refs/
 *        profile/REFERENCE_SPEC.md §1b). The card is identity ONLY — the
 *        reputation counters live with the rest of the narrative on the
 *        pushed spotter-story page, keeping the hero calm and uncrowded.
 *        First name only, passport-style (display name stays on the edit
 *        screen).
 * LINKS: components/AvatarWithBadge.tsx, lib/reputation.ts
 *        (isTrustedSpotter); screens/ProfileScreen.tsx (consumer);
 *        screens/SpotterStoryScreen.tsx (the stats' home);
 *        docs/DESIGN_SYSTEM.md.
 */

import { StyleSheet, Pressable, Text, View } from 'react-native';

import { colors, displayFontScaleCap, radii, shadows, spacing, typography } from '@/shared/theme';

import { isTrustedSpotter, memberSinceLabel } from '../lib/reputation';
import type { MyProfile } from '../types';
import { AvatarWithBadge } from './AvatarWithBadge';

export function ProfileHeroCard({
  profile,
  onPress,
}: {
  profile: MyProfile;
  onPress: () => void;
}) {
  const trusted = isTrustedSpotter(profile.counters);

  // The card is ONE a11y element, so its label must carry everything a
  // sighted user reads inside it.
  const spokenLabel = [
    profile.firstName,
    trusted ? 'trusted spotter' : null,
    memberSinceLabel(profile.createdAt),
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${spokenLabel}. Edit profile`}
      accessibilityHint="Change your name or photo"
      testID="profile-header"
    >
      <View style={styles.identity}>
        <AvatarWithBadge
          uri={profile.avatarUrl}
          name={profile.firstName}
          size="xl"
          badge={trusted ? 'trusted' : undefined}
        />
        <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={displayFontScaleCap}>
          {profile.firstName}
        </Text>
        <Text style={styles.since} maxFontSizeMultiplier={displayFontScaleCap}>
          {memberSinceLabel(profile.createdAt)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The ONE deliberately-elevated object on the profile root (reference §4):
  // the roundest, softest card — everything below it stays flat.
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl,
    ...shadows.soft,
  },
  // The page's biggest tap target gives the same quiet feedback as ListRow.
  cardPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  identity: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  name: {
    ...typography.title,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  since: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
