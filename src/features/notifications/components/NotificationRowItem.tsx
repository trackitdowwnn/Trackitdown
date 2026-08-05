/**
 * WHAT:  One notification feed row — icon in a neutral circle, title + body
 *        (2 lines max), relative time, unread dot + weight, and the warning
 *        accent bar on unread needs-attention kinds.
 * WHY:   The Airbnb-calm row: the icon SHAPE says what happened (hue assists,
 *        never carries alone), unread is a quiet dot and weight rather than a
 *        coloured background, and the two kinds that genuinely need the user
 *        (money waiting, a 72-hour window running) get the one louder
 *        treatment — a warning bar — that disappears the moment they're read.
 *        The whole row is one pressable ≥ touch-target height; the tap's
 *        destination comes from the row's stored payload through the same
 *        routing pushes use, so a row can never go somewhere its push
 *        wouldn't have.
 * LINKS: ../lib/centerRowMeta.ts (the one look-up table);
 *        ../api/notificationsApi.ts (NotificationRow);
 *        ../screens/NotificationCenterScreen.tsx (the only consumer).
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { timeAgo } from '@/shared/lib/timeAgo';
import { colors, radii, sizes, spacing, typography } from '@/shared/theme';

import type { NotificationRow } from '../api/notificationsApi';
import { CENTER_ROW_META } from '../lib/centerRowMeta';

export interface NotificationRowItemProps {
  row: NotificationRow;
  onPress: (row: NotificationRow) => void;
}

export function NotificationRowItem({ row, onPress }: NotificationRowItemProps) {
  const meta = CENTER_ROW_META[row.kind];
  const unread = row.readAt === null;
  const loud = unread && meta.needsAttention;

  // The dot, the weight and the bar are visual; the LABEL is where a screen-
  // reader user learns the same facts (ThreadRow's precedent).
  const accessibilityLabel =
    `${row.title}. ${row.body}. ${timeAgo(row.createdAt)}.` +
    (loud ? ' Needs your attention.' : unread ? ' Unread.' : '');

  return (
    <Pressable
      onPress={() => onPress(row)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID={`notification-${row.id}`}
    >
      {/* The needs-attention bar: warning is allowed as a border/accent, never
          text. Absent entirely for read/ordinary rows so the calm default has
          no ghost gutter. */}
      {loud ? <View style={styles.attentionBar} testID={`attention-${row.id}`} /> : null}
      <View style={styles.iconCircle}>
        <meta.Icon size={sizes.icon} color={meta.iconColor} />
      </View>
      <View style={styles.textColumn}>
        <Text
          style={[styles.title, unread && styles.titleUnread]}
          numberOfLines={1}
        >
          {row.title}
        </Text>
        <Text style={styles.body} numberOfLines={2}>
          {row.body}
        </Text>
      </View>
      <View style={styles.metaColumn}>
        <Text style={styles.time}>{timeAgo(row.createdAt)}</Text>
        {unread ? <View style={styles.unreadDot} testID={`unread-${row.id}`} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    minHeight: sizes.touchTarget,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  attentionBar: {
    position: 'absolute',
    left: 0,
    top: spacing.sm,
    bottom: spacing.sm,
    width: sizes.attentionBar,
    borderRadius: radii.full,
    backgroundColor: colors.warning,
  },
  iconCircle: {
    width: sizes.avatarMd,
    height: sizes.avatarMd,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textColumn: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    ...typography.label,
    color: colors.textPrimary,
  },
  // A HEAVIER FAMILY, never fontWeight — Android fakes bold over the loaded
  // face otherwise (ThreadRow's nameUnread precedent).
  titleUnread: {
    fontFamily: typography.cardTitle.fontFamily,
  },
  body: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  metaColumn: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  time: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  unreadDot: {
    width: sizes.badgeDot,
    height: sizes.badgeDot,
    borderRadius: radii.full,
    // The sanctioned badge hue (ThreadRow + AppTabBar) — same ink today, but
    // a palette retune must move both inbox faces together.
    backgroundColor: colors.accentText,
  },
});
