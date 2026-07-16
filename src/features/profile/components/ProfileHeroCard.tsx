/**
 * WHAT:  ProfileHeroCard — the Profile tab's identity hero: an elevated
 *        passport-style card (radii.xl, soft shadow) with the avatar (96pt,
 *        trusted-spotter check riding its corner), first name, and
 *        member-since in the identity half, and the nonzero reputation
 *        counters as a stacked stat column in the other. The whole card is
 *        one tap target → edit profile (no chevron, like the reference).
 * WHY:   The 2025 reference promotes identity from a settings-style row to
 *        the page's one deliberately-elevated object, with trust stats
 *        living INSIDE the identity card rather than as a second card below
 *        (docs/design-refs/profile/REFERENCE_SPEC.md §1b). Degrade by
 *        omission: an all-zero account renders the identity centred alone —
 *        member-since carries the card, never a column of zeros. First name
 *        only, passport-style (display name stays on the edit screen).
 * LINKS: components/StatColumn.tsx, components/AvatarWithBadge.tsx,
 *        lib/reputation.ts (passportStats, isTrustedSpotter);
 *        screens/ProfileScreen.tsx (consumer); docs/DESIGN_SYSTEM.md.
 */

import { StyleSheet, Pressable, Text, View } from 'react-native';

import { colors, displayFontScaleCap, radii, shadows, spacing, typography } from '@/shared/theme';

import { isTrustedSpotter, memberSinceLabel, passportStats } from '../lib/reputation';
import type { MyProfile } from '../types';
import { AvatarWithBadge } from './AvatarWithBadge';
import { StatColumn } from './StatColumn';

export function ProfileHeroCard({
  profile,
  onPress,
}: {
  profile: MyProfile;
  onPress: () => void;
}) {
  const trusted = isTrustedSpotter(profile.counters);
  const stats = passportStats(profile.counters);

  // The card is ONE a11y element, so its label must carry everything a
  // sighted user reads inside it — the stat rows' own labels get flattened
  // away by the pressable.
  const spokenLabel = [
    profile.firstName,
    trusted ? 'trusted spotter' : null,
    memberSinceLabel(profile.createdAt),
    ...stats.map((stat) => stat.spoken),
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
      {stats.length > 0 ? <StatColumn stats={stats} testID="hero-stats" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The ONE deliberately-elevated object on the profile root (reference §4):
  // the roundest, softest card — everything below it stays flat.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
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
    flex: 1,
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
