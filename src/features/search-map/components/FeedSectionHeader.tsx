/**
 * WHAT:  FeedSectionHeader — a feed section's title row: sectionTitle-size
 *        text with, at the row's end, up to two circled icon actions: a
 *        chart glyph that opens THIS section's theft stats, and the chevron
 *        that shows the section on the map (the reference feed's "see all"
 *        affordance). Each renders only when its handler is passed.
 * WHY:   Recycled FlashList row: derives everything from props, holds no
 *        state. The actions cluster right-aligned (mobile-reference pattern)
 *        — one glance, one tap each. The chevron stays outermost because it
 *        is the affordance readers already know; stats sits inside it.
 *
 *        Stats live HERE, per section, since 2026-09-21. They used to be one
 *        "Thefts near you" row pinned above the whole feed, which read as a
 *        banner competing with the cars beneath it and could only ever answer
 *        for the feed's whole radius. A section already names its area, so
 *        its header is where "how bad is it here?" belongs.
 *
 *        ⚠️ TWO TARGETS COST THE TITLE 48pt. "Recently stolen in St Albans"
 *        fitted one line beside one disc and did not beside two, so the title
 *        may wrap to a second line (the row grows only when it actually
 *        wraps — the common case still matches FeedSkeleton's height), and
 *        the cluster is pulled into the feed gutter so the outer disc's edge
 *        lands on the cards' 16pt edge rather than 8pt inside it. No hitSlop:
 *        each pressable is already the full 44pt, and slop on two neighbours
 *        would overlap in the gap and hand one button's edge to the other.
 * LINKS: src/features/search-map/lib/feedSections.ts (flattening);
 *        src/features/search-map/screens/AreaInsightsScreen.tsx (where the
 *        stats action lands); src/shared/ui/AppHeader.tsx (the two-adjacent-
 *        discs precedent); docs/DESIGN_SYSTEM.md (sectionTitle, touch
 *        targets).
 */

import { ChartNoAxesColumn, ChevronRight } from 'lucide-react-native';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';

export interface FeedSectionHeaderProps {
  title: string;
  /** Area carousels: navigates to search-map. Near you: frames the map on
   *  the feed's region (same calm chevron — one affordance style for every
   *  section). */
  onSeeAll?: () => void;
  /** Screen-reader label for the chevron; defaults to "See all — <title>".
   *  The good-news / error headers pass "Change area" — their chevron opens
   *  the picker instead. */
  seeAllAccessibilityLabel?: string;
  /** Opens theft stats scoped to THIS section's area. Passed for named-area
   *  carousels and Near you; absent (no button) for sections whose area is
   *  the feed's own (a duplicate of Near you) or that have none. */
  onStats?: () => void;
  /** Screen-reader label for the stats button. Callers pass the title of the
   *  screen it opens ("Thefts in St Albans") so what is announced is what
   *  the reader lands on; the default is a fallback, not the intent. */
  statsAccessibilityLabel?: string;
  statsTestID?: string;
}

export const FeedSectionHeader = memo(function FeedSectionHeader({
  title,
  onSeeAll,
  seeAllAccessibilityLabel,
  onStats,
  statsAccessibilityLabel,
  statsTestID,
}: FeedSectionHeaderProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  return (
    <View style={styles.row}>
      <Text accessibilityRole="header" style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      {onStats || onSeeAll ? (
        <View style={styles.actions}>
          {onStats ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={statsAccessibilityLabel ?? `Theft figures — ${title}`}
              onPress={onStats}
              style={styles.action}
              testID={statsTestID}
            >
              {({ pressed }) => (
                <View style={[styles.circle, pressed && styles.circlePressed]}>
                  <ChartNoAxesColumn size={sizes.iconSm} color={palette.textPrimary} />
                </View>
              )}
            </Pressable>
          ) : null}
          {onSeeAll ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={seeAllAccessibilityLabel ?? `See all — ${title}`}
              onPress={onSeeAll}
              style={styles.action}
            >
              {({ pressed }) => (
                <View style={[styles.circle, pressed && styles.circlePressed]}>
                  <ChevronRight size={sizes.iconSm} color={palette.textPrimary} />
                </View>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

/** The pressable's inset beyond the drawn disc — the same derivation
 *  PostStatsScreen uses to land its back glyph on the gutter. */
const DISC_INSET = (sizes.touchTarget - sizes.circleButtonSm) / 2;

const makeStyles = (c: Palette) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // Actions right-aligned at the row's end (mobile-reference pattern).
    justifyContent: 'space-between',
    gap: spacing.sm,
    // Feed gutter: 16 per the DESIGN_SYSTEM feed-surface exception; the
    // xxl above gives sections the reference feed's breathing room.
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.sectionTitle,
    color: c.textPrimary,
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    // sm, matching AppHeader's rightRow: the discs read as neighbours and the
    // full-size pressables never overlap.
    gap: spacing.sm,
    // Pull the cluster out by the pressable inset so the OUTER disc's edge
    // sits on the 16pt gutter the cards use, not 8pt inside it.
    marginRight: -DISC_INSET,
  },
  // Each pressable is padded to the 44pt touch target; the disc inside is
  // the drawn size only (sizes.circleButtonSm). Row height is unchanged from
  // the single-chevron layout unless the title wraps.
  action: {
    minHeight: sizes.touchTarget,
    minWidth: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    width: sizes.circleButtonSm,
    height: sizes.circleButtonSm,
    borderRadius: radii.full,
    backgroundColor: c.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circlePressed: {
    backgroundColor: c.surfaceSubtlePressed,
  },
});
