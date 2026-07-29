/**
 * WHAT:  ThreadRow — one inbox conversation: Avatar with the car's thumbnail
 *        badged over its corner, first name (bold when unread), the
 *        anchoring context line ("About your Blue BMW" + the owner's own
 *        PlateChip / "Your sighting · Blue BMW"), a one-line last-message
 *        preview, relative time, and the unread dot.
 * WHY:   Airbnb-style rows anchor a conversation to the THING it's about —
 *        their avatar wears the listing photo; ours wears the car. The badge
 *        makes the anchor visual before the context line is even read, which
 *        is what lets a mixed inbox (my cars + my sightings) scan at a
 *        glance. PRIVACY: the plate renders ONLY on owner rows (their own
 *        plate; inboxModel pins the rule); the badge is the POST's public
 *        cover photo — already visible to both parties — never anything of
 *        the other person's.
 * LINKS: src/features/chat/lib/inboxModel.ts (context/unread maths);
 *        src/shared/ui (Avatar, PlateChip, AppImage); docs/DESIGN_SYSTEM.md.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { timeAgo } from '@/shared/lib/timeAgo';
import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import { AppImage, Avatar, PlateChip } from '@/shared/ui';

import { contextLine, isUnread, previewText } from '../lib/inboxModel';
import type { InboxThread } from '../types';

/** Drawn size of the car badge over the avatar's corner. Small enough that
 *  the person stays the subject; the 2px surface ring separates it from the
 *  avatar beneath on both light rows and pressed rows. */
const CAR_BADGE_SIZE = 24;

export interface ThreadRowProps {
  thread: InboxThread;
  onPress: (thread: InboxThread) => void;
}

export function ThreadRow({ thread, onPress }: ThreadRowProps) {
  const unread = isUnread(thread);
  const context = contextLine(thread);
  const when = timeAgo(thread.lastMessageAt);

  return (
    <Pressable
      onPress={() => onPress(thread)}
      accessibilityRole="button"
      accessibilityLabel={
        `Conversation with ${thread.other.firstName}. ${context.prefix}. ` +
        `${previewText(thread)}. ${when}.` +
        (unread ? ` ${thread.unreadCount} unread.` : '')
      }
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID={`thread-row-${thread.threadId}`}
    >
      {/* Initial-letter avatar only: the other party's avatar path embeds
          their uid, so it's not returned to the client (see types.ts). The
          car's cover photo badges its corner — the Airbnb context-anchor,
          made visual. Both are decorative here; the row's label carries the
          same information. */}
      <View style={styles.avatarStack}>
        <Avatar name={thread.other.firstName} />
        {thread.post.coverPhotoUrl ? (
          <View style={styles.carBadge} testID={`thread-car-badge-${thread.threadId}`}>
            <AppImage
              uri={thread.post.coverPhotoUrl}
              recyclingKey={thread.threadId}
              style={styles.carBadgeImage}
            />
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        <View style={styles.topLine}>
          <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>
            {thread.other.firstName}
          </Text>
          <Text style={styles.time}>{when}</Text>
        </View>
        <View style={styles.contextLine}>
          <Text style={styles.context} numberOfLines={1}>
            {context.prefix}
          </Text>
          {context.plate ? <PlateChip plate={context.plate} /> : null}
        </View>
        <Text
          style={[styles.preview, unread && styles.previewUnread]}
          numberOfLines={1}
          testID={`thread-preview-${thread.threadId}`}
        >
          {previewText(thread)}
        </Text>
      </View>
      {unread ? <View style={styles.unreadDot} testID={`thread-unread-${thread.threadId}`} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  avatarStack: {
    // Room for the badge to overhang the avatar's corner without clipping.
    position: 'relative',
  },
  carBadge: {
    position: 'absolute',
    // Overlap the bottom-right corner, Airbnb-style.
    right: -spacing.xs,
    bottom: -spacing.xs,
    width: CAR_BADGE_SIZE,
    height: CAR_BADGE_SIZE,
    borderRadius: radii.sm,
    overflow: 'hidden',
    // A surface ring so the badge reads as sitting ON the avatar rather than
    // merging with it — matches the app's soft, borderless card language.
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.surfaceSubtle,
  },
  carBadgeImage: {
    width: '100%',
    height: '100%',
  },
  body: {
    flex: 1,
    gap: spacing.xs,
  },
  topLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  name: {
    ...typography.body,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  // Family only (Satoshi-Bold) — keep body's 16/24 metrics so the row height doesn't jump
  // between read and unread neighbours.
  nameUnread: {
    fontFamily: typography.cardTitle.fontFamily,
  },
  time: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  contextLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  context: {
    ...typography.caption,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  preview: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  previewUnread: {
    color: colors.textPrimary,
  },
  unreadDot: {
    width: sizes.badgeDot,
    height: sizes.badgeDot,
    borderRadius: radii.full,
    backgroundColor: colors.accentText,
  },
});
