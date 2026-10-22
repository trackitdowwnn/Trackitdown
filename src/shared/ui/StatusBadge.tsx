/**
 * WHAT:  StatusBadge — a small dot + label pill for a post's non-active
 *        status (Pending, Recovery claimed, Recovered, Cancelled, …). Renders
 *        NOTHING for a plain `active` post by default, so callers drop it in
 *        unconditionally and a live listing stays calm in PUBLIC surfaces.
 *        Owner-context callers opt in (showLiveWhenActive) to a green "Live"
 *        badge so an owner can see which of their own posts are live, and —
 *        straight after paying — `goingLive` puts "Going live" (a small
 *        spinner in the dot's place; still under Reduce Motion) or "Going
 *        live soon" over Draft until it is (owner, 2026-10-22).
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

import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { radii, sizes, spacing, typography, usePalette, useThemedStyles, type Palette } from '../theme';
import type { PostStatus } from '../types';

/**
 * The dot's MEANING, not its hex. The table below is read by
 * `statusBadgeLabel`, which is exported, hook-free, and called from render-less
 * places (VehicleCard's a11y string, chat's ThreadHeader) — so it cannot reach a
 * palette. Storing a tone keeps that function pure and defers the one thing
 * that has to be deferred (the colour) to `toneColor` inside the component.
 */
export type BadgeTone = 'neutral' | 'warning' | 'success' | 'primary';

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
// 'primary': an answer the owner gave (a sighting confirmed) — ink, not the
// success green, which is reserved for payout moments.
const toneColor = (c: Palette, tone: BadgeTone): string =>
  tone === 'warning'
    ? c.warning
    : tone === 'success'
      ? c.success
      : tone === 'primary'
        ? c.primary
        : c.textSecondary;

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

/** A just-paid listing the server hasn't made live yet (owner, 2026-10-22: no
 *  confirmation page — the listing, with this where "Live" will be).
 *  'confirming': the first ~12s of looks, a spinner; 'slow': still looking,
 *  quietly, and it says so. */
export type GoingLivePhase = 'confirming' | 'slow';

export interface StatusBadgeProps {
  status: PostStatus;
  /** Owner-only: render a green "Live" badge for an active post. Public
   *  callers leave this false so a live listing shows no badge. */
  showLiveWhenActive?: boolean;
  /** Owner-only, straight after paying: "Going live" (with a spinner) or
   *  "Going live soon" in place of the post's own badge until it is active. */
  goingLive?: GoingLivePhase | null;
}

export function StatusBadge({
  status,
  showLiveWhenActive = false,
  goingLive = null,
}: StatusBadgeProps) {
  // Only over Draft — the one status a paid listing has before it is live. A
  // real status (rejected, cancelled, …) is never hidden behind it. Neutral,
  // not green: green is earned when it IS live (UI review, 2026-10-22).
  if (goingLive && status === 'draft') {
    return goingLive === 'confirming' ? (
      <StatusPill label="Going live" tone="neutral" busy testID="status-going-live" />
    ) : (
      <StatusPill label="Going live soon" tone="neutral" testID="status-going-live-soon" />
    );
  }
  const badge = resolveBadge(status, showLiveWhenActive);
  if (!badge) {
    return null; // public active (or anything unmapped) shows no badge
  }
  return <StatusPill label={badge.label} tone={badge.tone} />;
}

export interface StatusPillProps {
  label: string;
  tone: BadgeTone;
  /** A small spinner where the dot goes — something is being confirmed.
   *  With Reduce Motion on, the plain dot instead (the label says it). */
  busy?: boolean;
  testID?: string;
}

/**
 * The pill itself, for statuses that are NOT a post's.
 *
 * ⚠️ EXTRACTED RATHER THAN COPIED (2026-08-26). PayoutsScreen needs the same
 * dot-and-label anatomy for a Connect account's state — not set up, action
 * needed, being checked, ready — and `StatusBadge` cannot serve it because its
 * whole API is a `PostStatus` and a lookup table of post lifecycle labels.
 * Payments is the second feature needing this shape, which is ARCHITECTURE.md's
 * bar for shared/.
 *
 * Additive on purpose: `StatusBadge` now renders this and its five existing
 * consumers see no change at all, which is what keeps a shared-component edit
 * on a release day cheap to review.
 */
export function StatusPill({ label, tone, busy = false, testID }: StatusPillProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const reduceMotion = useReducedMotion();

  return (
    <View style={styles.badge} testID={testID}>
      {busy && !reduceMotion ? (
        // The label's line tall (iconSm = 18), so the pill keeps its height. A
        // number is Android-only; iOS takes 'small' inside the same box.
        <ActivityIndicator
          size={Platform.OS === 'android' ? sizes.iconSm : 'small'}
          color={toneColor(palette, tone)}
          style={styles.spinner}
          importantForAccessibility="no"
          accessibilityElementsHidden
          testID={testID ? `${testID}-spinner` : undefined}
        />
      ) : (
        <View style={[styles.dot, { backgroundColor: toneColor(palette, tone) }]} />
      )}
      <Text style={styles.label}>{label}</Text>
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
    spinner: {
      width: sizes.iconSm,
      height: sizes.iconSm,
    },
    label: {
      ...typography.label,
      color: c.textPrimary,
    },
  });
