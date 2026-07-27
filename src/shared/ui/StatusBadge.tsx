/**
 * WHAT:  StatusBadge — a small dot + label pill for a post's non-active
 *        status (Pending, Recovery claimed, Recovered, Cancelled, …). Renders
 *        NOTHING for a plain `active` post by default, so callers drop it in
 *        unconditionally and a live listing stays calm in PUBLIC surfaces.
 *        Owner-context callers opt in (showLiveWhenActive) to a green "Live"
 *        badge so an owner can see which of their own posts are live.
 * WHY:   The status→{label,colour} map and its pill lived inline in
 *        VehicleCard; the post-detail title block needs the same badge, so
 *        it's the one source of truth here. The pill carries its own surface
 *        and dot; POSITIONING is the caller's job (VehicleCard overlays it on
 *        the photo, the detail screen inlines it in the title block). The
 *        Live badge is owner-only (opt-in) so public feed/map cards stay calm.
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

/** The owner-only "Live" badge for an active post (opt-in via
 *  showLiveWhenActive). Green, mirroring the recovered-success dot. */
const LIVE_BADGE = { label: 'Live', color: colors.success };

/** Resolve the badge for a status, honouring the owner-only Live opt-in.
 *  Returns null when there's no badge (a public active post). */
function resolveBadge(
  status: PostStatus,
  showLiveWhenActive: boolean,
): { label: string; color: string } | null {
  if (status === 'active') {
    return showLiveWhenActive ? LIVE_BADGE : null;
  }
  return STATUS_BADGES[status] ?? null;
}

/** The badge's plain label for a status, or null when there's no badge — for
 *  composing an a11y string without rendering the pill. Pass showLiveWhenActive
 *  in owner contexts to get "Live" for an active post. */
export function statusBadgeLabel(
  status: PostStatus,
  showLiveWhenActive = false,
): string | null {
  return resolveBadge(status, showLiveWhenActive)?.label ?? null;
}

export interface StatusBadgeProps {
  status: PostStatus;
  /** Owner-only: render a green "Live" badge for an active post. Public
   *  callers leave this false so a live listing shows no badge. */
  showLiveWhenActive?: boolean;
}

export function StatusBadge({ status, showLiveWhenActive = false }: StatusBadgeProps) {
  const badge = resolveBadge(status, showLiveWhenActive);
  if (!badge) {
    return null; // public active (or anything unmapped) shows no badge
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
