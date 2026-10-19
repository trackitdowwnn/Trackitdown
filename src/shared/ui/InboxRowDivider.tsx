/**
 * WHAT:  InboxRowDivider — the hairline between two rows on either inbox face,
 *        inset to start where the row's TEXT starts (past the 48pt tile).
 * WHY:   Added 2026-10-19 (owner: "squashed and hard to read"). With no
 *        dividers and no headers, one row's preview ran straight into the next
 *        row's name. An inset hairline is the messaging-app answer: it
 *        separates the text blocks and lets the round tiles stand as one
 *        column. Both faces use this one component, so the silhouette rule
 *        (ThreadRow / NotificationRowItem headers) holds for the gaps too.
 * LINKS: src/features/chat/screens/InboxScreen.tsx;
 *        src/features/notifications/screens/NotificationCenterScreen.tsx.
 */

import { StyleSheet, View } from 'react-native';

import { sizes, spacing, useThemedStyles, type Palette } from '@/shared/theme';

/**
 * Where the row's text column starts: the row's 24pt gutter, the tile, and
 * the row's 12pt gap. ⚠️ Derived from the same tokens the rows use, so moving
 * any of them moves the divider with it.
 */
export const INBOX_DIVIDER_INSET = spacing.xl + sizes.inboxRowTile + spacing.md;

export function InboxRowDivider() {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.divider} testID="inbox-row-divider" />;
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.border,
      marginLeft: INBOX_DIVIDER_INSET,
      // Ends on the same 24pt gutter the rows' trailing column does.
      marginRight: spacing.xl,
    },
  });
