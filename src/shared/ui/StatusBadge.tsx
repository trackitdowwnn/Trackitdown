/**
 * WHAT:  StatusBadge — a small dot + label pill for a post's non-active
 *        status (Pending, Recovery claimed, Recovered, Cancelled, …). Renders
 *        NOTHING for a plain `active` post by default, so callers drop it in
 *        unconditionally and a live listing stays calm in PUBLIC surfaces.
 *        Owner-context callers opt in (showLiveWhenActive) to a green "Live"
 *        badge so an owner can see which of their own posts are live.
 * WHY:   The status→{label,tone} map and its pill lived inline in
 *        VehicleCard; the post-detail title block needs the same badge, so
 *        it's the one source of truth here. The map stores a semantic TONE
 *        rather than a hex so `statusBadgeLabel` can stay a pure, hook-free
 *        export; the tone resolves to a colour inside the component. The pill carries its own surface
 *        and dot; POSITIONING is the caller's job (VehicleCard overlays it on
 *        the photo, the detail screen inlines it in the title block). The
 *        Live badge is owner-only (opt-in) so public feed/map cards stay calm.
 * LINKS: src/shared/ui/VehicleCard.tsx (overlay consumer);
 *        src/features/vehicles (detail title block); docs/DOMAIN.md (lifecycle).
 */

import { StyleSheet, Text, View } from 'react-native';

import { radii, sizes, spacing, typography, usePalette, useThemedStyles, type Palette } from '../theme';
import type { PostStatus } from '../types';

/**
 * The dot's MEANING, not its hex. The table below is read by
 * `statusBadgeLabel`, which is exported, hook-free, and called from render-less
 * places (VehicleCard's a11y string, PostContextStrip) — so it cannot reach a
 * palette. Storing a tone keeps that function pure and defers the one thing
 * that has to be deferred (the colour) to `toneColor` inside the component.
 */
type BadgeTone = 'neutral' | 'warning' | 'success';

/** Badge copy + dot tone per non-active status (active → no badge). */
const STATUS_BADGES: Partial<Record<PostStatus, { label: string; tone: BadgeTone }>> = {
  draft: { label: 'Draft', tone: 'neutral' },
  pending_verification: { label: 'Pending', tone: 'warning' },
  recovery_claimed: { label: 'Recovery claimed', tone: 'warning' },
  recovered: { label: 'Recovered', tone: 'success' },
  recovered_no_spotter: { label: 'Recovered', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
  rejected: { label: 'Rejected', tone: 'neutral' },
};

/** The owner-only "Live" badge for an active post (opt-in via
 *  showLiveWhenActive). Green, mirroring the recovered-success dot. */
const LIVE_BADGE = { label: 'Live', tone: 'success' } as const;

/** Tone → dot hex, resolved per-render against the palette in effect. */
const toneColor = (c: Palette, tone: BadgeTone): string =>
  tone === 'warning' ? c.warning : tone === 'success' ? c.success : c.textSecondary;

/** Resolve the badge for a status, honouring the owner-only Live opt-in.
 *  Returns null when there's no badge (a public active post). */
function resolveBadge(
  status: PostStatus,
  showLiveWhenActive: boolean,
): { label: string; tone: BadgeTone } | null {
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
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();

  const badge = resolveBadge(status, showLiveWhenActive);
  if (!badge) {
    return null; // public active (or anything unmapped) shows no badge
  }
  return (
    <View style={styles.badge}>
      <View style={[styles.dot, { backgroundColor: toneColor(palette, badge.tone) }]} />
      <Text style={styles.label}>{badge.label}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: spacing.xs,
      backgroundColor: c.surface,
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
      color: c.textPrimary,
    },
  });
