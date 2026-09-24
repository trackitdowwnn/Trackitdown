/**
 * WHAT:  MapSearchPill — the floating pill at the top of the map that opens the
 *        search surface. Shows the "Search make or model" placeholder when no
 *        search is active, or the active search as a HEADLINE over its details
 *        ("Blue BMW" / "£500+ · within 10 miles of this area") with a clear (×)
 *        button when one is.
 * WHY:   The map's single entry into the unified search surface (mirrors the
 *        feed's FeedTopBar), and the persistent readout of what's filtering the
 *        map — Airbnb's active-search chip. Tapping the body reopens the surface
 *        to refine; the × clears back to the full active set without opening it.
 * LINKS: src/features/search-map/components/SearchSheet.tsx (what it opens);
 *        src/features/search-map/screens/MapSearchScreen.tsx (host);
 *        src/features/search-map/components/FeedTopBar.tsx (feed sibling).
 */

import { Feather } from '@expo/vector-icons';
import { memo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  opacity,
  radii,
  shadows,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';

import type { SearchSummary } from '../lib/searchCriteria';
import type { SourceRect } from './SearchSheet';

export interface MapSearchPillProps {
  /**
   * The active search as a headline over its details, or null when nothing is
   * filtered (the pill then shows its placeholder).
   *
   * TWO LINES, Airbnb's searched-state search bar (2026-09-22): the headline
   * says what you are looking at, the details qualify it in a quieter voice.
   * It was one flat string, which meant a search filtered only by radius put
   * "10mi" — a bare measurement — at the top of the map as the entire
   * description of what was on screen.
   */
  summary: SearchSummary | null;
  /**
   * Open the search surface, given this pill's measured WINDOW rect — the
   * surface morphs out of it and back into it on dismiss.
   *
   * Takes the rect (rather than being a bare `() => void`) because without one
   * SearchSheet has nothing to morph from and closes with NO animation at all
   * — which is what this screen used to do while the feed's identical pill
   * animated properly.
   */
  onPress: (rect: SourceRect) => void;
  /**
   * The same search as ONE sentence, for the screen reader — two visual lines
   * are one spoken thing, and a reader who hears a headline and then a
   * detached list of numbers has to reassemble them.
   */
  spokenSummary: string | null;
  /** Clear the active search (only shown when a summary is present). */
  onClear: () => void;
}

export const MapSearchPill = memo(function MapSearchPill({
  summary,
  spokenSummary,
  onPress,
  onClear,
}: MapSearchPillProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const active = Boolean(summary && summary.headline.trim());
  const pillRef = useRef<View>(null);

  // Measure in WINDOW (absolute) coords on tap, then open — same as
  // FeedTopBar. Measured per-tap rather than on layout because this pill
  // floats over the map and its width changes with the summary text.
  const handlePress = () => {
    const node = pillRef.current;
    if (!node) {
      return;
    }
    node.measureInWindow((x, y, width, height) => onPress({ x, y, width, height }));
  };

  return (
    <View style={styles.container}>
      <Pressable
        ref={pillRef}
        accessibilityRole="button"
        // `active` is derived from `summary`, but the label reads
        // `spokenSummary` — a separately-typed nullable prop. The callers keep
        // the two in step; this component cannot, so it falls back rather than
        // interpolating the word "null" into what a screen reader says.
        accessibilityLabel={
          active
            ? `Search: ${spokenSummary ?? summary?.headline ?? ''}. Edit search`
            : 'Search make or model'
        }
        onPress={handlePress}
        style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
      >
        <Feather name="search" size={sizes.iconSm} color={palette.textPrimary} />
        {/* The text column. The icon and × stay centred against it however
            many lines it has, so a one-line search and a two-line one put
            their controls in the same place. */}
        <View style={styles.text}>
          <Text numberOfLines={1} style={[styles.label, !active && styles.placeholder]}>
            {active && summary ? summary.headline : 'Search make or model'}
          </Text>
          {/* Only when there is something to qualify the headline WITH: a
              car with no other filter is one line, not a line and a blank. */}
          {active && summary?.details ? (
            <Text numberOfLines={1} style={styles.details} testID="map-search-details">
              {summary.details}
            </Text>
          ) : null}
        </View>
        {active ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={spacing.lg}
            onPress={onClear}
            style={({ pressed }) => [styles.clear, pressed && styles.clearPressed]}
          >
            <Feather name="x" size={sizes.iconSm} color={palette.textSecondary} />
          </Pressable>
        ) : null}
      </Pressable>
    </View>
  );
});

const makeStyles = (c: Palette) => StyleSheet.create({
  container: {
    // The screen positions this absolutely; it owns only its own width.
    flex: 1,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderRadius: radii.full,
    // minHeight, not height: the pill is one line at rest and two when a
    // search has details, and it grows into the second rather than clipping
    // it. `radii.full` clamps to half the shorter side, so a taller pill stays
    // a stadium rather than becoming a rounded rectangle.
    minHeight: sizes.control,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    // See MapCircleButton: the lifted shadow is a black cast and disappears on
    // a dark basemap, so floating map chrome carries its own hairline now.
    borderWidth: 1,
    borderColor: c.borderStrong,
    ...shadows.lifted,
  },
  pillPressed: {
    backgroundColor: c.surfaceSubtle,
  },
  // The text column between the icon and the ×; `flex: 1` moved here from the
  // label so the two lines share one measured width.
  text: {
    flex: 1,
  },
  label: {
    ...typography.label,
    color: c.textPrimary,
  },
  // The parameters under the headline — caption, secondary ink: they qualify
  // the line above rather than competing with it, which is the whole point of
  // splitting them off it.
  details: {
    ...typography.caption,
    color: c.textSecondary,
  },
  placeholder: {
    color: c.textSecondary,
  },
  // ⚠️ STRETCHES, it does not set a height. A `minHeight: touchTarget` here
  // made the × the tallest thing in the row, so an ACTIVE pill measured
  // 44 + 16 padding = 60 while a resting one measured `control` (52) — and
  // since the top bar centres its row off a fixed top, the 44pt back and
  // recentre buttons beside it dropped 4pt the moment a search was applied and
  // jumped back on clear. Stretching instead lets the text column decide the
  // height: one line or two, the pill is 52 and nothing beside it moves.
  //
  // The target is made up by hitSlop rather than by the box, and `lg` is
  // chosen so it clears 44 in the SHORTER case (a one-line active pill: an
  // 18pt row plus 16 a side = 50). The slop stays inside the pill's own
  // bounds, which is what Android requires of it.
  clear: {
    minWidth: sizes.touchTarget,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing.md,
  },
  clearPressed: {
    opacity: opacity.pressed,
  },
});
