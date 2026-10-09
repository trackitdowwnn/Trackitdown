/**
 * WHAT:  DayHeader — the quiet label that divides a list into groups, plus
 *        DayHeaderSkeleton, the box it occupies while the list loads. Born as
 *        a calendar label ("Today", "23 July"); since 2026-10-09 its one
 *        consumer, My sightings, labels status sections with it ("Still
 *        open", "Answered", "Taken back").
 * WHY:   Three lists once grouped by day (the inbox's two faces and My
 *        reports) and each had hand-rolled the same five style properties.
 *        The inbox stopped grouping on 2026-09-04 and My sightings moved to
 *        sections; the quiet-label rule below is why it is still this
 *        component rather than a section title.
 *
 *        ⚠️ `label` AT `textSecondary`, NOT `sectionTitle`. This is the
 *        2026-08-28 carve-out in DESIGN_SYSTEM.md, and it is deliberately not
 *        configurable: a bold 20pt band between sparse rows out-shouts the rows
 *        it is meant to organise. A date is a divider, not a section title.
 *
 *        ⚠️ THE GUTTER IS A PROP because lists genuinely differ. A flush list
 *        whose rows pad themselves (the inbox faces did) needs the header to
 *        carry the 24; a list whose CONTENT CONTAINER already pads (My
 *        sightings) would otherwise indent every label to 48. Getting this
 *        wrong is invisible in isolation and obvious side by side, which is
 *        exactly the kind of drift a shared component exists to stop.
 *
 *        A real heading to a screen reader, so rotor navigation can jump
 *        between days rather than scrolling through them.
 *        ⚠️ NOT a consumer, despite the name: `SightingTimeline`'s own
 *        `DayHeader`. That one is a tick on a vertical rail inside a single
 *        post's history — it aligns to the rail, not to a list gutter, and it
 *        divides events within one story rather than grouping rows of a feed.
 *        Left alone deliberately.
 * LINKS: src/features/sightings/screens/MySightingsScreen.tsx (the consumer);
 *        docs/DESIGN_SYSTEM.md (the carve-out).
 */

import type { ReactNode } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { radii, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';

/** Who owns the horizontal gutter — see the header. */
export type DayHeaderGutter = 'default' | 'none';

export interface DayHeaderProps {
  /** The group's quiet label — a day, or (My sightings) a status section. */
  label: string;
  gutter?: DayHeaderGutter;
  /**
   * Optional action on the header's own line, right-aligned.
   *
   * ⚠️ IT MUST NOT BE TALLER THAN THE LABEL. The whole reason this slot exists
   * is to carry an action WITHOUT giving it a band of its own, so a control
   * that grows the header defeats it — use a text button with `hitSlop` to
   * reach the 44pt touch target rather than a 44pt-tall box.
   */
  trailing?: ReactNode;
  testID?: string;
}

export function DayHeader({ label, gutter = 'default', trailing, testID }: DayHeaderProps) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={[styles.row, gutter === 'none' && styles.flush]} testID={testID}>
      <Text style={styles.label} accessibilityRole="header">
        {label}
      </Text>
      {trailing}
    </View>
  );
}

/**
 * The label's shape while the feed loads — the same box `DayHeader` will
 * occupy, so the first row does not move when the data arrives.
 *
 * ⚠️ A BAR, NOT A WORD. The newest item in a sparse feed usually is not from
 * today, so rendering "Today" would flash a claim about to be replaced by a
 * different date.
 *
 * Scales with `fontScale`: it stands in for Text, which grows with the OS
 * setting, and a fixed-height View does not.
 */
export function DayHeaderSkeleton({
  gutter = 'default',
  testID,
}: {
  gutter?: DayHeaderGutter;
  testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();

  return (
    <View style={[styles.skeletonBox, gutter === 'none' && styles.flush]} testID={testID}>
      <View
        style={[styles.skeletonBar, { height: typography.label.lineHeight * (fontScale ?? 1) }]}
      />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // The box: the padding lives here rather than on the Text so an action can
    // share the line without a band of its own.
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingHorizontal: spacing.xl,
      // 16 above and 4 below: the label belongs to the group BENEATH it, and an
      // even split would leave it floating between two days.
      paddingTop: spacing.lg,
      paddingBottom: spacing.xs,
    },
    label: {
      ...typography.label,
      color: c.textSecondary,
      flexShrink: 1,
    },
    skeletonBox: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xs,
    },
    skeletonBar: {
      width: '30%',
      borderRadius: radii.sm,
      backgroundColor: c.surfaceSubtle,
    },
    flush: {
      paddingHorizontal: 0,
    },
  });
