/**
 * WHAT:  MapSearchPill — the floating pill at the top of the map that opens the
 *        search surface. Shows the "Search make or model" placeholder when no
 *        search is active, or the active-search summary ("Blue BMW · £500+")
 *        with a clear (×) button when one is.
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

import type { SourceRect } from './SearchSheet';

export interface MapSearchPillProps {
  /** The active-search summary, or null/'' when nothing is filtered. */
  summary: string | null;
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
  /** Clear the active search (only shown when a summary is present). */
  onClear: () => void;
}

export const MapSearchPill = memo(function MapSearchPill({
  summary,
  onPress,
  onClear,
}: MapSearchPillProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const active = Boolean(summary && summary.trim());
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
        accessibilityLabel={active ? `Search: ${summary}. Edit search` : 'Search make or model'}
        onPress={handlePress}
        style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
      >
        <Feather name="search" size={sizes.iconSm} color={palette.textPrimary} />
        <Text
          numberOfLines={1}
          style={[styles.label, !active && styles.placeholder]}
        >
          {active ? summary : 'Search make or model'}
        </Text>
        {active ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={spacing.sm}
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
    minHeight: sizes.control,
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
  label: {
    ...typography.label,
    color: c.textPrimary,
    flex: 1,
  },
  placeholder: {
    color: c.textSecondary,
  },
  clear: {
    // Full 44pt target; negative margin pulls it to the pill's edge without
    // inflating the pill height (the target overlaps the pill's padding).
    minWidth: sizes.touchTarget,
    minHeight: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing.md,
  },
  clearPressed: {
    opacity: opacity.pressed,
  },
});
