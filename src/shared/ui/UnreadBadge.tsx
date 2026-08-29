/**
 * WHAT:  UnreadBadge — the unread mark that sits at the end of a list row: a
 *        dot at one, a count pill above one, and an EMPTY RESERVED SLOT at
 *        zero.
 * WHY:   ⚠️ THE EMPTY SLOT IS THE POINT, not an accident. Both inbox faces used
 *        to render their dot conditionally as a direct row child, so a READ row
 *        had 20pt more text column than an unread one (an 8pt dot plus the row's
 *        12pt gap). Nothing looked broken in isolation; in a mixed list the
 *        previews truncated at two different widths down the same column, which
 *        reads as sloppiness without ever announcing why. Reserving the slot
 *        costs 16pt of every row and makes the column straight.
 *
 *        The dot/pill/"9+" thresholds come from `badgeDisplay`, the same pure
 *        function AppTabBar's badge uses, so a row and the tab above it can
 *        never disagree about what "9+" means. The geometry is copied from
 *        AppTabBar deliberately: one badge look in the app.
 *
 *        ⚠️ THE CONTRACT EVERY CONSUMER MUST MEET: the badge carries NO
 *        accessibility of its own, so the row containing it must be an
 *        accessible node with an explicit `accessibilityLabel` that states the
 *        count in words ("… 3 unread messages."). Both inbox rows do. A
 *        consumer that skips it ships a badge a screen reader either reads as a
 *        bare "3" or never mentions at all.
 *
 *        (It is deliberately NOT marked accessibility-hidden — an explicit
 *        label on the parent already replaces what a reader would assemble from
 *        the children, so hiding bought nothing and made the badge unqueryable
 *        by testID, since RNTL excludes hidden nodes by default.)
 * LINKS: src/shared/ui/appTabBarModel.ts (badgeDisplay, the shared thresholds);
 *        src/shared/ui/AppTabBar.tsx (the geometry this matches);
 *        src/features/chat/components/ThreadRow.tsx and
 *        src/features/notifications/components/NotificationRowItem.tsx (the
 *        consumers).
 */

import { StyleSheet, Text, View } from 'react-native';

import { sizes, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';

import { badgeDisplay, type BadgeValue } from './appTabBarModel';

export interface UnreadBadgeProps {
  /** Unread count. 0/undefined/false renders the reserved empty slot. */
  count: BadgeValue;
  testID?: string;
}

export function UnreadBadge({ count, testID }: UnreadBadgeProps) {
  const styles = useThemedStyles(makeStyles);
  const base = badgeDisplay(count);
  // ⚠️ ONE IS A DOT HERE, THOUGH THE TAB BADGE DRAWS "1".
  // The two badges answer different questions. A tab badge tallies everything
  // behind an icon you cannot see, so the number is the whole message. A row
  // badge marks THIS row, which the reader is already looking at — "1" only
  // says "one", which the dot said without asking anyone to read a numeral.
  // The thresholds and the "9+" cap still come from `badgeDisplay`, so the two
  // can never disagree about anything that IS a number.
  const display = base.kind === 'count' && base.text === '1' ? ({ kind: 'dot' } as const) : base;

  return (
    <View
      style={styles.slot}
      // ⚠️ NOT MARKED accessibility-hidden, deliberately. Every consumer is a
      // Pressable carrying its own explicit `accessibilityLabel` ("…3 unread
      // messages."), and an explicit label already replaces what a screen
      // reader would otherwise assemble from the children — so the numeral is
      // never read twice. Adding `accessibilityElementsHidden` on top bought
      // nothing and made the badge unqueryable by testID, since RNTL excludes
      // accessibility-hidden nodes by default.
      testID={testID}
    >
      {display.kind === 'dot' ? <View style={styles.dot} /> : null}
      {display.kind === 'count' ? (
        <View style={styles.pill}>
          {/* Capped at 1×: the pill is a fixed 16pt box, and the count is
              spoken by the row rather than read off the pill. */}
          <Text style={styles.text} maxFontSizeMultiplier={1}>
            {display.text}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // ⚠️ A FIXED WIDTH, not a minimum — see the header. At `minWidth` a dot
    // measured 16 and a "9+" pill ~22, so the text column still ended at two
    // different x positions down one list: the exact defect this component was
    // written to remove, reintroduced at a smaller amplitude. `unreadSlot` is
    // sized to the widest pill, and the numeral is capped at 1× so it cannot
    // outgrow it.
    slot: {
      width: sizes.unreadSlot,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    // accentText: the monochrome scheme's near-black, matching AppTabBar so the
    // two badge surfaces read as one colour.
    dot: {
      width: sizes.badgeDot,
      height: sizes.badgeDot,
      borderRadius: sizes.badgeDot / 2,
      backgroundColor: c.accentText,
    },
    pill: {
      minWidth: sizes.badgePill,
      height: sizes.badgePill,
      borderRadius: sizes.badgePill / 2,
      backgroundColor: c.accentText,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xs,
    },
    text: {
      ...typography.tabLabel,
      color: c.textOnPrimary,
    },
  });
