/**
 * WHAT:  OwnerCard — the Airbnb host-passport card translated to the owner:
 *        an elevated white card with a centred avatar + first name ("Verified
 *        owner" shield when de-identified) beside a stat column (time on
 *        Trackitdown; sightings on this post) split by hairline dividers.
 * WHY:   The reference makes the host the page's only elevated card — human
 *        credentials as the final reassurance before commitment. Ours carries
 *        the calm-human register (design session 2026-07-23): the warmth is in
 *        the name and avatar, the copy stays factual — an owner is a theft
 *        victim, never a vendor. Identity rules (SAFETY, DOMAIN.md "Owner
 *        identity on a post"): first name only for signed-in viewers,
 *        de-identified "Verified owner" shield otherwise, initial-letter
 *        avatar only (a photo path would leak owner_id), member-since always
 *        present. Never a surname, owner_id, or contact path.
 * LINKS: src/features/vehicles/components/PostDetailBody.tsx;
 *        docs/design-refs/post-detail/REFERENCE_SPEC.md;
 *        docs/DOMAIN.md ("Owner identity on a post").
 */

import { Feather } from '@expo/vector-icons';
import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, shadows, sizes, spacing, typography } from '@/shared/theme';
import { Avatar } from '@/shared/ui';

import type { OwnerSummary } from '../types';

export interface OwnerCardProps {
  owner: OwnerSummary;
  /** This post's aggregate sighting count (never individual sightings). */
  sightingCount: number;
}

/** Whole months between memberSince and now, floored, minimum 1. */
function monthsSince(iso: string): number {
  const since = new Date(iso);
  const now = new Date();
  const months =
    (now.getFullYear() - since.getFullYear()) * 12 + (now.getMonth() - since.getMonth());
  return Math.max(1, months);
}

export function OwnerCard({ owner, sightingCount }: OwnerCardProps) {
  const identified = Boolean(owner.firstName);
  const months = monthsSince(owner.memberSince);
  const years = Math.floor(months / 12);

  // Years once the account is old enough — "26 months" reads like a glitch.
  const tenure =
    years >= 2
      ? { value: String(years), label: years === 1 ? 'Year on Trackitdown' : 'Years on Trackitdown' }
      : { value: String(months), label: months === 1 ? 'Month on Trackitdown' : 'Months on Trackitdown' };

  const stats = [
    tenure,
    {
      value: String(sightingCount),
      label: sightingCount === 1 ? 'Sighting on this post' : 'Sightings on this post',
    },
  ];

  return (
    <View
      style={styles.card}
      accessible
      // Lowercase only the label's leading word — the brand name keeps its case.
      accessibilityLabel={`${identified ? owner.firstName : 'Verified owner'}, ${tenure.value} ${tenure.label.charAt(0).toLowerCase()}${tenure.label.slice(1)}, ${sightingCount} ${sightingCount === 1 ? 'sighting' : 'sightings'} on this post`}
    >
      <View style={styles.identity}>
        {identified ? (
          <Avatar name={owner.firstName} size="xl" />
        ) : (
          <View style={styles.shieldCircle}>
            {/* `success`, not `primary`: verification is a passive status
                marker, and orange is reserved for actions (ADR-0005). */}
            <Feather name="shield" size={sizes.icon} color={colors.success} />
          </View>
        )}
        <Text style={styles.name} numberOfLines={1}>
          {identified ? owner.firstName : 'Verified owner'}
        </Text>
        <Text style={styles.role}>Owner</Text>
      </View>

      <View style={styles.stats}>
        {stats.map((stat, index) => (
          <Fragment key={stat.label}>
            {index > 0 ? <View style={styles.statDivider} /> : null}
            <View style={styles.stat}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          </Fragment>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The page's one deliberately-elevated object (like the profile hero card):
  // surface, xl radius, the sanctioned soft shadow.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
    ...shadows.soft,
  },
  identity: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.sm,
  },
  shieldCircle: {
    width: sizes.avatarXl,
    height: sizes.avatarXl,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The passport's oversized signature type — title scale (the largest type
  // on this page; the bounty reads at heading scale in the stat band).
  name: {
    ...typography.title,
    color: colors.textPrimary,
  },
  role: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  // Equal halves with the identity column — long stat labels ("Sightings on
  // this post") get real width instead of a fixed proportion.
  stats: {
    flex: 1,
    gap: spacing.md,
  },
  stat: {
    gap: spacing.xs,
  },
  statValue: {
    ...typography.heading,
    color: colors.textPrimary,
    // Android: keep the bold numeral optically centred over its label.
    includeFontPadding: false,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  statDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
});
