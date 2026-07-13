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
import { colors, spacing, typography } from '@/shared/theme';
import { Button, StatusBadge } from '@/shared/ui';

import type { PostDetail } from '../types';

export interface PostBottomBarProps {
  post: PostDetail;
  /** Spotter action — report a sighting. */
  onSeen: () => void;
  /** Owner action — manage the post. */
  onManage: () => void;
}

export function PostBottomBar({ post, onSeen, onManage }: PostBottomBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.md }]}>
      <View style={styles.left}>
        {post.isOwner ? (
          <>
            <Text numberOfLines={1} style={styles.caption}>
              Your listing
            </Text>
            <StatusBadge status={post.status} />
          </>
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
      {post.isOwner ? (
        <Button label="Manage post" variant="secondary" fullWidth={false} onPress={onManage} />
      ) : (
        <Button label="I've seen this car" fullWidth={false} onPress={onSeen} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  left: {
    gap: spacing.xs,
    // Yield to the action button rather than push it off a narrow screen.
    flexShrink: 1,
  },
  bounty: {
    ...typography.heading,
    color: colors.accentText,
  },
  caption: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
