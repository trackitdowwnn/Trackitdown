/**
 * WHAT:  AvatarWithBadge — an Avatar with a small circular chip overlapping
 *        its bottom-right: 'camera' (the edit-photo affordance) or 'trusted'
 *        (the trusted-spotter check on the profile hero).
 * WHY:   The reference rides both affordances ON the photo, not beside it —
 *        Airbnb's edit screen shows a camera chip on the avatar and the
 *        passport overlays its verification shield the same way
 *        (docs/design-refs/profile/REFERENCE_SPEC.md §1b, §3). One component
 *        keeps the geometry identical for both. The chip is decorative here:
 *        meaning is carried by the PARENT's accessibility label ("Change
 *        photo" / "…, trusted spotter"), so screen readers hear one element,
 *        not a stray unlabeled button.
 * LINKS: src/shared/ui/Avatar.tsx (the base circle);
 *        src/features/profile/screens/EditProfileScreen.tsx and
 *        components/ProfileHeroCard.tsx (consumers); docs/DESIGN_SYSTEM.md.
 */

import { BadgeCheck, Camera } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { colors, radii, sizes } from '@/shared/theme';
import { Avatar, type AvatarSize } from '@/shared/ui';

export interface AvatarWithBadgeProps {
  uri?: string | null;
  name?: string;
  size?: AvatarSize;
  /** Which chip rides the photo; omit for a plain avatar. */
  badge?: 'camera' | 'trusted';
  testID?: string;
}

export function AvatarWithBadge({ uri, name, size = 'xl', badge, testID }: AvatarWithBadgeProps) {
  return (
    <View style={styles.wrap} testID={testID}>
      <Avatar uri={uri} name={name} size={size} />
      {badge === 'camera' ? (
        <View style={[styles.chip, styles.cameraChip]} testID="avatar-badge-camera">
          <Camera size={sizes.iconSm} color={colors.textPrimary} />
        </View>
      ) : null}
      {badge === 'trusted' ? (
        <View style={[styles.chip, styles.trustedChip]} testID="avatar-badge-trusted">
          <BadgeCheck size={sizes.iconSm} color={colors.textOnPrimary} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'center',
  },
  chip: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: sizes.circleButtonSm,
    height: sizes.circleButtonSm,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraChip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // The white ring separates the check from any photo underneath — the
  // reference's verification shield carries the same ring.
  trustedChip: {
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.surface,
  },
});
