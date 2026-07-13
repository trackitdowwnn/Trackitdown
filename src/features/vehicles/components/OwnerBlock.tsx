/**
 * WHAT:  OwnerBlock — the "meet the owner" identity row: avatar + "Posted by
 *        <first name>" + member-since for SIGNED-IN viewers; a de-identified
 *        "Verified owner" (shield icon, member-since only) for anonymous ones.
 * WHY:   The owner is a theft VICTIM, so their name and face are shown only to
 *        signed-in viewers (SAFETY, docs/DOMAIN.md "Owner identity on a post").
 *        Whether name/avatar are present is decided server-side in
 *        get_post_detail; this component just renders whichever it got — it
 *        never has a surname, owner_id, or contact path to leak.
 * LINKS: src/features/vehicles/components/PostDetailBody.tsx;
 *        src/shared/ui/Avatar.tsx; docs/DOMAIN.md.
 */

import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { formatMonthYear } from '@/shared/lib';
import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import { Avatar } from '@/shared/ui';

import type { OwnerSummary } from '../types';

export interface OwnerBlockProps {
  owner: OwnerSummary;
}

export function OwnerBlock({ owner }: OwnerBlockProps) {
  const identified = Boolean(owner.firstName);
  const title = identified ? `Posted by ${owner.firstName}` : 'Verified owner';

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${title}, member since ${formatMonthYear(owner.memberSince)}`}
    >
      {identified ? (
        // Initial-letter avatar only — no photo (a uid-bearing avatar path
        // would leak owner_id; see the 20260713170000 migration).
        <Avatar name={owner.firstName} size="md" />
      ) : (
        <View style={styles.deidentified}>
          <Feather name="shield" size={sizes.icon} color={colors.primary} />
        </View>
      )}
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.meta}>Member since {formatMonthYear(owner.memberSince)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  deidentified: {
    width: sizes.avatarMd,
    height: sizes.avatarMd,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
