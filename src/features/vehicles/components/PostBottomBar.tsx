/**
 * WHAT:  PostBottomBar — the always-visible sticky bar at the foot of the
 *        detail screen. SPOTTER: bounty + "reward" left, primary "I've seen
 *        this car" right. OWNER (their own post): a "Your listing" summary +
 *        status left, secondary "Manage post" right.
 * WHY:   The Airbnb move — the primary action never scrolls away. Mode is the
 *        server-computed is_owner, decided once; a spotter is never shown the
 *        owner action and vice versa.
 * LINKS: src/features/vehicles/screens/PostDetailScreen.tsx;
 *        src/shared/ui (Button, StatusBadge); src/shared/lib (formatPounds).
 */

import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatPounds } from '@/shared/lib';
import { spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { Button, NO_BOUNTY_LABEL, StatusBadge } from '@/shared/ui';

import type { PostDetail } from '../types';

export interface PostBottomBarProps {
  post: PostDetail;
  /** Spotter action — report a sighting. */
  onSeen: () => void;
  /** Owner action — manage the post. */
  onManage: () => void;
}

export function PostBottomBar({ post, onSeen, onManage }: PostBottomBarProps) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.md }]}>
      <View style={styles.left}>
        {post.isOwner ? (
          <>
            <Text numberOfLines={1} style={styles.caption}>
              Your listing
            </Text>
            {/* Owner's own bar → a live post reads "Live" (green), not blank. */}
            <StatusBadge status={post.status} showLiveWhenActive />
          </>
        ) : (
          // Inline, not stacked (product call 2026-08-09): "£450 reward" is one
          // phrase and reads as one. Baseline-aligned so the caption sits on the
          // amount's baseline rather than its box centre — with a 24pt number
          // beside 12pt text, centring leaves the word visibly high.
          <View style={styles.rewardRow}>
            {post.bountyPence === null ? (
              // A no-reward listing (ADR-0014) has no amount to lead with, so the
              // display-size number would be a hole. It collapses to a single
              // line — but at `label`, not `caption`: this is the one fact a
              // spotter reads before tapping the CTA, and dropping it to the
              // smallest tier in the app would bury it. Matches BountyTag's `md`,
              // so the bar and the cards speak with one voice.
              <Text numberOfLines={1} style={styles.rewardNone}>
                {NO_BOUNTY_LABEL}
              </Text>
            ) : (
              <>
                {/* Money never truncates — the caption yields first, not the amount. */}
                <Text style={styles.bounty}>{formatPounds(post.bountyPence)}</Text>
                <Text numberOfLines={1} style={styles.caption}>
                  reward
                </Text>
              </>
            )}
          </View>
        )}
      </View>
      {post.isOwner ? (
        <Button label="Manage post" variant="secondary" fullWidth={false} onPress={onManage} />
      ) : (
        <Button label="I've seen this car" fullWidth={false} onPress={onSeen} />
      )}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: c.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  left: {
    gap: spacing.xs,
    // Yield to the action button rather than push it off a narrow screen.
    flexShrink: 1,
  },
  rewardRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
    flexShrink: 1,
    // Holds the bar's chrome identical whether the listing shows a
    // display-size amount or the single "No reward" line, so the sticky bar
    // does not change height between one post and the next.
    minHeight: typography.heading.lineHeight,
  },
  // The no-reward twin of `bounty` below: same tier family, stepped back to
  // secondary ink because the accent is reserved for value moments and this is
  // the absence of one (DESIGN_SYSTEM colour rules; matches BountyTag).
  rewardNone: {
    ...typography.label,
    color: c.textSecondary,
  },
  bounty: {
    ...typography.heading,
    color: c.accentText,
  },
  caption: {
    ...typography.caption,
    color: c.textSecondary,
  },
});
