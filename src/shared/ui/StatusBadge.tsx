/**
 * WHAT:  StatusBadge — a small dot + label pill for a post's non-active
 *        status (Pending, Recovery claimed, Recovered, Cancelled, …). Renders
 *        NOTHING for a plain `active` post, so callers drop it in
 *        unconditionally and a live listing stays calm.
 * WHY:   The status→{label,colour} map and its pill lived inline in
 *        VehicleCard; the post-detail title block needs the same badge, so
 *        it's the one source of truth here. The pill carries its own surface
 *        and dot; POSITIONING is the caller's job (VehicleCard overlays it on
 *        the photo, the detail screen inlines it in the title block).
 * LINKS: src/shared/ui/VehicleCard.tsx (overlay consumer);
 *        src/features/vehicles (detail title block); docs/DOMAIN.md (lifecycle).
 */

import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, sizes, spacing, typography } from '../theme';
import type { PostStatus } from '../types';

/** Badge copy + dot colour per non-active status (active → no badge). */
const STATUS_BADGES: Partial<Record<PostStatus, { label: string; color: string }>> = {
  draft: { label: 'Draft', color: colors.textSecondary },
  pending_verification: { label: 'Pending', color: colors.warning },
  recovery_claimed: { label: 'Recovery claimed', color: colors.warning },
  recovered: { label: 'Recovered', color: colors.success },
  recovered_no_spotter: { label: 'Recovered', color: colors.success },
  cancelled: { label: 'Cancelled', color: colors.textSecondary },
  expired: { label: 'Expired', color: colors.textSecondary },
  rejected: { label: 'Rejected', color: colors.textSecondary },
};

/** The badge's plain label for a status, or null when there's no badge — for
 *  composing an a11y string without rendering the pill. */
export function statusBadgeLabel(status: PostStatus): string | null {
  return STATUS_BADGES[status]?.label ?? null;
}

export interface StatusBadgeProps {
  status: PostStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const badge = STATUS_BADGES[status];
  if (!badge) {
    return null; // active (or anything unmapped) shows no badge
  }
  return (
    <View style={styles.badge}>
      <View style={[styles.dot, { backgroundColor: badge.color }]} />
      <Text style={styles.label}>{badge.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  dot: {
    width: sizes.progressDot,
    height: sizes.progressDot,
    borderRadius: radii.sm,
  },
  label: {
    ...typography.label,
    color: colors.textPrimary,
  },
});
