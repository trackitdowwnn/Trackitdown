/**
 * WHAT:  ThreadRow — one inbox conversation: Avatar, first name (bold when
 *        unread), the anchoring context line ("About your Blue BMW" + the
 *        owner's own PlateChip / "Your sighting · Blue BMW"), a one-line
 *        last-message preview, relative time, and the unread dot.
 * WHY:   Airbnb-style rows anchor a conversation to the THING it's about —
 *        here the car — so a list of first names never reads as an
 *        anonymous DM pile. PRIVACY: the plate renders ONLY on owner rows
 *        (their own plate; inboxModel pins the rule).
 * LINKS: src/features/chat/lib/inboxModel.ts (context/unread maths);
 *        src/shared/ui (Avatar, PlateChip); docs/DESIGN_SYSTEM.md.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { timeAgo } from '@/shared/lib/timeAgo';
import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import { Avatar, PlateChip } from '@/shared/ui';

import { contextLine, isUnread, previewText } from '../lib/inboxModel';
import type { InboxThread } from '../types';

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
          their uid, so it's not returned to the client (see types.ts). */}
      <Avatar name={thread.other.firstName} />
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
  // Weight only — keep body's 16/24 metrics so the row height doesn't jump
  // between read and unread neighbours.
  nameUnread: {
    fontWeight: typography.cardTitle.fontWeight,
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
