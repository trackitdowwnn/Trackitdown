/**
 * WHAT:  FeedTopBar — the feed's search pill, alone at the very top of the
 *        screen with its icon + label centred. PINNED: it is rendered above
 *        the feed list, not inside it, so it never scrolls away.
 * WHY:   The mobile-reference layout: the pill IS the top of the feed (no
 *        page title above it — the area-change control lives in the
 *        near_you FeedSectionHeader's chevron). It's a fake input (a
 *        button): tapping it opens the full search surface on the map
 *        screen. (Search matches make/model — plate capture is deferred, so
 *        the copy no longer mentions plates.)
 *
 *        It used to live in the list's ListHeaderComponent and scrolled out of
 *        reach two rails down. Pinning costs ~72pt of feed height on every
 *        screen — a deliberate trade for search always being one tap away,
 *        including while the feed is loading or has failed.
 * LINKS: src/features/search-map/components/FeedSectionHeader.tsx (where
 *        the area control went); src/features/search-map/README.md
 *        (anatomy); docs/DESIGN_SYSTEM.md (tokens).
 */

import { Feather } from '@expo/vector-icons';
import { memo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
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

export interface FeedTopBarProps {
  /** Receives the pill's measured window rect so the search surface can morph
   *  out of it (the expand-from-pill animation). */
  onPressSearch: (rect: SourceRect) => void;
}

export const FeedTopBar = memo(function FeedTopBar({ onPressSearch }: FeedTopBarProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const pillRef = useRef<View>(null);
  // Measure the pill in WINDOW (absolute) coords on tap, then open — the
  // surface animates from this exact rect out to full-screen.
  const handlePress = () => {
    const node = pillRef.current;
    if (!node) {
      return;
    }
    node.measureInWindow((x, y, width, height) => onPressSearch({ x, y, width, height }));
  };

  return (
    <View style={styles.container}>
      <Pressable
        ref={pillRef}
        accessibilityRole="button"
        accessibilityLabel="Search make or model"
        onPress={handlePress}
        style={({ pressed }) => [styles.searchPill, pressed && styles.searchPillPressed]}
      >
        <Feather name="search" size={sizes.iconSm} color={palette.textPrimary} />
        <Text style={styles.searchPlaceholder}>Search make or model</Text>
      </Pressable>
    </View>
  );
});

const makeStyles = (c: Palette) => StyleSheet.create({
  container: {
    // Feed gutter: 16 per the DESIGN_SYSTEM feed-surface exception.
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    // The bar is PINNED above the feed, so it owns its band's colour rather
    // than depending on whatever it happens to sit over. Invisible today (the
    // page is already this colour and nothing scrolls under it in flex flow),
    // and the thing that stops feed cards showing through if it is ever moved
    // to an absolute overlay.
    backgroundColor: c.background,
  },
  searchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    // Centred icon+label — the reference pill reads as an invitation, not
    // an input field.
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderRadius: radii.full,
    minHeight: sizes.control,
    paddingHorizontal: spacing.lg,
    ...shadows.soft,
  },
  searchPillPressed: {
    backgroundColor: c.surfaceSubtle,
  },
  searchPlaceholder: {
    ...typography.label,
    color: c.textPrimary,
  },
});
