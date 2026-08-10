/**
 * WHAT:  PostContextStrip — the thread header's compact car anchor
 *        (thumbnail, make/model, status line) that taps through to the post
 *        detail; plus ClosedThreadBanner, the quiet read-only notice shown
 *        when the post has left 'active'.
 * WHY:   Every conversation is ABOUT a car; the strip keeps that context one
 *        tap away (Airbnb's listing strip pattern). The banner states the
 *        closure calmly — recovered is good news, never alarm styling — and
 *        the input's removal (screen's job) makes read-only self-evident.
 *        The strip draws NO background and NO rule of its own (2026-08-05):
 *        the thread screen groups it with the person header into one surface,
 *        and a strip carrying its own slab made the two read as unrelated.
 * LINKS: src/features/chat/screens/ChatThreadScreen.tsx (consumer);
 *        docs/DOMAIN.md (Chat: read-only after close).
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radii, sizes, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import type { PostStatus } from '@/shared/types';
import { AppImage, StatusBadge, statusBadgeLabel } from '@/shared/ui';

import type { InboxThread } from '../types';

export interface PostContextStripProps {
  thread: InboxThread;
  onPress: (postId: string) => void;
}

export function PostContextStrip({ thread, onPress }: PostContextStripProps) {
  const styles = useThemedStyles(makeStyles);
  const car = [thread.post.colour, thread.post.make, thread.post.model]
    .filter(Boolean)
    .join(' ');
  // The shared StatusBadge (dot + label) for every closed/recovered state, so
  // chat says it exactly like the feed and post detail do. It renders nothing
  // for a plain active post — where chat has its own, better second line:
  // "Still missing" is the reason this conversation exists.
  const status: PostStatus = thread.post.status;
  const badgeLabel = statusBadgeLabel(status);
  return (
    <Pressable
      onPress={() => onPress(thread.postId)}
      accessibilityRole="button"
      accessibilityLabel={`View post: ${car}. ${badgeLabel ?? 'Still missing'}.`}
      style={({ pressed }) => [styles.strip, pressed && styles.stripPressed]}
      testID="post-context-strip"
    >
      {thread.post.coverPhotoUrl ? (
        <AppImage uri={thread.post.coverPhotoUrl} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]} />
      )}
      <View style={styles.stripBody}>
        <Text style={styles.car} numberOfLines={1}>
          {car}
        </Text>
        {badgeLabel ? (
          <View style={styles.badgeRow}>
            <StatusBadge status={status} />
          </View>
        ) : (
          <Text style={styles.status}>Still missing</Text>
        )}
      </View>
      <Text style={styles.viewLink}>View</Text>
    </Pressable>
  );
}

export function ClosedThreadBanner({ status }: { status: string }) {
  const styles = useThemedStyles(makeStyles);
  const recovered = status === 'recovered' || status === 'recovered_no_spotter';
  return (
    <View style={styles.banner} accessibilityLiveRegion="polite" testID="closed-thread-banner">
      <Text style={styles.bannerText}>
        {recovered
          ? 'This car was recovered — the conversation is closed, but you can still read it.'
          : 'This post has closed — the conversation is read-only now.'}
      </Text>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  // No surface or rule of its own: the thread screen wraps this and the person
  // header in ONE block that owns both, so the two stopped reading as separate
  // slabs. Transparent, so the strip inherits whatever it is placed on.
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  stripPressed: {
    backgroundColor: c.surfaceSubtle,
  },
  thumb: {
    width: sizes.avatarMd,
    height: sizes.avatarMd,
    borderRadius: radii.sm,
  },
  thumbEmpty: {
    backgroundColor: c.surfaceSubtle,
  },
  stripBody: {
    flex: 1,
    gap: spacing.xs,
  },
  car: {
    ...typography.label,
    color: c.textPrimary,
  },
  status: {
    ...typography.caption,
    color: c.textSecondary,
  },
  badgeRow: {
    flexDirection: 'row',
  },
  // Underline = tappable (DESIGN_SYSTEM Typography): the strip is one big
  // target, and this names what tapping it does.
  viewLink: {
    ...typography.caption,
    color: c.textPrimary,
    textDecorationLine: 'underline',
  },
  banner: {
    backgroundColor: c.surfaceSubtle,
    borderRadius: radii.md,
    marginHorizontal: spacing.xl,
    marginVertical: spacing.sm,
    padding: spacing.lg,
  },
  bannerText: {
    ...typography.caption,
    color: c.textSecondary,
    textAlign: 'center',
  },
});
