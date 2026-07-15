/**
 * WHAT:  PostContextStrip — the thread header's compact car anchor
 *        (thumbnail, make/model, status line) that taps through to the post
 *        detail; plus ClosedThreadBanner, the quiet read-only notice shown
 *        when the post has left 'active'.
 * WHY:   Every conversation is ABOUT a car; the strip keeps that context one
 *        tap away (Airbnb's listing strip pattern). The banner states the
 *        closure calmly — recovered is good news, never alarm styling — and
 *        the input's removal (screen's job) makes read-only self-evident.
 * LINKS: src/features/chat/screens/ChatThreadScreen.tsx (consumer);
 *        docs/DOMAIN.md (Chat: read-only after close).
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import { AppImage } from '@/shared/ui';

import type { InboxThread } from '../types';

export interface PostContextStripProps {
  thread: InboxThread;
  onPress: (postId: string) => void;
}

/** Status → the strip's quiet second line. */
function statusLine(status: string): string {
  if (status === 'active') return 'Still missing';
  if (status === 'recovered' || status === 'recovered_no_spotter') return 'Recovered';
  return 'Post closed';
}

export function PostContextStrip({ thread, onPress }: PostContextStripProps) {
  const car = [thread.post.colour, thread.post.make, thread.post.model]
    .filter(Boolean)
    .join(' ');
  return (
    <Pressable
      onPress={() => onPress(thread.postId)}
      accessibilityRole="button"
      accessibilityLabel={`View post: ${car}. ${statusLine(thread.post.status)}.`}
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
        <Text style={styles.status}>{statusLine(thread.post.status)}</Text>
      </View>
    </Pressable>
  );
}

export function ClosedThreadBanner({ status }: { status: string }) {
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

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  stripPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  thumb: {
    width: sizes.avatarMd,
    height: sizes.avatarMd,
    borderRadius: radii.sm,
  },
  thumbEmpty: {
    backgroundColor: colors.surfaceSubtle,
  },
  stripBody: {
    flex: 1,
    gap: spacing.xs,
  },
  car: {
    ...typography.label,
    color: colors.textPrimary,
  },
  status: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  banner: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.md,
    marginHorizontal: spacing.xl,
    marginVertical: spacing.sm,
    padding: spacing.lg,
  },
  bannerText: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
